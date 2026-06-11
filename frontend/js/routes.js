/* ============================================================
   ROUTEX TRANSIT — ROUTES MODULE (FIRESTORE INTEGRATION)
   + Automatic map generation via OpenStreetMap Nominatim
   + Full depot‑aware filtering & creation (Super Admin / Admin)
   ============================================================ */

// ---------- IMPORTS ----------
import { initRBAC } from './rbac-loader.js';
import { logout } from '../firebase/auth-service.js';
import { hasPermission } from './permissions.js';
import {
    getAllRoutes,
    createRouteInFirestore,
    updateRouteInFirestore,
    deleteRouteFromFirestore,
    createActivityLog,
    updateRouteMapData,
    getAllDepots          // to populate depot selector
} from '../firebase/firestore-service.js';
import { notifyRouteCreated, notifyRouteUpdated } from './notifications-service.js';

// ---------- STATE ----------
let currentUser = null;
let allRoutes = [];
let depotsList = [];          // cached list of all depots
let depotMap = {};            // depotId → depotName (built from depotsList)
let activeFilters = {
    search: '',
    status: 'all',
    depot: 'all'              // new depot filter
};
let editRouteId = null;
let deleteRouteId = null;
let currentMap = null;

// ---------- DOM REFERENCES ----------
const tableBody = document.getElementById('routesTableBody');
const tableResponsive = document.getElementById('tableResponsive');
const tableSkeleton = document.getElementById('tableSkeleton');
const emptyState = document.getElementById('emptyState');
const resultsCount = document.getElementById('resultsCount');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const statusFilter = document.getElementById('statusFilter');
const depotFilter = document.getElementById('depotFilter');
const depotFilterWrapper = document.getElementById('depotFilterWrapper');
const activeFiltersContainer = document.getElementById('activeFilters');
const addRouteBtn = document.getElementById('addRouteBtn');

const routeModalOverlay = document.getElementById('routeModalOverlay');
const routeModalCloseBtn = document.getElementById('routeModalCloseBtn');
const routeModalCancelBtn = document.getElementById('routeModalCancelBtn');
const routeForm = document.getElementById('routeForm');
const routeModalTitle = document.getElementById('routeModalTitle');
const routeSubmitBtnText = document.getElementById('routeSubmitBtnText');
const routeSubmitSpinner = document.getElementById('routeSubmitSpinner');
const routeSubmitBtn = document.getElementById('routeModalSubmitBtn');

const deleteModalOverlay = document.getElementById('deleteModalOverlay');
const deleteModalCancelBtn = document.getElementById('deleteModalCancelBtn');
const deleteModalConfirmBtn = document.getElementById('deleteModalConfirmBtn');

const emptyStateClearBtn = document.getElementById('emptyStateClearBtn');
const headerStatsContainer = document.getElementById('headerStats');
const logoutBtn = document.getElementById('logoutBtn');

// Map modal refs
const mapModalOverlay = document.getElementById('mapModalOverlay');
const mapModalCloseBtn = document.getElementById('mapModalCloseBtn');
const mapRouteId = document.getElementById('mapRouteId');
const mapStartPoint = document.getElementById('mapStartPoint');
const mapEndPoint = document.getElementById('mapEndPoint');
const mapDistance = document.getElementById('mapDistance');
const mapTravelTime = document.getElementById('mapTravelTime');
const mapStopsCount = document.getElementById('mapStopsCount');
const mapContainer = document.getElementById('mapContainer');

// Depot field inside modal
const depotGroup = document.getElementById('routeDepotGroup');
const routeDepotSelect = document.getElementById('routeDepot');

// ---------- INITIALISATION ----------
document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await initRBAC('routes');
    if (!currentUser) return;

    populateTopbar(currentUser);
    setupSidebarToggle();
    updateDateTime();

    // Show/hide depot UI elements based on role
    if (currentUser.role === 'superadmin') {
        if (depotFilterWrapper) depotFilterWrapper.style.display = '';
        if (depotGroup) depotGroup.style.display = '';
    }

    // Preload depots for the modal selector and filter (only for superadmin)
    if (currentUser.role === 'superadmin') {
        try {
            depotsList = await getAllDepots();
            // Build lookup map
            depotMap = {};
            depotsList.forEach(d => depotMap[d.depotId] = d.depotName);
            populateDepotSelectorOptions();
        } catch (e) {
            console.warn('Could not load depots list for selector', e);
        }
    }

    attachEventListeners();
    await loadRoutes();
});

// ---------- Populate Topbar ----------
function populateTopbar(user) {
    const nameEl = document.getElementById('topbarUserName');
    const roleEl = document.getElementById('topbarUserRole');
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) {
        roleEl.textContent = user.role;
        roleEl.className = `role-badge role-${user.role}`;
    }
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await logout();
    });
}

// ---------- LOAD ROUTES ----------
async function loadRoutes() {
    try {
        tableSkeleton.style.display = 'block';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'none';

        const routes = await getAllRoutes({
            role: currentUser.role,
            depotId: currentUser.depotId
        });

        allRoutes = routes.map(route => ({
            id: route.id,
            routeId: route.routeId || route.id,
            startPoint: route.startPoint || '',
            endPoint: route.endPoint || '',
            distance: route.distance || 0,
            stops: Array.isArray(route.stops) ? route.stops : [],
            status: route.status || 'active',
            coordinates: route.coordinates || [],
            estimatedTravelTime: route.estimatedTravelTime || '',
            mapGenerated: route.mapGenerated || false,
            depotId: route.depotId || null,
            createdAt: route.createdAt || null,
            updatedAt: route.updatedAt || null
        }));

        tableSkeleton.style.display = 'none';
        applyFiltersAndRender();
    } catch (error) {
        tableSkeleton.style.display = 'none';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
        showToast(error.message || 'Failed to load routes.', 'error');
        console.error('loadRoutes error:', error);
    }
}

// ---------- Populate depot filter dropdown (all depots, ID – Name) ----------
function populateDepotFilterOptions() {
    if (!depotFilter || currentUser.role !== 'superadmin') return;

    // Only populate once (or if empty)
    if (depotFilter.options.length > 1) return;

    depotFilter.innerHTML = '<option value="all">All Depots</option>';
    depotsList.forEach(depot => {
        const opt = document.createElement('option');
        opt.value = depot.depotId;
        opt.textContent = `${depot.depotId} – ${depot.depotName}`;
        depotFilter.appendChild(opt);
    });

    // Restore previously selected value
    depotFilter.value = activeFilters.depot;
}

// ---------- Populate depot selector options (modal) ----------
function populateDepotSelectorOptions() {
    if (!routeDepotSelect) return;
    routeDepotSelect.innerHTML = '<option value="" disabled selected>Select a depot…</option>';
    depotsList.forEach(depot => {
        const option = document.createElement('option');
        option.value = depot.depotId;
        option.textContent = `${depot.depotId} – ${depot.depotName}`;
        routeDepotSelect.appendChild(option);
    });
}

// ---------- SIDEBAR TOGGLE ----------
function setupSidebarToggle() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!menuToggle || !sidebar) return;

    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active');
    });
    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
            }
        });
    });
}

// ---------- DATE / TIME ----------
function updateDateTime() {
    const el = document.getElementById('dateTimeText');
    if (!el) return;
    const now = new Date();
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    el.textContent = now.toLocaleDateString('en-US', options);
}

// ---------- HEADER STATS ----------
function renderHeaderStats() {
    if (!headerStatsContainer) return;
    const total = allRoutes.length;
    const activeCount = allRoutes.filter(r => r.status === 'active').length;

    headerStatsContainer.innerHTML = `
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <polyline points="3 9 12 3 21 9"/>
                <polyline points="3 9 3 21 9 21 9 15 15 15 15 21 21 21 21 9"/>
            </svg>
            <span class="header-stat-value">${total}</span>
            <span class="header-stat-label">Total</span>
        </div>
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="8 12 11 15 16 9"/>
            </svg>
            <span class="header-stat-value">${activeCount}</span>
            <span class="header-stat-label">Active</span>
        </div>
    `;
}

// ---------- FILTERING ----------
function getFilteredRoutes() {
    let filtered = allRoutes;
    const term = activeFilters.search.toLowerCase().trim();

    if (term) {
        filtered = filtered.filter(r =>
            r.routeId.toLowerCase().includes(term) ||
            r.startPoint.toLowerCase().includes(term) ||
            r.endPoint.toLowerCase().includes(term) ||
            r.stops.some(stop => stop.toLowerCase().includes(term))
        );
    }

    if (activeFilters.status !== 'all') {
        filtered = filtered.filter(r => r.status === activeFilters.status);
    }

    if (activeFilters.depot !== 'all') {
        filtered = filtered.filter(r => r.depotId === activeFilters.depot);
    }

    return filtered;
}

function applyFiltersAndRender() {
    const isSuperAdmin = currentUser.role === 'superadmin';

    // Show/hide depot UI
    if (isSuperAdmin) {
        if (depotFilterWrapper) depotFilterWrapper.style.display = '';
        // Populate the depot filter dropdown with all depots
        populateDepotFilterOptions();
    } else {
        if (depotFilterWrapper) depotFilterWrapper.style.display = 'none';
        activeFilters.depot = 'all';
    }

    const filtered = getFilteredRoutes();
    renderRoutesTable(filtered);
    renderActiveFilterTags();
    updateResultsCount(filtered.length);
    renderHeaderStats();

    if (currentUser && addRouteBtn) {
        addRouteBtn.style.display = hasPermission(currentUser.role, 'add') ? '' : 'none';
    }
}

// ---------- RENDER TABLE ----------
function renderRoutesTable(routes) {
    if (!tableBody || !currentUser) return;
    tableBody.innerHTML = '';

    const canEdit = hasPermission(currentUser.role, 'edit');
    const canDelete = hasPermission(currentUser.role, 'delete');
    const canViewMap = hasPermission(currentUser.role, 'viewMap');
    const isSuperAdmin = currentUser.role === 'superadmin';

    // Dynamically update table header for depot column
    const theadRow = document.querySelector('#routesTable thead tr');
    if (theadRow) {
        const existingDepotTh = theadRow.querySelector('.col-depot');
        if (existingDepotTh) existingDepotTh.remove();

        if (isSuperAdmin) {
            const depotTh = document.createElement('th');
            depotTh.scope = 'col';
            depotTh.className = 'col-depot';
            depotTh.textContent = 'Depot';
            theadRow.insertBefore(depotTh, theadRow.lastElementChild);
        }
    }

    if (routes.length === 0) {
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
    } else {
        tableResponsive.style.display = 'block';
        emptyState.style.display = 'none';

        routes.forEach(route => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-id', route.id);

            let actionsHtml = '';
            if (canEdit || canDelete || canViewMap) {
                actionsHtml = '<div class="actions-cell">';
                if (canEdit) {
                    actionsHtml += `
                        <button class="action-icon-btn" title="Edit" data-action="edit" data-id="${route.id}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9"/>
                                <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/>
                            </svg>
                        </button>`;
                }
                if (route.mapGenerated) {
                    if (canViewMap || canEdit) {
                        actionsHtml += `
                            <button class="action-icon-btn view-map-btn" title="View Map" data-action="view-map" data-id="${route.id}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                                    <line x1="8" y1="2" x2="8" y2="18"/>
                                    <line x1="16" y1="6" x2="16" y2="22"/>
                                </svg>
                            </button>`;
                    }
                } else {
                    if (canEdit) {
                        actionsHtml += `
                            <button class="action-icon-btn generate-map-btn" title="Generate Map" data-action="generate-map" data-id="${route.id}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                                    <polyline points="8 2 8 18 16 6 16 22"/>
                                </svg>
                            </button>`;
                    }
                }
                if (canDelete) {
                    actionsHtml += `
                        <button class="action-icon-btn" title="Delete" data-action="delete" data-id="${route.id}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>`;
                }
                actionsHtml += '</div>';
            }

            // Depot name for superadmin column
            const depotName = depotMap[route.depotId] || route.depotId || '—';

            let cellsHtml = `
                <td class="col-route-id" data-label="Route ID">${route.routeId}</td>
                <td class="col-start" data-label="Start Point">${route.startPoint}</td>
                <td class="col-end" data-label="End Point">${route.endPoint}</td>
                <td class="col-distance" data-label="Distance">${route.distance} km</td>
                <td class="col-stops" data-label="Stops">${route.stops.join(', ')}</td>
                <td class="col-status" data-label="Status">
                    <span class="status-badge ${route.status}">${route.status}</span>
                </td>`;

            if (isSuperAdmin) {
                cellsHtml += `<td class="col-depot" data-label="Depot">${depotName}</td>`;
            }

            cellsHtml += `<td class="col-actions" data-label="Actions">${actionsHtml}</td>`;
            tr.innerHTML = cellsHtml;
            tableBody.appendChild(tr);
        });

        // Re-attach action listeners
        if (canEdit) {
            document.querySelectorAll('.action-icon-btn[data-action="edit"]').forEach(btn =>
                btn.addEventListener('click', (e) => {
                    const id = e.currentTarget.dataset.id;
                    openEditRouteModal(id);
                })
            );
        }
        if (canEdit) {
            document.querySelectorAll('.action-icon-btn[data-action="generate-map"]').forEach(btn =>
                btn.addEventListener('click', (e) => {
                    const id = e.currentTarget.dataset.id;
                    handleGenerateMap(id);
                })
            );
        }
        if (canViewMap || canEdit) {
            document.querySelectorAll('.action-icon-btn[data-action="view-map"]').forEach(btn =>
                btn.addEventListener('click', (e) => {
                    const id = e.currentTarget.dataset.id;
                    openViewMapModal(id);
                })
            );
        }
        if (canDelete) {
            document.querySelectorAll('.action-icon-btn[data-action="delete"]').forEach(btn =>
                btn.addEventListener('click', (e) => {
                    const id = e.currentTarget.dataset.id;
                    showDeleteConfirmation(id);
                })
            );
        }
    }
}

// ---------- ACTIVE FILTER TAGS ----------
function renderActiveFilterTags() {
    if (!activeFiltersContainer) return;
    let html = '';

    if (activeFilters.status !== 'all') {
        html += `<span class="filter-tag">Status: ${activeFilters.status}
            <button class="filter-tag-close" data-filter="status">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button></span>`;
    }

    if (activeFilters.depot !== 'all') {
        const depotName = depotMap[activeFilters.depot] || activeFilters.depot;
        html += `<span class="filter-tag">Depot: ${depotName}
            <button class="filter-tag-close" data-filter="depot">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button></span>`;
    }

    if (activeFilters.status !== 'all' || activeFilters.depot !== 'all') {
        html += `<button class="filter-clear-all" id="clearAllFilters">Clear All</button>`;
    }

    activeFiltersContainer.innerHTML = html;

    document.querySelectorAll('.filter-tag-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = e.currentTarget.dataset.filter;
            if (type === 'status') {
                activeFilters.status = 'all';
                statusFilter.value = 'all';
            } else if (type === 'depot') {
                activeFilters.depot = 'all';
                if (depotFilter) depotFilter.value = 'all';
            }
            applyFiltersAndRender();
        });
    });

    const clearAllBtn = document.getElementById('clearAllFilters');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            activeFilters = { search: '', status: 'all', depot: 'all' };
            searchInput.value = '';
            searchClear.style.display = 'none';
            statusFilter.value = 'all';
            if (depotFilter) depotFilter.value = 'all';
            applyFiltersAndRender();
        });
    }
}

function updateResultsCount(count) {
    if (resultsCount) resultsCount.textContent = count;
}

// ---------- EVENT LISTENERS ----------
function attachEventListeners() {
    searchInput.addEventListener('input', (e) => {
        activeFilters.search = e.target.value;
        searchClear.style.display = activeFilters.search ? 'block' : 'none';
        applyFiltersAndRender();
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        activeFilters.search = '';
        searchClear.style.display = 'none';
        applyFiltersAndRender();
    });

    statusFilter.addEventListener('change', (e) => {
        activeFilters.status = e.target.value;
        applyFiltersAndRender();
    });

    if (depotFilter) {
        depotFilter.addEventListener('change', (e) => {
            activeFilters.depot = e.target.value;
            applyFiltersAndRender();
        });
    }

    addRouteBtn.addEventListener('click', openAddRouteModal);

    routeModalCloseBtn.addEventListener('click', closeRouteModal);
    routeModalCancelBtn.addEventListener('click', closeRouteModal);
    routeModalOverlay.addEventListener('click', (e) => {
        if (e.target === routeModalOverlay) closeRouteModal();
    });

    routeForm.addEventListener('submit', handleRouteFormSubmit);

    deleteModalCancelBtn.addEventListener('click', closeDeleteModal);
    deleteModalOverlay.addEventListener('click', (e) => {
        if (e.target === deleteModalOverlay) closeDeleteModal();
    });
    deleteModalConfirmBtn.addEventListener('click', confirmDeleteRoute);

    mapModalCloseBtn.addEventListener('click', closeMapModal);
    mapModalOverlay.addEventListener('click', (e) => {
        if (e.target === mapModalOverlay) closeMapModal();
    });

    if (emptyStateClearBtn) {
        emptyStateClearBtn.addEventListener('click', () => {
            activeFilters = { search: '', status: 'all', depot: 'all' };
            searchInput.value = '';
            searchClear.style.display = 'none';
            statusFilter.value = 'all';
            if (depotFilter) depotFilter.value = 'all';
            applyFiltersAndRender();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeRouteModal();
            closeDeleteModal();
            closeMapModal();
        }
    });
}

// ---------- MODAL HANDLERS ----------
function openAddRouteModal() {
    editRouteId = null;
    routeForm.reset();
    clearFormErrors();
    document.getElementById('routeModalTitle').textContent = 'Add Route';
    routeSubmitBtnText.textContent = 'Save Route';
    document.getElementById('routeId').disabled = false;

    if (currentUser.role === 'superadmin' && depotGroup) {
        depotGroup.style.display = '';
        if (routeDepotSelect) routeDepotSelect.value = '';
    } else if (depotGroup) {
        depotGroup.style.display = 'none';
    }

    routeModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function openEditRouteModal(routeId) {
    const route = allRoutes.find(r => r.id === routeId);
    if (!route) return;

    editRouteId = routeId;
    routeForm.reset();
    clearFormErrors();

    document.getElementById('routeId').value = route.routeId;
    document.getElementById('startPoint').value = route.startPoint;
    document.getElementById('endPoint').value = route.endPoint;
    document.getElementById('distance').value = route.distance;
    document.getElementById('stops').value = route.stops.join(', ');
    document.getElementById('routeStatus').value = route.status;
    document.getElementById('routeId').disabled = true;

    if (currentUser.role === 'superadmin' && depotGroup) {
        depotGroup.style.display = '';
        if (routeDepotSelect) {
            routeDepotSelect.value = route.depotId || '';
        }
    } else if (depotGroup) {
        depotGroup.style.display = 'none';
    }

    document.getElementById('routeModalTitle').textContent = 'Edit Route';
    routeSubmitBtnText.textContent = 'Update Route';

    routeModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeRouteModal() {
    routeModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    routeForm.reset();
    clearFormErrors();
    editRouteId = null;
    document.getElementById('routeId').disabled = false;
}

function showDeleteConfirmation(routeId) {
    deleteRouteId = routeId;
    deleteModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeDeleteModal() {
    deleteModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    deleteRouteId = null;
}

// ---------- FORM VALIDATION ----------
function validateRouteForm() {
    let isValid = true;
    clearFormErrors();

    const routeId = document.getElementById('routeId').value.trim();
    const startPoint = document.getElementById('startPoint').value.trim();
    const endPoint = document.getElementById('endPoint').value.trim();
    const distance = parseFloat(document.getElementById('distance').value);
    const stopsRaw = document.getElementById('stops').value.trim();
    const status = document.getElementById('routeStatus').value;

    if (!routeId) { showError('routeIdError', 'Route ID is required.'); isValid = false; }
    if (!startPoint) { showError('startPointError', 'Start point is required.'); isValid = false; }
    if (!endPoint) { showError('endPointError', 'End point is required.'); isValid = false; }
    if (isNaN(distance) || distance <= 0) { showError('distanceError', 'Valid positive distance is required.'); isValid = false; }
    if (!stopsRaw) { showError('stopsError', 'At least one stop is required.'); isValid = false; }
    if (!status) { showError('routeStatusError', 'Status is required.'); isValid = false; }

    if (!editRouteId) {
        const duplicate = allRoutes.some(r => r.routeId === routeId);
        if (duplicate) {
            showError('routeIdError', 'A route with this ID already exists.');
            isValid = false;
        }
    }

    if (currentUser.role === 'superadmin' && routeDepotSelect) {
        if (!routeDepotSelect.value) {
            showError('routeDepotError', 'Please select a depot.');
            isValid = false;
        }
    }

    return isValid;
}

function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
    }
}

function clearFormErrors() {
    document.querySelectorAll('.form-error').forEach(e => {
        e.textContent = '';
        e.style.display = 'none';
    });
}

// ---------- FORM SUBMIT (CREATE / UPDATE) ----------
async function handleRouteFormSubmit(e) {
    e.preventDefault();
    if (!validateRouteForm()) return;

    routeSubmitBtn.classList.add('loading');
    routeSubmitBtn.disabled = true;

    const routeIdValue = document.getElementById('routeId').value.trim();
    const startPoint = document.getElementById('startPoint').value.trim();
    const endPoint = document.getElementById('endPoint').value.trim();
    const distance = parseFloat(document.getElementById('distance').value);
    const stopsRaw = document.getElementById('stops').value.trim();
    const status = document.getElementById('routeStatus').value;
    const stopsArray = stopsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);

    const routeData = {
        startPoint,
        endPoint,
        distance,
        stops: stopsArray,
        status
    };

    if (currentUser.role === 'superadmin' && routeDepotSelect) {
        routeData.depotId = routeDepotSelect.value;
    } else {
        routeData.depotId = currentUser.depotId;
    }

    try {
        if (editRouteId) {
            const updatePayload = { ...routeData };
            if (currentUser.role !== 'superadmin') {
                delete updatePayload.depotId;
            }
            await updateRouteInFirestore(editRouteId, updatePayload, {
                role: currentUser.role,
                depotId: currentUser.depotId
            });
            await createActivityLog({
                action: 'UPDATE_ROUTE',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: editRouteId,
                targetType: 'route'
            });
            const updatedRoute = allRoutes.find(r => r.id === editRouteId);
            if (updatedRoute) {
                await notifyRouteUpdated({
                    routeId: updatedRoute.routeId,
                    startPoint,
                    endPoint
                });
            }
            showToast('Route updated successfully.', 'success');
        } else {
            await createRouteInFirestore(routeIdValue, routeData);
            await createActivityLog({
                action: 'CREATE_ROUTE',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: routeIdValue,
                targetType: 'route'
            });
            await notifyRouteCreated({
                routeId: routeIdValue,
                startPoint,
                endPoint
            });
            showToast('Route added successfully.', 'success');
        }

        closeRouteModal();
        await loadRoutes();
    } catch (error) {
        showToast(error.message || 'Operation failed.', 'error');
    } finally {
        routeSubmitBtn.classList.remove('loading');
        routeSubmitBtn.disabled = false;
    }
}

// ---------- DELETE CONFIRMATION ----------
async function confirmDeleteRoute() {
    if (!deleteRouteId) return;

    deleteModalConfirmBtn.disabled = true;
    try {
        await deleteRouteFromFirestore(deleteRouteId);
        await createActivityLog({
            action: 'DELETE_ROUTE',
            performedBy: currentUser?.uid || 'unknown',
            performedByName: currentUser?.name || 'Unknown',
            targetId: deleteRouteId,
            targetType: 'route'
        });
        showToast('Route deleted.', 'info');
        closeDeleteModal();
        await loadRoutes();
    } catch (error) {
        showToast(error.message || 'Failed to delete route.', 'error');
    } finally {
        deleteModalConfirmBtn.disabled = false;
    }
}

// ---------- TOAST SYSTEM ----------
function injectToastStyles() {
    if (document.getElementById('toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
        .toast-container {
            position: fixed; top: 1.5rem; right: 1.5rem; z-index: 9999;
            display: flex; flex-direction: column; gap: 0.8rem; pointer-events: none;
        }
        .toast {
            background: rgba(255,255,255,0.15); backdrop-filter: blur(40px) saturate(180%);
            -webkit-backdrop-filter: blur(40px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.3); border-radius: 20px;
            padding: 1rem 1.5rem; box-shadow: 0 12px 30px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.2);
            color: var(--text-dark); font-weight: 500; display: flex; align-items: center;
            gap: 0.6rem; pointer-events: auto; animation: slideInRight 0.3s ease;
            min-width: 250px;
        }
        .toast.success { background: rgba(16,185,129,0.2); color: #065f46; }
        .toast.error   { background: rgba(239,68,68,0.15); color: #991b1b; }
        .toast.info    { background: rgba(79,124,255,0.15); color: #1e0a5c; }
        @keyframes slideInRight {
            from { transform: translateX(120%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

function showToast(message, type = 'info') {
    injectToastStyles();
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

if (typeof AOS !== 'undefined') {
    AOS.init();
}

// ============================================================
//  MAP GENERATION & VIEWING (unchanged)
// ============================================================

async function geocodePlace(placeName) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}&limit=1`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`Geocoding failed for "${placeName}"`);
    const data = await response.json();
    if (!data || data.length === 0) throw new Error(`Location not found: "${placeName}"`);
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

function calculateTravelTime(distanceKm) {
    const hoursDecimal = distanceKm / 40;
    const hours = Math.floor(hoursDecimal);
    const minutes = Math.round((hoursDecimal - hours) * 60);
    return `${hours}h ${minutes}m`;
}

async function handleGenerateMap(routeId) {
    const route = allRoutes.find(r => r.id === routeId);
    if (!route) return;
    const places = [route.startPoint, ...route.stops, route.endPoint];
    try {
        showToast('Generating route map…', 'info');
        const coordinates = [];
        for (const place of places) {
            const coords = await geocodePlace(place);
            coordinates.push(coords);
        }
        const travelTime = calculateTravelTime(route.distance);
        await updateRouteMapData(routeId, { coordinates, estimatedTravelTime: travelTime, mapGenerated: true });
        await createActivityLog({
            action: 'GENERATED_ROUTE_MAP',
            performedBy: currentUser?.uid || 'unknown',
            performedByName: currentUser?.name || 'Unknown',
            targetId: routeId,
            targetType: 'route'
        });
        showToast('Route map generated successfully', 'success');
        await loadRoutes();
    } catch (error) {
        showToast(error.message || 'Map generation failed.', 'error');
    }
}

function openViewMapModal(routeId) {
    const route = allRoutes.find(r => r.id === routeId);
    if (!route || !route.coordinates || route.coordinates.length === 0) {
        showToast('No map data available for this route.', 'warning');
        return;
    }
    mapRouteId.textContent = route.routeId;
    mapStartPoint.textContent = route.startPoint;
    mapEndPoint.textContent = route.endPoint;
    mapDistance.textContent = `${route.distance} km`;
    mapTravelTime.textContent = route.estimatedTravelTime || '—';
    mapStopsCount.textContent = route.stops.length;
    mapModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    if (currentMap) {
        currentMap.remove();
        currentMap = null;
    }

    setTimeout(() => {
        currentMap = L.map('mapContainer').setView([0, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(currentMap);

        const latlngs = route.coordinates.map(c => [c.lat, c.lng]);
        const bounds = L.latLngBounds(latlngs);

        const startIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background:#16a34a; width:14px; height:14px; border-radius:50%; border:2px solid white; box-shadow:0 0 6px rgba(0,0,0,0.3);"></div>`,
            iconSize: [18, 18], iconAnchor: [9, 9]
        });
        const stopIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background:#3b82f6; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 0 6px rgba(0,0,0,0.3);"></div>`,
            iconSize: [16, 16], iconAnchor: [8, 8]
        });
        const endIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background:#ef4444; width:14px; height:14px; border-radius:50%; border:2px solid white; box-shadow:0 0 6px rgba(0,0,0,0.3);"></div>`,
            iconSize: [18, 18], iconAnchor: [9, 9]
        });

        L.marker(latlngs[0], { icon: startIcon }).addTo(currentMap).bindPopup('Start: ' + route.startPoint);
        for (let i = 1; i < latlngs.length - 1; i++) {
            L.marker(latlngs[i], { icon: stopIcon }).addTo(currentMap).bindPopup('Stop: ' + route.stops[i - 1]);
        }
        L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(currentMap).bindPopup('End: ' + route.endPoint);
        L.polyline(latlngs, { color: '#6c22f5', weight: 4, opacity: 0.8, smoothFactor: 1 }).addTo(currentMap);
        currentMap.fitBounds(bounds, { padding: [30, 30] });
        currentMap.invalidateSize();
    }, 100);
}

function closeMapModal() {
    mapModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    if (currentMap) {
        currentMap.remove();
        currentMap = null;
    }
}