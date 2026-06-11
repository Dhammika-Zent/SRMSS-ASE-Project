// ---------- IMPORTS ----------
import { initRBAC } from './rbac-loader.js';
import { logout } from '../firebase/auth-service.js';
import { hasPermission } from './permissions.js';
import {
    createMaintenanceLog,
    getAllMaintenanceLogs,
    updateMaintenanceLog,
    deleteMaintenanceLog,
    getMaintenanceLogById,
    getAllVehicles,
    createActivityLog,
    createNotification,
    getAllUsers,
    getAllDepots   // new import for depot map
} from '../firebase/firestore-service.js';

// ---------- STATE ----------
let currentUser = null;
let allMaintenanceLogs = [];
let allVehicles = [];
let allDepots = [];              // depot list for filter and display
let depotMap = new Map();        // depotId → depotName
let activeFilters = {
    search: '',
    status: 'all',
    fromDate: '',
    depot: 'all'               // new: depot filter (superadmin only)
};
let editDocId = null;
let deleteDocId = null;
let staffUserIds = [];

// ---------- DOM REFERENCES ----------
const maintenanceTableBody = document.getElementById('maintenanceTableBody');
const tableResponsive = document.getElementById('tableResponsive');
const tableSkeleton = document.getElementById('tableSkeleton');
const emptyState = document.getElementById('emptyState');
const resultsCount = document.getElementById('resultsCount');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const addMaintenanceBtn = document.getElementById('addMaintenanceBtn');
const maintenanceKpiCards = document.getElementById('maintenanceKpiCards');
const statusFilter = document.getElementById('statusFilter');
const fromDateFilter = document.getElementById('fromDateFilter');
const activeFiltersContainer = document.getElementById('activeFilters');
const emptyStateClearBtn = document.getElementById('emptyStateClearBtn');
const depotFilterContainer = document.getElementById('depotFilterContainer');

const maintenanceModalOverlay = document.getElementById('maintenanceModalOverlay');
const maintenanceModalCloseBtn = document.getElementById('maintenanceModalCloseBtn');
const maintenanceModalCancelBtn = document.getElementById('maintenanceModalCancelBtn');
const maintenanceForm = document.getElementById('maintenanceForm');
const maintenanceModalTitle = document.getElementById('maintenanceModalTitle');
const maintenanceSubmitBtnText = document.getElementById('maintenanceSubmitBtnText');
const maintenanceSubmitBtn = document.getElementById('maintenanceModalSubmitBtn');
const maintenanceSubmitSpinner = document.getElementById('maintenanceSubmitSpinner');

const viewMaintenanceModalOverlay = document.getElementById('viewMaintenanceModalOverlay');
const viewMaintenanceModalCloseBtn = document.getElementById('viewMaintenanceModalCloseBtn');
const viewMaintenanceModalCloseBtn2 = document.getElementById('viewMaintenanceModalCloseBtn2');
const viewMaintenanceDetails = document.getElementById('viewMaintenanceDetails');

const deleteModalOverlay = document.getElementById('deleteModalOverlay');
const deleteModalCancelBtn = document.getElementById('deleteModalCancelBtn');
const deleteModalConfirmBtn = document.getElementById('deleteModalConfirmBtn');

const vehicleIdSelect = document.getElementById('vehicleIdSelect');
const depotFormGroup = document.getElementById('depotFormGroup');
const depotField = document.getElementById('depotField');

// ---------- INITIALISATION ----------
document.addEventListener('DOMContentLoaded', async () => {
    // 1. RBAC init
    currentUser = await initRBAC('maintenance');
    if (!currentUser) return;

    // 2. Driver access denied
    if (currentUser.role === 'driver') {
        showAccessDenied();
        return;
    }

    // 3. Populate topbar
    populateTopbar(currentUser);

    // 4. Sidebar toggle & date/time
    setupSidebarToggle();
    updateDateTime();

    // 5. Load depots (needed for display and filter)
    await loadDepots();

    // 6. Load vehicles (with depot filtering)
    await loadVehicles();

    // 7. Load staff user IDs for notifications
    await loadStaffUserIds();

    // 8. Load maintenance logs with depot filtering
    await loadMaintenanceLogs();

    // 9. Attach event listeners
    attachEventListeners();

    // 10. Build depot filter (only for superadmin)
    setupDepotFilter();
});

// ---------- ACCESS DENIED ----------
function showAccessDenied() {
    const content = document.getElementById('maintenanceContent');
    if (content) {
        content.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; height:60vh; text-align:center;">
                <div>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#6c22f5" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                    </svg>
                    <h2 style="margin-top:1rem;">Access Denied</h2>
                    <p style="color:var(--text-soft);">You do not have permission to view this page.</p>
                </div>
            </div>
        `;
    }
}

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
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await logout();
    });
}

// ---------- LOAD DEPOTS ----------
async function loadDepots() {
    try {
        const depots = await getAllDepots();
        allDepots = depots;
        depotMap.clear();
        depots.forEach(d => depotMap.set(d.depotId || d.id, d.depotName || d.id));
    } catch (error) {
        console.error('Failed to load depots:', error);
    }
}

// ---------- LOAD VEHICLES (filtered by user depot) ----------
async function loadVehicles() {
    try {
        const filters = {};
        if (currentUser.role && currentUser.role !== 'superadmin') {
            filters.role = currentUser.role;
            filters.depotId = currentUser.depotId;
        }
        const vehicles = await getAllVehicles(filters);
        allVehicles = vehicles.map(v => ({
            id: v.id,
            vehicleId: v.vehicleId || v.id,
            registrationNo: v.registrationNo || '',
            mileage: v.mileage || 0,
            depotId: v.depotId || null
        }));
        populateVehicleDropdown();
    } catch (error) {
        console.error('Failed to load vehicles for maintenance dropdown:', error);
    }
}

function populateVehicleDropdown() {
    if (!vehicleIdSelect) return;
    vehicleIdSelect.innerHTML = '<option value="" disabled selected>Select a vehicle…</option>';
    allVehicles.forEach(vehicle => {
        const option = document.createElement('option');
        option.value = vehicle.vehicleId;
        option.textContent = `${vehicle.vehicleId} — ${vehicle.registrationNo}`;
        option.dataset.mileage = vehicle.mileage;
        option.dataset.depotId = vehicle.depotId || '';
        vehicleIdSelect.appendChild(option);
    });
}

// ---------- LOAD STAFF USER IDs ----------
async function loadStaffUserIds() {
    try {
        const users = await getAllUsers();
        staffUserIds = users
            .filter(user => user.role === 'staff')
            .map(user => user.id || user.uid);
    } catch (error) {
        console.error('Failed to load staff user IDs:', error);
        staffUserIds = [];
    }
}

// ---------- LOAD MAINTENANCE LOGS (depot-aware) ----------
async function loadMaintenanceLogs() {
    try {
        tableSkeleton.style.display = 'block';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'none';

        const filters = {};
        if (currentUser.role && currentUser.role !== 'superadmin') {
            filters.role = currentUser.role;
            filters.depotId = currentUser.depotId;
        }
        const logs = await getAllMaintenanceLogs(filters);
        allMaintenanceLogs = logs.map(log => ({
            id: log.id,
            maintenanceId: log.maintenanceId || '',
            vehicleId: log.vehicleId || '',
            depotId: log.depotId || '',
            maintenanceType: log.maintenanceType || '',
            description: log.description || '',
            serviceDate: log.serviceDate || '',
            vehicleMileage: log.vehicleMileage || 0,
            nextServiceMileage: log.nextServiceMileage || 0,
            cost: log.cost || 0,
            status: log.status || 'Scheduled',
            remarks: log.remarks || '',
            createdBy: log.createdBy || log.CreatedBy || '',
            createdAt: log.createdAt || null
        }));

        tableSkeleton.style.display = 'none';
        applyFiltersAndRender();
    } catch (error) {
        tableSkeleton.style.display = 'none';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
        showToast(error.message || 'Failed to load maintenance logs.', 'error');
        console.error('loadMaintenanceLogs error:', error);
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

// ---------- DEPOT FILTER SETUP (Super Admin only) ----------
function setupDepotFilter() {
    if (!depotFilterContainer) return;
    depotFilterContainer.innerHTML = '';

    // Only show for superadmin
    if (currentUser.role !== 'superadmin') {
        depotFilterContainer.style.display = 'none';
        return;
    }

    depotFilterContainer.style.display = '';
    const select = document.createElement('select');
    select.id = 'depotFilter';
    select.className = 'filter-select';
    select.innerHTML = '<option value="all">All Depots</option>';

    allDepots.forEach(depot => {
        const opt = document.createElement('option');
        opt.value = depot.depotId || depot.id;
        opt.textContent = `${depot.depotId} - ${depot.depotName || depot.id}`;
        select.appendChild(opt);
    });

    depotFilterContainer.appendChild(select);

    select.addEventListener('change', (e) => {
        activeFilters.depot = e.target.value;
        applyFiltersAndRender();
    });
}

// ---------- KPI CALCULATION (responds to all filters) ----------
function renderKpiCards(logs) {
    if (!maintenanceKpiCards) return;
    const totalRecords = logs.length;
    const scheduledCount = logs.filter(log => log.status === 'Scheduled').length;
    const completedCount = logs.filter(log => log.status === 'Completed').length;
    const totalCost = logs.reduce((sum, log) => sum + (log.cost || 0), 0);

    maintenanceKpiCards.innerHTML = `
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <span class="header-stat-value">${totalRecords}</span>
            <span class="header-stat-label">Total Records</span>
        </div>
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4l3 3" />
            </svg>
            <span class="header-stat-value">${scheduledCount}</span>
            <span class="header-stat-label">Scheduled</span>
        </div>
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <polyline points="20 6 9 17 4 12" />
            </svg>
            <span class="header-stat-value">${completedCount}</span>
            <span class="header-stat-label">Completed</span>
        </div>
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            <span class="header-stat-value">රු. ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span class="header-stat-label">Total Cost</span>
        </div>
    `;
}

// ---------- FILTERING (with depot) ----------
function getFilteredLogs() {
    let filtered = allMaintenanceLogs;

    // depot filter (only effective for superadmin; non‑superadmin already have one depot)
    if (activeFilters.depot && activeFilters.depot !== 'all') {
        filtered = filtered.filter(log => log.depotId === activeFilters.depot);
    }

    const term = activeFilters.search.toLowerCase().trim();
    if (term) {
        filtered = filtered.filter(log =>
            (log.maintenanceId && log.maintenanceId.toLowerCase().includes(term)) ||
            (log.vehicleId && log.vehicleId.toLowerCase().includes(term))
        );
    }
    if (activeFilters.status !== 'all') {
        filtered = filtered.filter(log => log.status === activeFilters.status);
    }
    if (activeFilters.fromDate) {
        filtered = filtered.filter(log => log.serviceDate >= activeFilters.fromDate);
    }
    return filtered;
}

function applyFiltersAndRender() {
    const filtered = getFilteredLogs();
    renderMaintenanceTable(filtered);
    renderActiveFilterTags();
    updateResultsCount(filtered.length);
    renderKpiCards(filtered);   // KPIs now reflect the filtered set

    if (currentUser && addMaintenanceBtn) {
        const role = currentUser.role;
        const canAdd = role === 'superadmin' || role === 'admin' || role === 'supervisor';
        addMaintenanceBtn.style.display = canAdd ? '' : 'none';
    }
}

// ---------- RENDER ACTIVE FILTER TAGS ----------
function renderActiveFilterTags() {
    if (!activeFiltersContainer) return;
    let html = '';

    if (activeFilters.depot && activeFilters.depot !== 'all') {
        const depotName = depotMap.get(activeFilters.depot) || activeFilters.depot;
        html += `<span class="filter-tag">Depot: ${depotName}
            <button class="filter-tag-close" data-filter="depot">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button></span>`;
    }

    if (activeFilters.status !== 'all') {
        html += `<span class="filter-tag">Status: ${activeFilters.status}
            <button class="filter-tag-close" data-filter="status">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button></span>`;
    }

    if (activeFilters.fromDate) {
        html += `<span class="filter-tag">From Date: ${activeFilters.fromDate}
            <button class="filter-tag-close" data-filter="fromDate">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button></span>`;
    }

    if (activeFilters.depot !== 'all' || activeFilters.status !== 'all' || activeFilters.fromDate) {
        html += `<button class="filter-clear-all" id="clearAllFilters">Clear All</button>`;
    }

    activeFiltersContainer.innerHTML = html;

    document.querySelectorAll('.filter-tag-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = e.currentTarget.dataset.filter;
            if (type === 'depot') {
                activeFilters.depot = 'all';
                const depotSelect = document.getElementById('depotFilter');
                if (depotSelect) depotSelect.value = 'all';
            } else if (type === 'status') {
                activeFilters.status = 'all';
                if (statusFilter) statusFilter.value = 'all';
            } else if (type === 'fromDate') {
                activeFilters.fromDate = '';
                if (fromDateFilter) fromDateFilter.value = '';
            }
            applyFiltersAndRender();
        });
    });

    const clearAllBtn = document.getElementById('clearAllFilters');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            activeFilters = { search: activeFilters.search, status: 'all', fromDate: '', depot: 'all' };
            if (statusFilter) statusFilter.value = 'all';
            if (fromDateFilter) fromDateFilter.value = '';
            const depotSelect = document.getElementById('depotFilter');
            if (depotSelect) depotSelect.value = 'all';
            applyFiltersAndRender();
        });
    }
}

// ---------- RENDER TABLE (added depot column) ----------
function renderMaintenanceTable(logs) {
    if (!maintenanceTableBody || !currentUser) return;
    maintenanceTableBody.innerHTML = '';

    const role = currentUser.role;
    const canView = true;
    const canEdit = (role === 'superadmin' || role === 'admin' || role === 'supervisor') && hasPermission(role, 'edit');
    const canDelete = (role === 'superadmin' || role === 'admin') && hasPermission(role, 'delete');

    if (logs.length === 0) {
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
    } else {
        tableResponsive.style.display = 'block';
        emptyState.style.display = 'none';

        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-doc-id', log.id);

            let actionsHtml = '<div class="actions-cell">';
            if (canView) {
                actionsHtml += `
                    <button class="action-icon-btn" title="View" data-action="view" data-id="${log.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>`;
            }
            if (canEdit) {
                actionsHtml += `
                    <button class="action-icon-btn" title="Edit" data-action="edit" data-id="${log.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 20h9"/>
                            <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/>
                        </svg>
                    </button>`;
            }
            if (canDelete) {
                actionsHtml += `
                    <button class="action-icon-btn" title="Delete" data-action="delete" data-id="${log.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>`;
            }
            actionsHtml += '</div>';

            let statusClass = log.status.toLowerCase().replace(/\s+/g, '-');
            const depotDisplay = depotMap.get(log.depotId) || log.depotId || '—';

            tr.innerHTML = `
                <td data-label="Maintenance ID">${log.maintenanceId}</td>
                <td data-label="Vehicle ID">${log.vehicleId}</td>
                <td data-label="Depot">${depotDisplay}</td>
                <td data-label="Maintenance Type">${log.maintenanceType}</td>
                <td data-label="Service Date">${log.serviceDate}</td>
                <td data-label="Vehicle Mileage">${log.vehicleMileage.toLocaleString()}</td>
                <td data-label="Next Service Mileage">${log.nextServiceMileage.toLocaleString()}</td>
                <td data-label="Cost">රු. ${parseFloat(log.cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td data-label="Status">
                    <span class="status-badge ${statusClass}">${log.status}</span>
                </td>
                <td data-label="Created By">${log.createdBy || '—'}</td>
                <td data-label="Actions">${actionsHtml}</td>
            `;
            maintenanceTableBody.appendChild(tr);
        });

        // Attach action listeners
        document.querySelectorAll('.action-icon-btn[data-action="view"]').forEach(btn =>
            btn.addEventListener('click', (e) => {
                const docId = e.currentTarget.dataset.id;
                openViewModal(docId);
            })
        );
        document.querySelectorAll('.action-icon-btn[data-action="edit"]').forEach(btn =>
            btn.addEventListener('click', (e) => {
                const docId = e.currentTarget.dataset.id;
                openEditMaintenanceModal(docId);
            })
        );
        document.querySelectorAll('.action-icon-btn[data-action="delete"]').forEach(btn =>
            btn.addEventListener('click', (e) => {
                const docId = e.currentTarget.dataset.id;
                showDeleteConfirmation(docId);
            })
        );
    }
}

// ---------- RESULTS COUNT ----------
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

    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            activeFilters.status = e.target.value;
            applyFiltersAndRender();
        });
    }

    if (fromDateFilter) {
        fromDateFilter.addEventListener('change', (e) => {
            activeFilters.fromDate = e.target.value;
            applyFiltersAndRender();
        });
    }

    addMaintenanceBtn.addEventListener('click', openAddMaintenanceModal);
    vehicleIdSelect.addEventListener('change', () => {
        autoFillMileage();
        updateDepotFieldFromVehicle();
    });

    // Modal close handlers
    maintenanceModalCloseBtn.addEventListener('click', closeMaintenanceModal);
    maintenanceModalCancelBtn.addEventListener('click', closeMaintenanceModal);
    maintenanceModalOverlay.addEventListener('click', (e) => {
        if (e.target === maintenanceModalOverlay) closeMaintenanceModal();
    });

    viewMaintenanceModalCloseBtn.addEventListener('click', closeViewModal);
    viewMaintenanceModalCloseBtn2.addEventListener('click', closeViewModal);
    viewMaintenanceModalOverlay.addEventListener('click', (e) => {
        if (e.target === viewMaintenanceModalOverlay) closeViewModal();
    });

    deleteModalCancelBtn.addEventListener('click', closeDeleteModal);
    deleteModalOverlay.addEventListener('click', (e) => {
        if (e.target === deleteModalOverlay) closeDeleteModal();
    });
    deleteModalConfirmBtn.addEventListener('click', confirmDeleteMaintenanceLog);

    maintenanceForm.addEventListener('submit', handleMaintenanceFormSubmit);

    if (emptyStateClearBtn) {
        emptyStateClearBtn.addEventListener('click', () => {
            activeFilters = { search: '', status: 'all', fromDate: '', depot: 'all' };
            if (searchInput) searchInput.value = '';
            if (statusFilter) statusFilter.value = 'all';
            if (fromDateFilter) fromDateFilter.value = '';
            const depotSelect = document.getElementById('depotFilter');
            if (depotSelect) depotSelect.value = 'all';
            if (searchClear) searchClear.style.display = 'none';
            applyFiltersAndRender();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMaintenanceModal();
            closeViewModal();
            closeDeleteModal();
        }
    });
}

// ---------- AUTO-FILL VEHICLE MILEAGE ----------
function autoFillMileage() {
    const selectedOption = vehicleIdSelect.options[vehicleIdSelect.selectedIndex];
    if (!selectedOption || !selectedOption.value) {
        document.getElementById('vehicleMileage').value = '';
        return;
    }
    const vehicle = allVehicles.find(v => v.vehicleId === selectedOption.value);
    if (vehicle) {
        document.getElementById('vehicleMileage').value = vehicle.mileage || '';
    } else {
        document.getElementById('vehicleMileage').value = '';
    }
}

// ---------- UPDATE DEPOT FIELD FROM SELECTED VEHICLE ----------
function updateDepotFieldFromVehicle() {
    if (!depotField) return;
    const selectedOption = vehicleIdSelect.options[vehicleIdSelect.selectedIndex];
    if (!selectedOption || !selectedOption.value) {
        depotField.value = '';
        return;
    }
    const vehicle = allVehicles.find(v => v.vehicleId === selectedOption.value);
    if (vehicle && vehicle.depotId) {
        const depotName = depotMap.get(vehicle.depotId) || vehicle.depotId;
        depotField.value = `${vehicle.depotId} - ${depotName}`;
    } else {
        depotField.value = '';
    }
}

// ---------- MODAL HANDLERS ----------
function openAddMaintenanceModal() {
    editDocId = null;
    maintenanceForm.reset();
    clearFormErrors();
    maintenanceModalTitle.textContent = 'Add Maintenance Log';
    maintenanceSubmitBtnText.textContent = 'Save Maintenance Log';
    document.getElementById('maintenanceId').disabled = false;
    document.getElementById('vehicleMileage').value = '';
    // Show depot field for relevant roles
    if (currentUser.role === 'superadmin' || currentUser.role === 'admin' || currentUser.role === 'supervisor') {
        depotFormGroup.style.display = '';
        depotField.value = '';
    } else {
        depotFormGroup.style.display = 'none';
    }
    maintenanceModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function openEditMaintenanceModal(docId) {
    const log = allMaintenanceLogs.find(l => l.id === docId);
    if (!log) return;

    editDocId = docId;
    maintenanceForm.reset();
    clearFormErrors();

    document.getElementById('maintenanceId').value = log.maintenanceId;
    document.getElementById('maintenanceId').disabled = true;
    vehicleIdSelect.value = log.vehicleId;
    document.getElementById('maintenanceType').value = log.maintenanceType;
    document.getElementById('serviceDate').value = log.serviceDate;
    document.getElementById('vehicleMileage').value = log.vehicleMileage;
    document.getElementById('nextServiceMileage').value = log.nextServiceMileage;
    document.getElementById('cost').value = log.cost;
    document.getElementById('status').value = log.status;
    document.getElementById('description').value = log.description || '';
    document.getElementById('remarks').value = log.remarks || '';

    // Set depot field
    if (currentUser.role === 'superadmin' || currentUser.role === 'admin' || currentUser.role === 'supervisor') {
        depotFormGroup.style.display = '';
        const depotName = depotMap.get(log.depotId) || log.depotId;
        depotField.value = log.depotId ? `${log.depotId} - ${depotName}` : '';
    } else {
        depotFormGroup.style.display = 'none';
    }

    maintenanceModalTitle.textContent = 'Edit Maintenance Log';
    maintenanceSubmitBtnText.textContent = 'Update Maintenance Log';
    maintenanceModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeMaintenanceModal() {
    maintenanceModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    maintenanceForm.reset();
    clearFormErrors();
    editDocId = null;
    document.getElementById('maintenanceId').disabled = false;
}

// ---------- VIEW MODAL (added depot) ----------
function openViewModal(docId) {
    const log = allMaintenanceLogs.find(l => l.id === docId);
    if (!log) return;

    const depotDisplay = depotMap.get(log.depotId) || log.depotId || '—';

    viewMaintenanceDetails.innerHTML = `
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Maintenance ID</span>
            <span class="maintenance-detail-value">${log.maintenanceId}</span>
        </div>
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Vehicle ID</span>
            <span class="maintenance-detail-value">${log.vehicleId}</span>
        </div>
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Depot</span>
            <span class="maintenance-detail-value">${depotDisplay}</span>
        </div>
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Maintenance Type</span>
            <span class="maintenance-detail-value">${log.maintenanceType}</span>
        </div>
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Service Date</span>
            <span class="maintenance-detail-value">${log.serviceDate}</span>
        </div>
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Vehicle Mileage</span>
            <span class="maintenance-detail-value">${log.vehicleMileage.toLocaleString()}</span>
        </div>
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Next Service Mileage</span>
            <span class="maintenance-detail-value">${log.nextServiceMileage.toLocaleString()}</span>
        </div>
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Cost</span>
            <span class="maintenance-detail-value">රු. ${parseFloat(log.cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Status</span>
            <span class="maintenance-detail-value">${log.status}</span>
        </div>
        <div class="maintenance-detail-item">
            <span class="maintenance-detail-label">Created By</span>
            <span class="maintenance-detail-value">${log.createdBy || '—'}</span>
        </div>
        <div class="maintenance-detail-item" style="grid-column: 1 / -1;">
            <span class="maintenance-detail-label">Description</span>
            <span class="maintenance-detail-value">${log.description || '—'}</span>
        </div>
        <div class="maintenance-detail-item" style="grid-column: 1 / -1;">
            <span class="maintenance-detail-label">Remarks</span>
            <span class="maintenance-detail-value">${log.remarks || '—'}</span>
        </div>
    `;
    viewMaintenanceModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeViewModal() {
    viewMaintenanceModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ---------- DELETE MODAL ----------
function showDeleteConfirmation(docId) {
    deleteDocId = docId;
    deleteModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeDeleteModal() {
    deleteModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    deleteDocId = null;
}

async function confirmDeleteMaintenanceLog() {
    if (!deleteDocId) return;
    deleteModalConfirmBtn.disabled = true;
    try {
        const log = allMaintenanceLogs.find(l => l.id === deleteDocId);
        const maintenanceId = log ? log.maintenanceId : 'Unknown';
        const vehicleId = log ? log.vehicleId : 'Unknown';

        await deleteMaintenanceLog(deleteDocId);

        await createActivityLog({
            action: 'DELETE_MAINTENANCE_LOG',
            performedBy: currentUser?.uid || 'unknown',
            performedByName: currentUser?.name || 'Unknown',
            targetId: `${maintenanceId}||${vehicleId}`,
            targetType: 'maintenanceLog'
        });

        await createNotification({
            title: 'Maintenance Log Deleted',
            message: `Maintenance record ${maintenanceId} removed\nVehicle: ${vehicleId}`,
            type: 'maintenance_log_deleted',
            targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
            targetUserIds: staffUserIds
        });

        showToast('Maintenance log deleted.', 'info');
        closeDeleteModal();
        await loadMaintenanceLogs();
    } catch (error) {
        showToast(error.message || 'Failed to delete maintenance log.', 'error');
    } finally {
        deleteModalConfirmBtn.disabled = false;
    }
}

// ---------- FORM VALIDATION ----------
function validateMaintenanceForm() {
    let isValid = true;
    clearFormErrors();

    const maintenanceId = document.getElementById('maintenanceId').value.trim();
    const vehicleId = vehicleIdSelect.value;
    const maintenanceType = document.getElementById('maintenanceType').value;
    const serviceDate = document.getElementById('serviceDate').value;
    const vehicleMileage = parseInt(document.getElementById('vehicleMileage').value, 10);
    const nextServiceMileage = parseInt(document.getElementById('nextServiceMileage').value, 10);
    const cost = parseFloat(document.getElementById('cost').value);
    const status = document.getElementById('status').value;

    if (!maintenanceId) {
        showError('maintenanceIdError', 'Maintenance ID is required.');
        isValid = false;
    }
    if (!vehicleId) {
        showError('vehicleIdSelectError', 'Vehicle is required.');
        isValid = false;
    }
    if (!maintenanceType) {
        showError('maintenanceTypeError', 'Maintenance type is required.');
        isValid = false;
    }
    if (!serviceDate) {
        showError('serviceDateError', 'Service date is required.');
        isValid = false;
    }
    if (isNaN(vehicleMileage) || vehicleMileage < 0) {
        showError('vehicleMileageError', 'Vehicle mileage must be a valid non‑negative number.');
        isValid = false;
    }
    if (isNaN(nextServiceMileage) || nextServiceMileage < 0) {
        showError('nextServiceMileageError', 'Next service mileage must be a valid non‑negative number.');
        isValid = false;
    }
    if (isNaN(cost) || cost <= 0) {
        showError('costError', 'Cost must be a positive number.');
        isValid = false;
    }
    if (!status) {
        showError('statusError', 'Status is required.');
        isValid = false;
    }
    if (nextServiceMileage <= vehicleMileage) {
        showError('nextServiceMileageError', 'Next service mileage must be greater than current mileage.');
        isValid = false;
    }

    if (!editDocId) {
        const duplicate = allMaintenanceLogs.some(log => log.maintenanceId === maintenanceId);
        if (duplicate) {
            showError('maintenanceIdError', 'A maintenance log with this ID already exists.');
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

// ---------- FORM SUBMIT (depot aware) ----------
async function handleMaintenanceFormSubmit(e) {
    e.preventDefault();
    if (!validateMaintenanceForm()) return;

    maintenanceSubmitBtn.classList.add('loading');
    maintenanceSubmitBtn.disabled = true;

    // Derive depotId from selected vehicle (in case field not set)
    let depotId = null;
    const selectedVehicleId = vehicleIdSelect.value;
    const selectedVehicle = allVehicles.find(v => v.vehicleId === selectedVehicleId);
    if (selectedVehicle && selectedVehicle.depotId) {
        depotId = selectedVehicle.depotId;
    }

    const maintenanceData = {
        maintenanceId: document.getElementById('maintenanceId').value.trim(),
        vehicleId: selectedVehicleId,
        maintenanceType: document.getElementById('maintenanceType').value,
        description: document.getElementById('description').value.trim(),
        serviceDate: document.getElementById('serviceDate').value,
        vehicleMileage: parseInt(document.getElementById('vehicleMileage').value, 10),
        nextServiceMileage: parseInt(document.getElementById('nextServiceMileage').value, 10),
        cost: parseFloat(document.getElementById('cost').value),
        status: document.getElementById('status').value,
        remarks: document.getElementById('remarks').value.trim(),
        createdBy: currentUser?.name || 'Unknown',
        depotId: depotId || null
    };

    try {
        if (editDocId) {
            await updateMaintenanceLog(editDocId, maintenanceData);

            await createActivityLog({
                action: 'UPDATE_MAINTENANCE_LOG',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: `${maintenanceData.maintenanceId}||${maintenanceData.vehicleId}`,
                targetType: 'maintenanceLog'
            });

            await createNotification({
                title: 'Maintenance Log Updated',
                message: `Maintenance record ${maintenanceData.maintenanceId} updated\nVehicle: ${maintenanceData.vehicleId}`,
                type: 'maintenance_log_updated',
                targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
                targetUserIds: staffUserIds
            });

            showToast('Maintenance log updated successfully.', 'success');
        } else {
            await createMaintenanceLog(maintenanceData);   // firestore-service will auto-derive if missing

            await createActivityLog({
                action: 'CREATE_MAINTENANCE_LOG',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: `${maintenanceData.maintenanceId}||${maintenanceData.vehicleId}`,
                targetType: 'maintenanceLog'
            });

            await createNotification({
                title: 'New Maintenance Log',
                message: `Vehicle ${maintenanceData.vehicleId} serviced\nMaintenance: ${maintenanceData.maintenanceId}\nType: ${maintenanceData.maintenanceType}\nCost: රු. ${maintenanceData.cost}`,
                type: 'maintenance_log_created',
                targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
                targetUserIds: staffUserIds
            });

            showToast('Maintenance log added successfully.', 'success');
        }

        closeMaintenanceModal();
        await loadMaintenanceLogs();
    } catch (error) {
        showToast(error.message || 'Operation failed.', 'error');
    } finally {
        maintenanceSubmitBtn.classList.remove('loading');
        maintenanceSubmitBtn.disabled = false;
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