/* ============================================================
   ROUTEX TRANSIT — VEHICLES MODULE (DEPOT-AWARE + SUPERADMIN FILTER/COLUMN)
   ============================================================ */

import { initRBAC } from './rbac-loader.js';
import { logout } from '../firebase/auth-service.js';
import { hasPermission } from './permissions.js';
import {
    getAllVehicles,
    createVehicleInFirestore,
    updateVehicleInFirestore,
    deleteVehicleFromFirestore,
    createActivityLog,
    getAllDepots
} from '../firebase/firestore-service.js';
import { notifyVehicleCreated, notifyVehicleUpdated } from './notifications-service.js';

// ---------- STATE ----------
let currentUser = null;
let allVehicles = [];
let allDepots = [];               // depot cache for superadmin dropdown & filter
let depotMap = {};                // depotId → depotName lookup
let activeFilters = {
    search: '',
    status: 'all',
    depot: 'all'                  // NEW
};
let editVehicleId = null;
let deleteVehicleId = null;

// ---------- DOM REFERENCES ----------
const tableBody = document.getElementById('vehiclesTableBody');
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
const addVehicleBtn = document.getElementById('addVehicleBtn');

const vehicleModalOverlay = document.getElementById('vehicleModalOverlay');
const vehicleModalCloseBtn = document.getElementById('vehicleModalCloseBtn');
const vehicleModalCancelBtn = document.getElementById('vehicleModalCancelBtn');
const vehicleForm = document.getElementById('vehicleForm');
const vehicleModalTitle = document.getElementById('vehicleModalTitle');
const vehicleSubmitBtnText = document.getElementById('vehicleSubmitBtnText');
const vehicleSubmitSpinner = document.getElementById('vehicleSubmitSpinner');
const vehicleSubmitBtn = document.getElementById('vehicleModalSubmitBtn');

const deleteModalOverlay = document.getElementById('deleteModalOverlay');
const deleteModalCancelBtn = document.getElementById('deleteModalCancelBtn');
const deleteModalConfirmBtn = document.getElementById('deleteModalConfirmBtn');

const emptyStateClearBtn = document.getElementById('emptyStateClearBtn');
const headerStatsContainer = document.getElementById('headerStats');
const logoutBtn = document.getElementById('logoutBtn');

const vehicleDepotSelect = document.getElementById('vehicleDepot');
const vehicleDepotGroup = document.getElementById('vehicleDepotGroup');
const vehiclesTable = document.getElementById('vehiclesTable');

// ---------- INITIALISATION ----------
document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await initRBAC('vehicles');
    if (!currentUser) return;

    // Preload depots for superadmin (needed for filter & modal)
    if (currentUser.role === 'superadmin') {
        try {
            allDepots = await getAllDepots();
            depotMap = {}; // build lookup
            allDepots.forEach(d => depotMap[d.depotId] = d.depotName);
        } catch (e) {
            console.warn('Could not load depots:', e);
            allDepots = [];
        }
    }

    populateTopbar(currentUser);
    setupSidebarToggle();
    updateDateTime();
    attachEventListeners();
    await loadVehicles();
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

// ---------- LOGOUT ----------
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await logout();
    });
}

// ---------- LOAD VEHICLES ----------
async function loadVehicles() {
    try {
        tableSkeleton.style.display = 'block';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'none';

        const vehicles = await getAllVehicles({
            role: currentUser.role,
            depotId: currentUser.depotId
        });

        allVehicles = vehicles.map(v => ({
            id: v.id,
            vehicleId: v.vehicleId || v.id,
            registrationNo: v.registrationNo || '',
            capacity: v.capacity || 0,
            mileage: v.mileage || 0,
            status: v.status || 'active',
            depotId: v.depotId || '',
            createdAt: v.createdAt || null,
            updatedAt: v.updatedAt || null
        }));

        tableSkeleton.style.display = 'none';
        applyFiltersAndRender();
    } catch (error) {
        tableSkeleton.style.display = 'none';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
        showToast(error.message || 'Failed to load vehicles.', 'error');
        console.error('loadVehicles error:', error);
    }
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
    const total = allVehicles.length;
    const activeCount = allVehicles.filter(v => v.status === 'active').length;
    const maintenanceCount = allVehicles.filter(v => v.status === 'maintenance').length;
    const inactiveCount = allVehicles.filter(v => v.status === 'inactive').length;

    headerStatsContainer.innerHTML = `
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="1" y="6" width="18" height="12" rx="2" />
                <circle cx="5" cy="18" r="2" />
                <circle cx="15" cy="18" r="2" />
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
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span class="header-stat-value">${maintenanceCount}</span>
            <span class="header-stat-label">Maintenance</span>
        </div>
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="10"/>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            <span class="header-stat-value">${inactiveCount}</span>
            <span class="header-stat-label">Inactive</span>
        </div>
    `;
}

// ---------- FILTERING ----------
function getFilteredVehicles() {
    let filtered = allVehicles;
    const term = activeFilters.search.toLowerCase().trim();

    if (term) {
        filtered = filtered.filter(v =>
            v.vehicleId.toLowerCase().includes(term) ||
            v.registrationNo.toLowerCase().includes(term)
        );
    }

    if (activeFilters.status !== 'all') {
        filtered = filtered.filter(v => v.status === activeFilters.status);
    }

    if (activeFilters.depot !== 'all') {
        filtered = filtered.filter(v => v.depotId === activeFilters.depot);
    }

    return filtered;
}

function applyFiltersAndRender() {
    // Superadmin depot filter & column visibility
    if (currentUser.role === 'superadmin') {
        if (depotFilterWrapper) depotFilterWrapper.style.display = '';
        if (vehiclesTable) vehiclesTable.classList.add('show-depot');

        // Populate depot filter if empty
        if (depotFilter && depotFilter.options.length <= 1) {
            depotFilter.innerHTML = '<option value="all">All Depots</option>';
            allDepots.forEach(depot => {
                const opt = document.createElement('option');
                opt.value = depot.depotId;
                opt.textContent = `${depot.depotId} – ${depot.depotName}`;
                depotFilter.appendChild(opt);
            });
        }
    } else {
        if (depotFilterWrapper) depotFilterWrapper.style.display = 'none';
        if (vehiclesTable) vehiclesTable.classList.remove('show-depot');
        activeFilters.depot = 'all';  // reset for non-superadmin
    }

    const filtered = getFilteredVehicles();
    renderVehiclesTable(filtered);
    renderActiveFilterTags();
    updateResultsCount(filtered.length);
    renderHeaderStats();

    // Hide Add Vehicle button for Supervisor
    if (currentUser && addVehicleBtn) {
        if (currentUser.role === 'supervisor') {
            addVehicleBtn.style.display = 'none';
        } else {
            addVehicleBtn.style.display = hasPermission(currentUser.role, 'add') ? '' : 'none';
        }
    }
}

// ---------- RENDER TABLE ----------
function renderVehiclesTable(vehicles) {
    if (!tableBody || !currentUser) return;
    tableBody.innerHTML = '';

    const isSupervisor = currentUser.role === 'supervisor';
    const canEdit = isSupervisor ? false : hasPermission(currentUser.role, 'edit');
    const canDelete = isSupervisor ? false : hasPermission(currentUser.role, 'delete');

    if (vehicles.length === 0) {
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
    } else {
        tableResponsive.style.display = 'block';
        emptyState.style.display = 'none';

        vehicles.forEach(vehicle => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-id', vehicle.vehicleId);

            let actionsHtml = '';
            if (canEdit || canDelete) {
                actionsHtml = '<div class="actions-cell">';
                if (canEdit) {
                    actionsHtml += `
                        <button class="action-icon-btn" title="Edit" data-action="edit" data-id="${vehicle.vehicleId}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9"/>
                                <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/>
                            </svg>
                        </button>`;
                }
                if (canDelete) {
                    actionsHtml += `
                        <button class="action-icon-btn" title="Delete" data-action="delete" data-id="${vehicle.vehicleId}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>`;
                }
                actionsHtml += '</div>';
            }

            const depotName = depotMap[vehicle.depotId] || vehicle.depotId || '—';

            tr.innerHTML = `
                <td class="col-vehicle-id" data-label="Vehicle ID">${vehicle.vehicleId}</td>
                <td class="col-registration-no" data-label="Registration No">${vehicle.registrationNo}</td>
                <td class="col-capacity" data-label="Capacity">${vehicle.capacity}</td>
                <td class="col-mileage" data-label="Mileage">${vehicle.mileage.toLocaleString()} km</td>
                <td class="col-status" data-label="Status">
                    <span class="status-badge ${vehicle.status}">${vehicle.status}</span>
                </td>
                <td class="col-depot" data-label="Depot">${depotName}</td>
                <td class="col-actions" data-label="Actions">${actionsHtml}</td>
            `;
            tableBody.appendChild(tr);
        });

        if (canEdit) {
            document.querySelectorAll('.action-icon-btn[data-action="edit"]').forEach(btn =>
                btn.addEventListener('click', (e) => {
                    const id = e.currentTarget.dataset.id;
                    openEditVehicleModal(id);
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

    addVehicleBtn.addEventListener('click', openAddVehicleModal);

    vehicleModalCloseBtn.addEventListener('click', closeVehicleModal);
    vehicleModalCancelBtn.addEventListener('click', closeVehicleModal);
    vehicleModalOverlay.addEventListener('click', (e) => {
        if (e.target === vehicleModalOverlay) closeVehicleModal();
    });

    vehicleForm.addEventListener('submit', handleVehicleFormSubmit);

    deleteModalCancelBtn.addEventListener('click', closeDeleteModal);
    deleteModalOverlay.addEventListener('click', (e) => {
        if (e.target === deleteModalOverlay) closeDeleteModal();
    });
    deleteModalConfirmBtn.addEventListener('click', confirmDeleteVehicle);

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
            closeVehicleModal();
            closeDeleteModal();
        }
    });
}

// ---------- DEPOT SELECTOR HELPER ----------
function configureDepotSelector(selectedDepotId) {
    if (!vehicleDepotGroup || !vehicleDepotSelect) return;

    if (currentUser.role === 'superadmin') {
        vehicleDepotGroup.style.display = 'block';
        vehicleDepotSelect.innerHTML = '<option value="" disabled selected>Select depot…</option>';
        allDepots.forEach(depot => {
            const opt = document.createElement('option');
            opt.value = depot.depotId;
            opt.textContent = `${depot.depotId} – ${depot.depotName}`;
            if (depot.depotId === selectedDepotId) opt.selected = true;
            vehicleDepotSelect.appendChild(opt);
        });
    } else {
        vehicleDepotGroup.style.display = 'none';
    }
}

// ---------- MODAL HANDLERS ----------
function openAddVehicleModal() {
    editVehicleId = null;
    vehicleForm.reset();
    clearFormErrors();
    document.getElementById('vehicleModalTitle').textContent = 'Add Vehicle';
    vehicleSubmitBtnText.textContent = 'Save Vehicle';
    document.getElementById('vehicleId').disabled = false;

    configureDepotSelector(null);

    vehicleModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function openEditVehicleModal(vehicleId) {
    const vehicle = allVehicles.find(v => v.vehicleId === vehicleId);
    if (!vehicle) return;

    editVehicleId = vehicleId;
    vehicleForm.reset();
    clearFormErrors();

    document.getElementById('vehicleId').value = vehicle.vehicleId;
    document.getElementById('registrationNo').value = vehicle.registrationNo;
    document.getElementById('capacity').value = vehicle.capacity;
    document.getElementById('mileage').value = vehicle.mileage;
    document.getElementById('vehicleStatus').value = vehicle.status;
    document.getElementById('vehicleId').disabled = true;

    configureDepotSelector(vehicle.depotId);

    document.getElementById('vehicleModalTitle').textContent = 'Edit Vehicle';
    vehicleSubmitBtnText.textContent = 'Update Vehicle';

    vehicleModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeVehicleModal() {
    vehicleModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    vehicleForm.reset();
    clearFormErrors();
    editVehicleId = null;
    document.getElementById('vehicleId').disabled = false;
}

function showDeleteConfirmation(vehicleId) {
    deleteVehicleId = vehicleId;
    deleteModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeDeleteModal() {
    deleteModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    deleteVehicleId = null;
}

// ---------- FORM VALIDATION ----------
function validateVehicleForm() {
    let isValid = true;
    clearFormErrors();

    const vehicleId = document.getElementById('vehicleId').value.trim();
    const registrationNo = document.getElementById('registrationNo').value.trim();
    const capacity = parseInt(document.getElementById('capacity').value, 10);
    const mileage = parseFloat(document.getElementById('mileage').value);
    const status = document.getElementById('vehicleStatus').value;

    if (!vehicleId) {
        showError('vehicleIdError', 'Vehicle ID is required.');
        isValid = false;
    }

    if (!registrationNo) {
        showError('registrationNoError', 'Registration number is required.');
        isValid = false;
    }

    if (isNaN(capacity) || capacity <= 0) {
        showError('capacityError', 'Valid positive capacity is required.');
        isValid = false;
    }

    if (isNaN(mileage) || mileage < 0) {
        showError('mileageError', 'Valid non‑negative mileage is required.');
        isValid = false;
    }

    if (!status) {
        showError('vehicleStatusError', 'Status is required.');
        isValid = false;
    }

    if (!editVehicleId) {
        const duplicate = allVehicles.some(v => v.vehicleId === vehicleId);
        if (duplicate) {
            showError('vehicleIdError', 'A vehicle with this ID already exists.');
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

// ---------- FORM SUBMIT ----------
async function handleVehicleFormSubmit(e) {
    e.preventDefault();
    if (!validateVehicleForm()) return;

    vehicleSubmitBtn.classList.add('loading');
    vehicleSubmitBtn.disabled = true;

    const vehicleId = document.getElementById('vehicleId').value.trim();
    const registrationNo = document.getElementById('registrationNo').value.trim();
    const capacity = parseInt(document.getElementById('capacity').value, 10);
    const mileage = parseFloat(document.getElementById('mileage').value);
    const status = document.getElementById('vehicleStatus').value;

    let depotId;
    if (currentUser.role === 'superadmin') {
        depotId = vehicleDepotSelect.value;
        if (!depotId) {
            showToast('Please select a depot.', 'error');
            vehicleSubmitBtn.classList.remove('loading');
            vehicleSubmitBtn.disabled = false;
            return;
        }
    } else {
        depotId = currentUser.depotId;
    }

    const vehicleData = {
        registrationNo,
        capacity,
        mileage,
        status,
        depotId
    };

    try {
        if (editVehicleId) {
            await updateVehicleInFirestore(editVehicleId, vehicleData);
            await createActivityLog({
                action: 'UPDATE_VEHICLE',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: editVehicleId,
                targetType: 'vehicle'
            });
            await notifyVehicleUpdated({ vehicleId: editVehicleId, registrationNo });
            showToast('Vehicle updated successfully.', 'success');
        } else {
            await createVehicleInFirestore(vehicleId, vehicleData);
            await createActivityLog({
                action: 'CREATE_VEHICLE',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: vehicleId,
                targetType: 'vehicle'
            });
            await notifyVehicleCreated({ vehicleId, registrationNo });
            showToast('Vehicle added successfully.', 'success');
        }

        closeVehicleModal();
        await loadVehicles();
    } catch (error) {
        showToast(error.message || 'Operation failed.', 'error');
    } finally {
        vehicleSubmitBtn.classList.remove('loading');
        vehicleSubmitBtn.disabled = false;
    }
}

// ---------- DELETE ----------
async function confirmDeleteVehicle() {
    if (!deleteVehicleId) return;

    deleteModalConfirmBtn.disabled = true;
    try {
        await deleteVehicleFromFirestore(deleteVehicleId);
        await createActivityLog({
            action: 'DELETE_VEHICLE',
            performedBy: currentUser?.uid || 'unknown',
            performedByName: currentUser?.name || 'Unknown',
            targetId: deleteVehicleId,
            targetType: 'vehicle'
        });
        showToast('Vehicle deleted.', 'info');
        closeDeleteModal();
        await loadVehicles();
    } catch (error) {
        showToast(error.message || 'Failed to delete vehicle.', 'error');
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

// ---------- AOS INIT ----------
if (typeof AOS !== 'undefined') {
    AOS.init();
}