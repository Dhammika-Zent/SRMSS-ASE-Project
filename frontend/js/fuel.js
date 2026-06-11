/* ============================================================
   ROUTEX TRANSIT — FUEL MODULE (FIRESTORE INTEGRATION)
   Phase 4 – Full CRUD, Notifications, Activity Logs, RBAC
   Depot‑aware update – fuel logs inherit depot from vehicle
   ============================================================ */

// ---------- IMPORTS ----------
import { initRBAC } from './rbac-loader.js';
import { logout } from '../firebase/auth-service.js';
import { hasPermission } from './permissions.js';
import {
    getAllFuelLogs,
    addFuelLog,
    updateFuelLog,
    deleteFuelLog,
    getFuelLogById,
    getAllVehicles,
    createActivityLog,
    createNotification,
    getAllUsers,
    getAllDepots                    // ← for depot name resolution
} from '../firebase/firestore-service.js';

// ---------- STATE ----------
let currentUser = null;
let allFuelLogs = [];               // now filtered by depot for non‑superadmin
let allVehicles = [];
let allDepots = [];
let depotMap = {};                  // quick lookup by depotId
let activeFilters = {
    search: '',
    depotId: 'all'                  // superadmin depot filter
};
let editFuelDocId = null;
let deleteFuelDocId = null;
let staffUserIds = [];

// ---------- DOM REFERENCES ----------
const fuelTableBody = document.getElementById('fuelTableBody');
const tableResponsive = document.getElementById('tableResponsive');
const tableSkeleton = document.getElementById('tableSkeleton');
const emptyState = document.getElementById('emptyState');
const resultsCount = document.getElementById('resultsCount');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const addFuelBtn = document.getElementById('addFuelBtn');
const fuelKpiCards = document.getElementById('fuelKpiCards');

const fuelModalOverlay = document.getElementById('fuelModalOverlay');
const fuelModalCloseBtn = document.getElementById('fuelModalCloseBtn');
const fuelModalCancelBtn = document.getElementById('fuelModalCancelBtn');
const fuelForm = document.getElementById('fuelForm');
const fuelModalTitle = document.getElementById('fuelModalTitle');
const fuelSubmitBtnText = document.getElementById('fuelSubmitBtnText');
const fuelSubmitBtn = document.getElementById('fuelModalSubmitBtn');
const fuelSubmitSpinner = document.getElementById('fuelSubmitSpinner');

const viewFuelModalOverlay = document.getElementById('viewFuelModalOverlay');
const viewFuelModalCloseBtn = document.getElementById('viewFuelModalCloseBtn');
const viewFuelModalCloseBtn2 = document.getElementById('viewFuelModalCloseBtn2');
const viewFuelDetails = document.getElementById('viewFuelDetails');

const deleteModalOverlay = document.getElementById('deleteModalOverlay');
const deleteModalCancelBtn = document.getElementById('deleteModalCancelBtn');
const deleteModalConfirmBtn = document.getElementById('deleteModalConfirmBtn');

const vehicleIdSelect = document.getElementById('vehicleIdSelect');
const mileageBefore = document.getElementById('mileageBefore');
const depotField = document.getElementById('depotField');   // ← readonly depot field

// ---------- INITIALISATION ----------
document.addEventListener('DOMContentLoaded', async () => {
    // 1. RBAC init
    currentUser = await initRBAC('fuel');
    if (!currentUser) return;

    // 2. Populate topbar
    populateTopbar(currentUser);

    // 3. Sidebar toggle & date/time
    setupSidebarToggle();
    updateDateTime();

    // 4. Load depots (needed early for names & filter UI)
    await loadAllDepots();

    // 5. Load vehicles for dropdown & mileage auto‑fill (depot‑aware)
    await loadVehicles();

    // 6. Load staff user IDs for notifications
    await loadStaffUserIds();

    // 7. Build depot filter UI (superadmin only)
    buildDepotFilterUI();

    // 8. Load fuel logs from Firestore (depot‑filtered)
    await loadFuelLogs();

    // 9. Attach event listeners
    attachEventListeners();
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
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await logout();
    });
}

// ---------- LOAD ALL DEPOTS (for filter & name resolution) ----------
async function loadAllDepots() {
    try {
        const depots = await getAllDepots();
        allDepots = depots;
        depotMap = {};
        depots.forEach(d => { depotMap[d.depotId || d.id] = d; });
        console.log(`🏢 Loaded ${depots.length} depots for fuel module.`);
    } catch (error) {
        console.error('Failed to load depots:', error);
        allDepots = [];
        depotMap = {};
    }
}

// ---------- LOAD VEHICLES (depot‑aware) ----------
async function loadVehicles() {
    try {
        // Pass role & depotId so non‑superadmin see only their depot’s vehicles
        const filters = { role: currentUser.role, depotId: currentUser.depotId };
        const vehicles = await getAllVehicles(filters);
        allVehicles = vehicles.map(v => ({
            id: v.id,
            vehicleId: v.vehicleId || v.id,
            registrationNo: v.registrationNo || '',
            mileage: v.mileage || 0,
            depotId: v.depotId || null       // ← ensure depotId is present
        }));
        populateVehicleDropdown();
    } catch (error) {
        console.error('Failed to load vehicles for fuel dropdown:', error);
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
        option.dataset.depotId = vehicle.depotId;   // store depotId for quick access
        vehicleIdSelect.appendChild(option);
    });
}

// ---------- LOAD STAFF USER IDs (for notifications) ----------
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

// ---------- LOAD FUEL LOGS (depot‑filtered) ----------
async function loadFuelLogs() {
    try {
        tableSkeleton.style.display = 'block';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'none';

        // Pass currentUser’s role & depotId to Firestore
        const filters = { role: currentUser.role, depotId: currentUser.depotId };
        const logs = await getAllFuelLogs(filters);
        allFuelLogs = logs.map(log => ({
            id: log.id,
            fuelId: log.fuelId || '',
            vehicleId: log.vehicleId || '',
            fuelType: log.fuelType || '',
            fuelAmount: log.fuelAmount || 0,
            fuelCost: log.fuelCost || 0,
            vehicleMileageBefore: log.vehicleMileageBefore ?? log.vehicleMileagebefore ?? log.mileageBefore ?? 0,
            odometerReading: log.odometerReading || 0,
            fuelDate: log.fuelDate || '',
            createdBy: log.createdBy || log.createdby || log.CreatedBy || '',
            remarks: log.remarks || '',
            depotId: log.depotId || null,        // from Firestore (may be null for old records)
            createdAt: log.createdAt || null
        }));

        // REQUIRED FIX: resolve missing depotId for legacy records
        for (const log of allFuelLogs) {
            if (!log.depotId && log.vehicleId) {
                const vehicle = allVehicles.find(v => v.vehicleId === log.vehicleId);
                if (vehicle && vehicle.depotId) {
                    log.depotId = vehicle.depotId;
                }
            }
        }

        tableSkeleton.style.display = 'none';
        applyFiltersAndRender();
    } catch (error) {
        tableSkeleton.style.display = 'none';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
        showToast(error.message || 'Failed to load fuel logs.', 'error');
        console.error('loadFuelLogs error:', error);
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

// ---------- DEPOT FILTER UI (SUPER ADMIN ONLY) ----------
function buildDepotFilterUI() {
    if (currentUser.role !== 'superadmin') return;

    const wrapper = document.getElementById('depotFilterWrapper');
    const select = document.getElementById('depotFilterSelect');
    if (!wrapper || !select) return;

    // Show the filter wrapper
    wrapper.style.display = '';

    // Clear existing options (keep the first "All Depots")
    while (select.options.length > 1) {
        select.remove(1);
    }

    // Populate with depots (format: DP001 - Colombo Depot)
    allDepots.forEach(depot => {
        const option = document.createElement('option');
        option.value = depot.depotId || depot.id;
        option.textContent = `${depot.depotId || depot.id} — ${depot.depotName}`;
        select.appendChild(option);
    });

    // Attach change listener
    select.addEventListener('change', (e) => {
        activeFilters.depotId = e.target.value;
        applyFiltersAndRender();
    });
}

// ---------- KPI CALCULATION (now uses filtered data) ----------
function renderKpiCards(logs = allFuelLogs) {   // default to allFuelLogs
    if (!fuelKpiCards) return;

    const totalLogs = logs.length;
    const totalCost = logs.reduce((sum, log) => sum + (log.fuelCost || 0), 0);
    const totalFuel = logs.reduce((sum, log) => sum + (log.fuelAmount || 0), 0);

    const vehicleFuelMap = {};
    logs.forEach(log => {
        const vid = log.vehicleId;
        if (!vid) return;
        vehicleFuelMap[vid] = (vehicleFuelMap[vid] || 0) + (log.fuelAmount || 0);
    });
    let mostFueledVehicle = 'N/A';
    let maxFuel = 0;
    Object.entries(vehicleFuelMap).forEach(([vid, amount]) => {
        if (amount > maxFuel) {
            maxFuel = amount;
            mostFueledVehicle = vid;
        }
    });

    fuelKpiCards.innerHTML = `
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <span class="header-stat-value">${totalLogs}</span>
            <span class="header-stat-label">Total Logs</span>
        </div>
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            <span class="header-stat-value">රු. ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span class="header-stat-label">Total Cost</span>
        </div>
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M3 22V6a2 2 0 012-2h10a2 2 0 012 2v16" />
                <path d="M7 10h6" />
                <circle cx="19" cy="9" r="2" />
            </svg>
            <span class="header-stat-value">${totalFuel.toFixed(1)} L</span>
            <span class="header-stat-label">Total Fuel</span>
        </div>
        <div class="header-stat">
            <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="1" y="6" width="18" height="12" rx="2" />
                <circle cx="5" cy="18" r="2" />
                <circle cx="15" cy="18" r="2" />
            </svg>
            <span class="header-stat-value">${mostFueledVehicle}</span>
            <span class="header-stat-label">Most Fueled</span>
        </div>
    `;

    if (typeof animateNumbers === 'function') {
        animateNumbers('.header-stat-value', 800);
    }
}

// ---------- FILTERING ----------
function getFilteredLogs() {
    let filtered = allFuelLogs;
    const term = activeFilters.search.toLowerCase().trim();
    if (term) {
        filtered = filtered.filter(log =>
            (log.fuelId && log.fuelId.toLowerCase().includes(term)) ||
            (log.vehicleId && log.vehicleId.toLowerCase().includes(term))
        );
    }
    // Depot filter (superadmin only; default 'all')
    if (activeFilters.depotId !== 'all') {
        filtered = filtered.filter(log => log.depotId === activeFilters.depotId);
    }
    return filtered;
}

function applyFiltersAndRender() {
    const filtered = getFilteredLogs();
    renderFuelTable(filtered);
    updateResultsCount(filtered.length);
    renderKpiCards(filtered);   // pass filtered logs to KPIs

    if (currentUser && addFuelBtn) {
        const role = currentUser.role;
        addFuelBtn.style.display = hasPermission(role, 'add') ? '' : 'none';
    }
}

// ---------- RENDER TABLE (now conditionally shows Depot column) ----------
function renderFuelTable(logs) {
    if (!fuelTableBody || !currentUser) return;
    fuelTableBody.innerHTML = '';

    const role = currentUser.role;
    const canView = true;
    const canEdit = (role === 'superadmin' || role === 'admin' || role === 'supervisor') && hasPermission(role, 'edit');
    const canDelete = (role === 'superadmin' || role === 'admin') && hasPermission(role, 'delete');
    const showDepotCol = (role === 'superadmin');

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

            let depotCell = '';
            if (showDepotCol) {
                const depId = log.depotId || '';
                const depot = depotMap[depId];
                // Show only the depot name; fallback to depotId if no name
                const depotName = depot ? depot.depotName : depId;
                depotCell = `<td data-label="Depot">${depotName}</td>`;
            }

            tr.innerHTML = `
                <td data-label="Fuel ID">${log.fuelId}</td>
                <td data-label="Vehicle ID">${log.vehicleId}</td>
                ${depotCell}
                <td data-label="Fuel Type">${log.fuelType}</td>
                <td data-label="Fuel Amount">${log.fuelAmount} L</td>
                <td data-label="Fuel Cost">රු. ${parseFloat(log.fuelCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td data-label="Mileage Before">${log.vehicleMileageBefore.toLocaleString()}</td>
                <td data-label="Odometer Reading">${log.odometerReading.toLocaleString()}</td>
                <td data-label="Fuel Date">${log.fuelDate}</td>
                <td data-label="Created By">${log.createdBy || '—'}</td>
                <td data-label="Actions">${actionsHtml}</td>
            `;
            fuelTableBody.appendChild(tr);
        });

        // Update table header to include Depot column if needed
        const thead = document.querySelector('table thead tr');
        if (thead) {
            const depotHeaderId = 'depotColHeader';
            if (showDepotCol) {
                if (!document.getElementById(depotHeaderId)) {
                    const th = document.createElement('th');
                    th.id = depotHeaderId;
                    th.textContent = 'Depot';
                    // Insert after Vehicle ID column
                    const vehicleHeader = Array.from(thead.children).find(child => child.textContent.trim() === 'Vehicle ID');
                    if (vehicleHeader) {
                        vehicleHeader.after(th);
                    } else {
                        thead.appendChild(th);
                    }
                }
            } else {
                const existing = document.getElementById(depotHeaderId);
                if (existing) existing.remove();
            }
        }

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
                openEditFuelModal(docId);
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

    addFuelBtn.addEventListener('click', openAddFuelModal);

    // Vehicle change → auto‑fill mileage AND depot field
    vehicleIdSelect.addEventListener('change', () => {
        autoFillMileage();
        updateDepotField();
    });

    fuelModalCloseBtn.addEventListener('click', closeFuelModal);
    fuelModalCancelBtn.addEventListener('click', closeFuelModal);
    fuelModalOverlay.addEventListener('click', (e) => {
        if (e.target === fuelModalOverlay) closeFuelModal();
    });

    viewFuelModalCloseBtn.addEventListener('click', closeViewModal);
    viewFuelModalCloseBtn2.addEventListener('click', closeViewModal);
    viewFuelModalOverlay.addEventListener('click', (e) => {
        if (e.target === viewFuelModalOverlay) closeViewModal();
    });

    deleteModalCancelBtn.addEventListener('click', closeDeleteModal);
    deleteModalOverlay.addEventListener('click', (e) => {
        if (e.target === deleteModalOverlay) closeDeleteModal();
    });
    deleteModalConfirmBtn.addEventListener('click', confirmDeleteFuelLog);

    fuelForm.addEventListener('submit', handleFuelFormSubmit);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeFuelModal();
            closeViewModal();
            closeDeleteModal();
        }
    });
}

// ---------- DEPOT FIELD HELPER (REQUIRED FIX #3 & #4) ----------
function updateDepotField(vehicleId = null) {
    if (!depotField) return;
    const vid = vehicleId || vehicleIdSelect.value;
    if (!vid) {
        depotField.value = '';
        depotField.placeholder = 'Select a vehicle';
        return;
    }
    const vehicle = allVehicles.find(v => v.vehicleId === vid);
    if (!vehicle || !vehicle.depotId) {
        depotField.value = '';
        depotField.placeholder = 'Unknown depot';
        return;
    }
    const depot = depotMap[vehicle.depotId];
    depotField.value = depot ? `${vehicle.depotId} — ${depot.depotName}` : `${vehicle.depotId}`;
    depotField.placeholder = '';
}

// ---------- MODAL HANDLERS (Fuel CRUD) ----------
function openAddFuelModal() {
    editFuelDocId = null;
    fuelForm.reset();
    clearFormErrors();
    fuelModalTitle.textContent = 'Add Fuel Log';
    fuelSubmitBtnText.textContent = 'Save Fuel Log';
    document.getElementById('fuelId').disabled = false;
    mileageBefore.value = '—';
    if (depotField) {
        depotField.value = '';
        depotField.placeholder = 'Select a vehicle';
    }
    fuelModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function openEditFuelModal(docId) {
    const log = allFuelLogs.find(l => l.id === docId);
    if (!log) return;

    editFuelDocId = docId;
    fuelForm.reset();
    clearFormErrors();

    document.getElementById('fuelId').value = log.fuelId;
    document.getElementById('fuelId').disabled = true;
    vehicleIdSelect.value = log.vehicleId;
    document.getElementById('fuelType').value = log.fuelType;
    document.getElementById('fuelAmount').value = log.fuelAmount;
    document.getElementById('fuelCost').value = log.fuelCost;
    document.getElementById('fuelDate').value = log.fuelDate;
    document.getElementById('odometerReading').value = log.odometerReading;
    document.getElementById('remarks').value = log.remarks || '';

    const vehicle = allVehicles.find(v => v.vehicleId === log.vehicleId);
    if (vehicle) {
        mileageBefore.value = vehicle.mileage.toLocaleString();
    } else {
        mileageBefore.value = '—';
    }

    // Auto‑populate depot field for edit modal
    updateDepotField(log.vehicleId);

    fuelModalTitle.textContent = 'Edit Fuel Log';
    fuelSubmitBtnText.textContent = 'Update Fuel Log';
    fuelModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeFuelModal() {
    fuelModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    fuelForm.reset();
    clearFormErrors();
    editFuelDocId = null;
    document.getElementById('fuelId').disabled = false;
    mileageBefore.value = '—';
    if (depotField) {
        depotField.value = '';
        depotField.placeholder = 'Select a vehicle';
    }
}

// ---------- VIEW MODAL (shows Depot for superadmin) ----------
function openViewModal(docId) {
    const log = allFuelLogs.find(l => l.id === docId);
    if (!log) return;

    let depotInfo = '';
    if (currentUser.role === 'superadmin') {
        const depId = log.depotId || '';
        const depot = depotMap[depId];
        const depotName = depot ? depot.depotName : depId;
        depotInfo = `
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Depot</span>
            <span class="fuel-detail-value">${depId} — ${depotName}</span>
        </div>`;
    }

    viewFuelDetails.innerHTML = `
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Fuel ID</span>
            <span class="fuel-detail-value">${log.fuelId}</span>
        </div>
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Vehicle ID</span>
            <span class="fuel-detail-value">${log.vehicleId}</span>
        </div>
        ${depotInfo}
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Fuel Type</span>
            <span class="fuel-detail-value">${log.fuelType}</span>
        </div>
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Fuel Amount</span>
            <span class="fuel-detail-value">${log.fuelAmount} L</span>
        </div>
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Fuel Cost</span>
            <span class="fuel-detail-value">රු. ${parseFloat(log.fuelCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Mileage Before</span>
            <span class="fuel-detail-value">${log.vehicleMileageBefore.toLocaleString()}</span>
        </div>
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Odometer Reading</span>
            <span class="fuel-detail-value">${log.odometerReading.toLocaleString()}</span>
        </div>
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Fuel Date</span>
            <span class="fuel-detail-value">${log.fuelDate}</span>
        </div>
        <div class="fuel-detail-item">
            <span class="fuel-detail-label">Created By</span>
            <span class="fuel-detail-value">${log.createdBy || '—'}</span>
        </div>
        <div class="fuel-detail-item" style="grid-column: 1 / -1;">
            <span class="fuel-detail-label">Remarks</span>
            <span class="fuel-detail-value">${log.remarks || '—'}</span>
        </div>
    `;
    viewFuelModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeViewModal() {
    viewFuelModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ---------- DELETE MODAL ----------
function showDeleteConfirmation(docId) {
    deleteFuelDocId = docId;
    deleteModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeDeleteModal() {
    deleteModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    deleteFuelDocId = null;
}

async function confirmDeleteFuelLog() {
    if (!deleteFuelDocId) return;
    deleteModalConfirmBtn.disabled = true;
    try {
        const fuelLog = allFuelLogs.find(l => l.id === deleteFuelDocId);
        const fuelId = fuelLog ? fuelLog.fuelId : 'Unknown';
        const vehicleId = fuelLog ? fuelLog.vehicleId : 'Unknown';

        await deleteFuelLog(deleteFuelDocId);

        await createActivityLog({
            action: 'DELETE_FUEL_LOG',
            performedBy: currentUser?.uid || 'unknown',
            performedByName: currentUser?.name || 'Unknown',
            targetId: `${fuelId}||${vehicleId}`,
            targetType: 'fuelLog'
        });

        await createNotification({
            title: 'Fuel Log Deleted',
            message: `Fuel record ${fuelId} removed\nVehicle: ${vehicleId}`,
            type: 'fuel_log_deleted',
            targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
            targetUserIds: staffUserIds
        });

        showToast('Fuel log deleted.', 'info');
        closeDeleteModal();
        await loadFuelLogs();
    } catch (error) {
        showToast(error.message || 'Failed to delete fuel log.', 'error');
    } finally {
        deleteModalConfirmBtn.disabled = false;
    }
}

// ---------- AUTO MILEAGE BEFORE ----------
function autoFillMileage() {
    const selectedOption = vehicleIdSelect.options[vehicleIdSelect.selectedIndex];
    if (!selectedOption || !selectedOption.value) {
        mileageBefore.value = '—';
        return;
    }
    const vehicle = allVehicles.find(v => v.vehicleId === selectedOption.value);
    if (vehicle) {
        mileageBefore.value = vehicle.mileage.toLocaleString();
    } else {
        mileageBefore.value = '—';
    }
}

// ---------- FORM VALIDATION ----------
function validateFuelForm() {
    let isValid = true;
    clearFormErrors();

    const fuelId = document.getElementById('fuelId').value.trim();
    const vehicleId = vehicleIdSelect.value;
    const fuelType = document.getElementById('fuelType').value;
    const fuelAmount = parseFloat(document.getElementById('fuelAmount').value);
    const fuelCost = parseFloat(document.getElementById('fuelCost').value);
    const fuelDate = document.getElementById('fuelDate').value;
    const odometerReading = parseInt(document.getElementById('odometerReading').value, 10);
    const currentMileageBefore = mileageBefore.value === '—' ? null : parseInt(mileageBefore.value.replace(/,/g, ''), 10);

    if (!fuelId) {
        showError('fuelIdError', 'Fuel ID is required.');
        isValid = false;
    }
    if (!vehicleId) {
        showError('vehicleIdSelectError', 'Vehicle is required.');
        isValid = false;
    }
    if (!fuelType) {
        showError('fuelTypeError', 'Fuel type is required.');
        isValid = false;
    }
    if (isNaN(fuelAmount) || fuelAmount <= 0) {
        showError('fuelAmountError', 'Fuel amount must be a positive number.');
        isValid = false;
    }
    if (isNaN(fuelCost) || fuelCost <= 0) {
        showError('fuelCostError', 'Fuel cost must be a positive number.');
        isValid = false;
    }
    if (!fuelDate) {
        showError('fuelDateError', 'Fuel date is required.');
        isValid = false;
    }
    if (isNaN(odometerReading) || odometerReading < 0) {
        showError('odometerReadingError', 'Odometer reading must be a valid non‑negative number.');
        isValid = false;
    }
    if (currentMileageBefore !== null && odometerReading <= currentMileageBefore) {
        showError('odometerReadingError', 'Odometer reading must be greater than current vehicle mileage.');
        isValid = false;
    }

    if (!editFuelDocId) {
        const duplicate = allFuelLogs.some(log => log.fuelId === fuelId);
        if (duplicate) {
            showError('fuelIdError', 'A fuel log with this ID already exists.');
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
async function handleFuelFormSubmit(e) {
    e.preventDefault();
    if (!validateFuelForm()) return;

    fuelSubmitBtn.classList.add('loading');
    fuelSubmitBtn.disabled = true;

    const fuelId = document.getElementById('fuelId').value.trim();
    const vehicleId = vehicleIdSelect.value;
    const fuelType = document.getElementById('fuelType').value;
    const fuelAmount = parseFloat(document.getElementById('fuelAmount').value);
    const fuelCost = parseFloat(document.getElementById('fuelCost').value);
    const fuelDate = document.getElementById('fuelDate').value;
    const odometerReading = parseInt(document.getElementById('odometerReading').value, 10);
    const remarks = document.getElementById('remarks').value.trim();
    const vehicleMileageBefore = mileageBefore.value === '—' ? null : parseInt(mileageBefore.value.replace(/,/g, ''), 10);

    const fuelData = {
        fuelId,
        vehicleId,
        fuelType,
        fuelAmount,
        fuelCost,
        fuelDate,
        odometerReading,
        vehicleMileageBefore: vehicleMileageBefore ?? 0,
        remarks,
        createdBy: currentUser?.name || 'Unknown'
    };

    try {
        if (editFuelDocId) {
            await updateFuelLog(editFuelDocId, fuelData);

            await createActivityLog({
                action: 'UPDATE_FUEL_LOG',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: `${fuelId}||${vehicleId}`,
                targetType: 'fuelLog'
            });

            await createNotification({
                title: 'Fuel Log Updated',
                message: `Fuel record ${fuelId} has been updated\nVehicle: ${vehicleId}`,
                type: 'fuel_log_updated',
                targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
                targetUserIds: staffUserIds
            });

            showToast('Fuel log updated successfully.', 'success');
        } else {
            await addFuelLog(fuelData);

            await createActivityLog({
                action: 'CREATE_FUEL_LOG',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: `${fuelId}||${vehicleId}`,
                targetType: 'fuelLog'
            });

            await createNotification({
                title: 'Fuel Log Recorded',
                message: `Vehicle ${vehicleId} refueled successfully\nFuel Log: ${fuelId}\nFuel Added: ${fuelAmount}L ${fuelType}\nCost: රු. ${fuelCost}`,
                type: 'fuel_log_created',
                targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
                targetUserIds: staffUserIds
            });

            showToast('Fuel log added successfully.', 'success');
        }

        closeFuelModal();
        await loadFuelLogs();
    } catch (error) {
        showToast(error.message || 'Operation failed.', 'error');
    } finally {
        fuelSubmitBtn.classList.remove('loading');
        fuelSubmitBtn.disabled = false;
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