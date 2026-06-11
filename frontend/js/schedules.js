// ============================================================
// ROUTEX TRANSIT — SCHEDULES MODULE (FULL RBAC + ACTIONS)
// ============================================================

import { initRBAC } from './rbac-loader.js';
import { logout } from '../firebase/auth-service.js';
import {
    getAllDrivers,
    getAllSchedules,
    createScheduleInFirestore,
    updateScheduleInFirestore,
    deleteScheduleFromFirestore,
    createActivityLog,
    getAllRoutes,
    getAllVehicles,
    getDriverData,
    detectAndGenerateConflicts,
    getAllDepots
} from '../firebase/firestore-service.js';

import {
    canAddSchedule,
    getScheduleActions
} from './schedule-permissions.js';

import { openMapModal } from './schedule-map-modal.js';
import {
    notifyScheduleAssigned,
    notifyScheduleUpdated,
    notifyTripStarted,
    notifyTripCompleted,
    notifyConflictDetected
} from './notifications-service.js';

// ---------- STATE ----------
let schedules = [];
let allDrivers = [];
let driversMap = {};
export let routesMap = {};
let vehiclesMap = {};
let depotsMap = {};

let currentUser = null;
let currentDriverId = null;

let activeFilters = {
    search: '',
    status: 'all',
    date: '',
    depot: 'all'
};
let editScheduleId = null;
let pendingDeleteId = null;

// ---------- DOM ELEMENTS ----------
const tableBody = document.getElementById('schedulesTableBody');
const tableResponsive = document.getElementById('tableResponsive');
const tableSkeleton = document.getElementById('tableSkeleton');
const emptyState = document.getElementById('emptyState');
const resultsCount = document.getElementById('resultsCount');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const statusFilter = document.getElementById('statusFilter');
const dateFilter = document.getElementById('dateFilter');
const depotFilter = document.getElementById('depotFilter');
const depotFilterWrapper = document.getElementById('depotFilterWrapper');
const activeFiltersContainer = document.getElementById('activeFilters');
const addScheduleBtn = document.getElementById('addScheduleBtn');

const scheduleModalOverlay = document.getElementById('scheduleModalOverlay');
const scheduleModalCloseBtn = document.getElementById('scheduleModalCloseBtn');
const scheduleModalCancelBtn = document.getElementById('scheduleModalCancelBtn');
const scheduleForm = document.getElementById('scheduleForm');
const scheduleModalTitle = document.getElementById('scheduleModalTitle');
const scheduleSubmitBtnText = document.getElementById('scheduleSubmitBtnText');
const scheduleSubmitBtn = document.getElementById('scheduleModalSubmitBtn');
const scheduleSubmitSpinner = document.getElementById('scheduleSubmitSpinner');

const deleteModalOverlay = document.getElementById('deleteModalOverlay');
const deleteModalCancelBtn = document.getElementById('deleteModalCancelBtn');
const deleteModalConfirmBtn = document.getElementById('deleteModalConfirmBtn');

const emptyStateClearBtn = document.getElementById('emptyStateClearBtn');
const sidebarToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const logoutBtn = document.getElementById('logoutBtn');

const topbarUserName = document.getElementById('topbarUserName');
const topbarUserRole = document.getElementById('topbarUserRole');

// Depot UI elements
const depotSelectGroup = document.getElementById('depotSelectGroup');
const depotSelect = document.getElementById('depotSelect');
const depotColumnHeader = document.getElementById('depotColumnHeader');

// ---------- INITIALISATION ----------
document.addEventListener('DOMContentLoaded', async () => {
    updateDateTime();
    setupSidebar();
    attachEventListeners();

    currentUser = await initRBAC('schedules');
    if (!currentUser) return;

    populateTopbar(currentUser);

    if (currentUser.role === 'driver') {
        const driverData = await getDriverData(currentUser.uid);
        currentDriverId = driverData?.driverId || null;
        if (!currentDriverId) showToast('No driver record found. Contact admin.', 'error');
    }

    addScheduleBtn.style.display = canAddSchedule(currentUser.role) ? '' : 'none';

    showSkeleton(true);
    await loadReferenceData();
    await refreshSchedules();
    setupDepotUI();
    populateDropdowns();
    applyFiltersAndRender();
    updateKPIs();
    showSkeleton(false);
});

// ---------- TOPBAR ----------
function populateTopbar(user) {
    if (topbarUserName) topbarUserName.textContent = user.name;
    if (topbarUserRole) {
        topbarUserRole.textContent = user.role;
        topbarUserRole.className = 'role-badge';
        if (user.role === 'superadmin') topbarUserRole.classList.add('role-superadmin');
        else if (user.role === 'admin') topbarUserRole.classList.add('role-admin');
    }
}

// ---------- SIDEBAR ----------
function setupSidebar() {
    if (sidebarToggle && sidebar && sidebarOverlay) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebarOverlay.classList.toggle('active');
        });
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('open');
                    sidebarOverlay.classList.remove('active');
                }
            });
        });
    }
}

// ---------- DATE/TIME ----------
function updateDateTime() {
    const el = document.getElementById('dateTimeText');
    if (!el) return;
    const now = new Date();
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    el.textContent = now.toLocaleDateString('en-US', options);
}

// ---------- LOAD REFERENCE DATA (DEPOT‑AWARE) ----------
async function loadReferenceData() {
    // Load depots first (for name lookup)
    const allDepots = await getAllDepots();
    depotsMap = {};
    allDepots.forEach(d => { depotsMap[d.depotId] = d.depotName; });

    // Load drivers, routes, vehicles filtered by depot
    const filterArgs = { role: currentUser.role, depotId: currentUser.depotId };
    const [drivers, routes, vehicles] = await Promise.all([
        getAllDrivers(filterArgs),
        getAllRoutes(filterArgs),
        getAllVehicles(filterArgs)
    ]);

    allDrivers = drivers;
    driversMap = {};
    drivers.forEach(d => {
        driversMap[d.driverId] = { name: d.name, assignedRouteId: d.assignedRouteId, depotId: d.depotId };
        if (d.id !== d.driverId) driversMap[d.id] = { name: d.name, assignedRouteId: d.assignedRouteId, depotId: d.depotId };
    });

    routesMap = {};
    routes.forEach(r => { routesMap[r.id] = { startPoint: r.startPoint, endPoint: r.endPoint, depotId: r.depotId }; });

    vehiclesMap = {};
    vehicles.forEach(v => { vehiclesMap[v.id] = { registrationNo: v.registrationNo, depotId: v.depotId }; });
}

async function refreshSchedules() {
    const filterArgs = { role: currentUser.role, depotId: currentUser.depotId };
    let allSchedules = await getAllSchedules(filterArgs);
    if (currentUser.role === 'driver' && currentDriverId) {
        schedules = allSchedules.filter(s => s.driverId === currentDriverId);
    } else {
        schedules = allSchedules;
    }
}

// ---------- DEPOT UI SETUP ----------
function setupDepotUI() {
    const isSuper = currentUser.role === 'superadmin';

    // Show/hide depot filter
    if (depotFilterWrapper) {
        depotFilterWrapper.style.display = isSuper ? '' : 'none';
    }
    // Show/hide depot column in table
    document.querySelectorAll('.col-depot').forEach(el => {
        el.classList.toggle('depot-hidden', !isSuper);
    });
    if (depotColumnHeader) {
        depotColumnHeader.classList.toggle('depot-hidden', !isSuper);
    }
    // Show/hide depot selector in modal
    if (depotSelectGroup) {
        depotSelectGroup.style.display = isSuper ? '' : 'none';
    }

    // Populate depot filter dropdown
    if (isSuper && depotFilter) {
        depotFilter.innerHTML = '<option value="all">All Depots</option>';
        Object.keys(depotsMap).forEach(depotId => {
            const opt = document.createElement('option');
            opt.value = depotId;
            opt.textContent = `${depotId} - ${depotsMap[depotId]}`;
            depotFilter.appendChild(opt);
        });
    }

    // Populate depot select in modal
    if (isSuper && depotSelect) {
        depotSelect.innerHTML = '<option value="" disabled selected>Select depot…</option>';
        Object.keys(depotsMap).forEach(depotId => {
            const opt = document.createElement('option');
            opt.value = depotId;
            opt.textContent = `${depotId} - ${depotsMap[depotId]}`;
            depotSelect.appendChild(opt);
        });

        // Attach depot change handler to refresh dependent dropdowns
        depotSelect.addEventListener('change', (e) => {
            updateDropdownsByDepot(e.target.value);
        });
    }
}

// ---------- DROPDOWN POPULATION (DEPOT‑AWARE) ----------
function populateDropdowns() {
    populateDriverDropdown();
    populateRouteDropdown();
    populateVehicleDropdown();
}

function populateDriverDropdown() {
    const select = document.getElementById('driverSelect');
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>Select driver…</option>';
    allDrivers.forEach(driver => {
        const opt = document.createElement('option');
        opt.value = driver.driverId;
        opt.textContent = `${driver.driverId} - ${driver.name}`;
        select.appendChild(opt);
    });
}

function populateRouteDropdown() {
    const select = document.getElementById('routeSelect');
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>Select route…</option>';
    Object.keys(routesMap).forEach(id => {
        const { startPoint, endPoint } = routesMap[id];
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${id} - ${startPoint} → ${endPoint}`;
        select.appendChild(opt);
    });
}

function populateVehicleDropdown() {
    const select = document.getElementById('vehicleSelect');
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>Select vehicle…</option>';
    Object.keys(vehiclesMap).forEach(id => {
        const { registrationNo } = vehiclesMap[id];
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${id} - ${registrationNo}`;
        select.appendChild(opt);
    });
}

/**
 * Refresh the driver, route and vehicle dropdowns based on the selected depot.
 * Optional preselected values are guaranteed to appear even if they belong to
 * a different depot (safety net for legacy data).
 *
 * @param {string} depotId - The depot to filter by (empty string resets to all)
 * @param {{ driverId?: string, routeId?: string, vehicleId?: string }} [preselected={}]
 */
function updateDropdownsByDepot(depotId, preselected = {}) {
    const driverSelect = document.getElementById('driverSelect');
    const routeSelect = document.getElementById('routeSelect');
    const vehicleSelect = document.getElementById('vehicleSelect');

    if (!depotId) {
        // No depot selected – show all available records
        populateDropdowns();
        return;
    }

    // ── Drivers ──
    if (driverSelect) {
        driverSelect.innerHTML = '<option value="" disabled selected>Select driver…</option>';
        const preselectDriverIds = preselected.driverId ? [preselected.driverId] : [];
        allDrivers.forEach(driver => {
            if (driver.depotId === depotId || preselectDriverIds.includes(driver.driverId)) {
                const opt = document.createElement('option');
                opt.value = driver.driverId;
                opt.textContent = `${driver.driverId} - ${driver.name}`;
                driverSelect.appendChild(opt);
            }
        });
    }

    // ── Routes ──
    if (routeSelect) {
        routeSelect.innerHTML = '<option value="" disabled selected>Select route…</option>';
        const preselectRouteIds = preselected.routeId ? [preselected.routeId] : [];
        Object.keys(routesMap).forEach(id => {
            const route = routesMap[id];
            if (route.depotId === depotId || preselectRouteIds.includes(id)) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = `${id} - ${route.startPoint} → ${route.endPoint}`;
                routeSelect.appendChild(opt);
            }
        });
    }

    // ── Vehicles ──
    if (vehicleSelect) {
        vehicleSelect.innerHTML = '<option value="" disabled selected>Select vehicle…</option>';
        const preselectVehicleIds = preselected.vehicleId ? [preselected.vehicleId] : [];
        Object.keys(vehiclesMap).forEach(id => {
            const vehicle = vehiclesMap[id];
            if (vehicle.depotId === depotId || preselectVehicleIds.includes(id)) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = `${id} - ${vehicle.registrationNo}`;
                vehicleSelect.appendChild(opt);
            }
        });
    }
}

// ---------- SKELETON ----------
function showSkeleton(show) {
    if (tableSkeleton) tableSkeleton.style.display = show ? 'block' : 'none';
    if (tableResponsive) tableResponsive.style.display = show ? 'none' : '';
}

// ---------- FILTERING & RENDERING ----------
function getFilteredSchedules() {
    let filtered = schedules;
    const term = activeFilters.search.toLowerCase().trim();

    if (term) {
        filtered = filtered.filter(s => {
            const driverName = driversMap[s.driverId]?.name || '';
            const routeStr = `${s.routeId} - ${routesMap[s.routeId]?.startPoint || ''} → ${routesMap[s.routeId]?.endPoint || ''}`;
            const vehicleStr = `${s.vehicleId} - ${vehiclesMap[s.vehicleId]?.registrationNo || ''}`;
            const depotName = depotsMap[s.depotId] || '';
            return (
                s.id.toLowerCase().includes(term) ||
                driverName.toLowerCase().includes(term) ||
                routeStr.toLowerCase().includes(term) ||
                vehicleStr.toLowerCase().includes(term) ||
                depotName.toLowerCase().includes(term)
            );
        });
    }

    if (activeFilters.status !== 'all') {
        filtered = filtered.filter(s => s.status === activeFilters.status);
    }
    if (activeFilters.date) {
        filtered = filtered.filter(s => s.scheduleDate === activeFilters.date);
    }
    if (activeFilters.depot !== 'all') {
        filtered = filtered.filter(s => s.depotId === activeFilters.depot);
    }

    return filtered;
}

function applyFiltersAndRender() {
    const filtered = getFilteredSchedules();
    renderTable(filtered);
    renderActiveFilterTags();
    updateResultsCount(filtered.length);
}

// ---------- TABLE RENDERING (DEPOT COLUMN – ONLY NAME) ----------
function renderTable(schedulesData) {
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (schedulesData.length === 0) {
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }

    tableResponsive.style.display = 'block';
    emptyState.style.display = 'none';

    const isSuper = currentUser.role === 'superadmin';

    schedulesData.forEach(schedule => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', schedule.id);

        const businessDriverId = resolveBusinessDriverId(schedule.driverId);
        const driverName = driversMap[businessDriverId]?.name || 'Unknown';
        const routeStart = routesMap[schedule.routeId]?.startPoint || '?';
        const routeEnd = routesMap[schedule.routeId]?.endPoint || '?';
        const vehicleReg = vehiclesMap[schedule.vehicleId]?.registrationNo || '?';
        // Only the depot name – no ID
        const depotDisplay = isSuper ? (depotsMap[schedule.depotId] || 'Unknown Depot') : '';

        const formatTimestamp = (ts) => {
            if (!ts) return '--';
            const d = new Date(ts);
            if (isNaN(d.getTime())) return '--';
            return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        };

        const formatPerformance = (schedule) => {
            if (schedule.delayMinutes == null) return '--';
            const mins = schedule.delayMinutes;
            if (mins === 0) return 'On Time';
            if (mins > 0) {
                if (mins >= 60) {
                    const h = Math.floor(mins / 60);
                    const m = mins % 60;
                    return `Delayed by ${h} hr ${m} min`;
                }
                return `Delayed by ${mins} min`;
            }
            const abs = Math.abs(mins);
            if (abs >= 60) {
                const h = Math.floor(abs / 60);
                const m = abs % 60;
                return `Early by ${h} hr ${m} min`;
            }
            return `Early by ${abs} min`;
        };

        const statusClass = schedule.status.toLowerCase().replace(/\s+/g, '-');
        const actions = getScheduleActions(schedule, currentUser, currentDriverId);
        const actionsHtml = actions.map(a => `
      <button class="action-icon-btn" title="${a.label}" data-action="${a.handler}" data-id="${schedule.id}">
        ${a.icon}
      </button>
    `).join('');

        tr.innerHTML = `
      <td class="col-schedule-id" data-label="Schedule ID">${schedule.id}</td>
      <td class="col-route" data-label="Route">${schedule.routeId} - ${routeStart} → ${routeEnd}</td>
      <td class="col-driver" data-label="Driver">${businessDriverId} - ${driverName}</td>
      <td class="col-vehicle" data-label="Vehicle">${schedule.vehicleId} - ${vehicleReg}</td>
      <td class="col-depot ${isSuper ? '' : 'depot-hidden'}" data-label="Depot">${depotDisplay}</td>
      <td class="col-date" data-label="Date">${schedule.scheduleDate}</td>
      <td class="col-departure" data-label="Planned Departure">${schedule.departureTime}</td>
      <td class="col-actual-departure" data-label="Actual Departure">${formatTimestamp(schedule.actualDepartureTime)}</td>
      <td class="col-arrival" data-label="Planned Arrival">${schedule.arrivalTime}</td>
      <td class="col-actual-arrival" data-label="Actual Arrival">${formatTimestamp(schedule.actualArrivalTime)}</td>
      <td class="col-performance" data-label="Performance">${formatPerformance(schedule)}</td>
      <td class="col-status" data-label="Status">
        <span class="status-badge ${statusClass}">${schedule.status}</span>
      </td>
      <td class="col-actions" data-label="Actions">
        <div class="actions-cell">${actionsHtml}</div>
      </td>
    `;
        tableBody.appendChild(tr);
    });

    document.querySelectorAll('.action-icon-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const scheduleId = e.currentTarget.dataset.id;
            handleAction(action, scheduleId);
        });
    });
}

function resolveBusinessDriverId(driverId) {
    if (allDrivers.some(d => d.driverId === driverId)) return driverId;
    const matched = allDrivers.find(d => d.id === driverId);
    return matched ? matched.driverId : driverId;
}

// ---------- ACTION DISPATCHER ----------
async function handleAction(action, scheduleId) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) return;

    switch (action) {
        case 'edit': openEditScheduleModal(scheduleId); break;
        case 'delete': showDeleteConfirmation(scheduleId); break;
        case 'view-map': openMapModal(schedule); break;
        case 'start-trip': await startTrip(schedule); break;
        case 'complete-trip': await completeTrip(schedule); break;
    }
}

// ---------- START / COMPLETE TRIP ----------
async function startTrip(schedule) {
    if (schedule.status !== 'Scheduled') return;
    try {
        const actualDepartureTime = new Date().toISOString();
        await updateScheduleInFirestore(schedule.id, {
            status: 'In Progress',
            actualDepartureTime
        });
        await logActivity('Trip Started', schedule.id, schedule);
        notifyTripStarted({ ...schedule, actualDepartureTime });
        await refreshSchedules();
        applyFiltersAndRender();
        updateKPIs();
        showToast('Trip started.', 'success');
    } catch (err) {
        showToast('Start trip failed: ' + err.message, 'error');
    }
}

async function completeTrip(schedule) {
    if (schedule.status !== 'In Progress') return;
    try {
        const actualArrivalTime = new Date().toISOString();
        const [hours, minutes] = schedule.arrivalTime.split(':').map(Number);
        const plannedDate = new Date(schedule.scheduleDate + 'T00:00:00');
        plannedDate.setHours(hours, minutes, 0, 0);
        const plannedArrival = plannedDate.getTime();
        const actualArrival = new Date(actualArrivalTime).getTime();
        const delayMinutes = Math.round((actualArrival - plannedArrival) / 60000);
        let status;
        if (delayMinutes <= 0) status = 'On Time';
        else status = 'Delayed';

        await updateScheduleInFirestore(schedule.id, {
            status,
            actualArrivalTime,
            delayMinutes
        });
        await logActivity('Trip Completed', schedule.id, schedule);
        notifyTripCompleted({ ...schedule, status, actualArrivalTime, delayMinutes });
        await refreshSchedules();
        applyFiltersAndRender();
        updateKPIs();
        showToast(`Trip completed. Status: ${status}.`, 'success');
    } catch (err) {
        showToast('Complete trip failed: ' + err.message, 'error');
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
    if (activeFilters.date) {
        html += `<span class="filter-tag">Date: ${activeFilters.date}
      <button class="filter-tag-close" data-filter="date">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button></span>`;
    }
    if (activeFilters.depot !== 'all') {
        html += `<span class="filter-tag">Depot: ${activeFilters.depot}
      <button class="filter-tag-close" data-filter="depot">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button></span>`;
    }
    if (activeFilters.status !== 'all' || activeFilters.date || activeFilters.depot !== 'all') {
        html += `<button class="filter-clear-all" id="clearAllFilters">Clear All</button>`;
    }

    activeFiltersContainer.innerHTML = html;

    document.querySelectorAll('.filter-tag-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = e.currentTarget.dataset.filter;
            if (type === 'status') {
                activeFilters.status = 'all';
                statusFilter.value = 'all';
            } else if (type === 'date') {
                activeFilters.date = '';
                dateFilter.value = '';
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
            activeFilters = { search: '', status: 'all', date: '', depot: 'all' };
            searchInput.value = '';
            searchClear.style.display = 'none';
            statusFilter.value = 'all';
            dateFilter.value = '';
            if (depotFilter) depotFilter.value = 'all';
            applyFiltersAndRender();
        });
    }
}

function updateResultsCount(count) {
    if (resultsCount) resultsCount.textContent = count;
}

// ---------- KPI UPDATE ----------
function updateKPIs() {
    const today = new Date().toISOString().slice(0, 10);
    const total = schedules.length;
    const todayTrips = schedules.filter(s => s.scheduleDate === today).length;
    const active = schedules.filter(s => s.status === 'In Progress').length;
    const onTime = schedules.filter(s => s.status === 'On Time').length;
    const delayed = schedules.filter(s => s.status === 'Delayed').length;

    document.getElementById('kpiTotal').textContent = total;
    document.getElementById('kpiToday').textContent = todayTrips;
    document.getElementById('kpiActive').textContent = active;
    document.getElementById('kpiOnTime').textContent = onTime;
    document.getElementById('kpiDelayed').textContent = delayed;
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
    dateFilter.addEventListener('change', (e) => {
        activeFilters.date = e.target.value;
        applyFiltersAndRender();
    });
    if (depotFilter) {
        depotFilter.addEventListener('change', (e) => {
            activeFilters.depot = e.target.value;
            applyFiltersAndRender();
        });
    }

    addScheduleBtn.addEventListener('click', openAddScheduleModal);

    scheduleModalCloseBtn.addEventListener('click', closeScheduleModal);
    scheduleModalCancelBtn.addEventListener('click', closeScheduleModal);
    scheduleModalOverlay.addEventListener('click', (e) => {
        if (e.target === scheduleModalOverlay) closeScheduleModal();
    });

    scheduleForm.addEventListener('submit', handleScheduleFormSubmit);

    deleteModalCancelBtn.addEventListener('click', closeDeleteModal);
    deleteModalOverlay.addEventListener('click', (e) => {
        if (e.target === deleteModalOverlay) closeDeleteModal();
    });
    deleteModalConfirmBtn.addEventListener('click', handleDeleteSchedule);

    if (emptyStateClearBtn) {
        emptyStateClearBtn.addEventListener('click', () => {
            activeFilters = { search: '', status: 'all', date: '', depot: 'all' };
            searchInput.value = '';
            searchClear.style.display = 'none';
            statusFilter.value = 'all';
            dateFilter.value = '';
            if (depotFilter) depotFilter.value = 'all';
            applyFiltersAndRender();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeScheduleModal();
            closeDeleteModal();
        }
    });

    const driverSelect = document.getElementById('driverSelect');
    const routeSelect = document.getElementById('routeSelect');
    if (driverSelect && routeSelect) {
        driverSelect.addEventListener('change', () => {
            const driverId = driverSelect.value;
            if (driversMap[driverId]?.assignedRouteId) {
                routeSelect.value = driversMap[driverId].assignedRouteId;
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await logout();
        });
    }
}

// ---------- MODAL HANDLERS ----------
function openAddScheduleModal() {
    editScheduleId = null;
    scheduleForm.reset();
    clearFormErrors();
    document.getElementById('scheduleId').disabled = false;
    scheduleModalTitle.textContent = 'Add Schedule';
    scheduleSubmitBtnText.textContent = 'Save Schedule';

    if (depotSelect) depotSelect.value = '';
    // Reset dropdowns to show all (no depot filter active)
    populateDropdowns();

    scheduleModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function openEditScheduleModal(scheduleId) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) return;

    editScheduleId = scheduleId;
    scheduleForm.reset();
    clearFormErrors();

    // Depot-aware dropdown filtering
    if (depotSelect && currentUser.role === 'superadmin') {
        depotSelect.value = schedule.depotId;
        updateDropdownsByDepot(schedule.depotId, {
            driverId: schedule.driverId,
            routeId: schedule.routeId,
            vehicleId: schedule.vehicleId
        });
    } else {
        // Admin sees their own depot, just ensure dropdowns are populated
        populateDropdowns();
    }

    document.getElementById('scheduleId').value = schedule.id;
    document.getElementById('scheduleId').disabled = true;
    document.getElementById('driverSelect').value = resolveBusinessDriverId(schedule.driverId);
    document.getElementById('routeSelect').value = schedule.routeId;
    document.getElementById('vehicleSelect').value = schedule.vehicleId;
    document.getElementById('scheduleDate').value = schedule.scheduleDate;
    document.getElementById('departureTime').value = schedule.departureTime;
    document.getElementById('arrivalTime').value = schedule.arrivalTime;
    document.getElementById('scheduleStatus').value = schedule.status;

    scheduleModalTitle.textContent = 'Edit Schedule';
    scheduleSubmitBtnText.textContent = 'Update Schedule';
    scheduleModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeScheduleModal() {
    scheduleModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    scheduleForm.reset();
    clearFormErrors();
    editScheduleId = null;
    document.getElementById('scheduleId').disabled = false;
}

// ---------- FORM SUBMIT ----------
async function handleScheduleFormSubmit(e) {
    e.preventDefault();

    if (!(await validateScheduleForm())) return;

    const scheduleId = document.getElementById('scheduleId').value.trim();
    const driverId = document.getElementById('driverSelect').value;
    const routeId = document.getElementById('routeSelect').value;
    const vehicleId = document.getElementById('vehicleSelect').value;
    const scheduleDate = document.getElementById('scheduleDate').value;
    const departureTime = document.getElementById('departureTime').value;
    const arrivalTime = document.getElementById('arrivalTime').value;
    const status = document.getElementById('scheduleStatus').value;

    let depotId;
    if (currentUser.role === 'superadmin') {
        depotId = depotSelect.value;
    } else {
        depotId = currentUser.depotId;
    }

    const driverDepot = driversMap[driverId]?.depotId;
    const routeDepot = routesMap[routeId]?.depotId;
    const vehicleDepot = vehiclesMap[vehicleId]?.depotId;

    if (driverDepot && driverDepot !== depotId) {
        showToast('Selected driver does not belong to the chosen depot.', 'error');
        return;
    }
    if (routeDepot && routeDepot !== depotId) {
        showToast('Selected route does not belong to the chosen depot.', 'error');
        return;
    }
    if (vehicleDepot && vehicleDepot !== depotId) {
        showToast('Selected vehicle does not belong to the chosen depot.', 'error');
        return;
    }

    const scheduleData = {
        driverId,
        routeId,
        vehicleId,
        scheduleDate,
        departureTime,
        arrivalTime,
        status,
        depotId
    };

    scheduleSubmitBtn.classList.add('loading');
    scheduleSubmitBtn.disabled = true;

    try {
        if (editScheduleId) {
            await updateScheduleInFirestore(editScheduleId, scheduleData);
            await logActivity('Schedule Updated', scheduleId, scheduleData);
            notifyScheduleUpdated({ ...scheduleData, id: editScheduleId });
            showToast('Schedule updated successfully.', 'success');
        } else {
            await createScheduleInFirestore(scheduleId, scheduleData);
            await logActivity('Schedule Created', scheduleId, scheduleData);
            notifyScheduleAssigned({ ...scheduleData, id: scheduleId });
            showToast('Schedule created successfully.', 'success');
        }

        await refreshSchedules();
        applyFiltersAndRender();
        updateKPIs();

        // ✅ FIX: destructure detectAndGenerateConflicts return value to avoid iterable error
        const { created, reopened } = await detectAndGenerateConflicts();
        const allNewConflicts = [...created, ...reopened];
        for (const conflict of allNewConflicts) {
            showConflictToast(conflict);
            await notifyConflictDetected(conflict);
        }

        closeScheduleModal();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    } finally {
        scheduleSubmitBtn.classList.remove('loading');
        scheduleSubmitBtn.disabled = false;
    }
}

// ---------- DELETE CONFIRMATION ----------
function showDeleteConfirmation(scheduleId) {
    pendingDeleteId = scheduleId;
    deleteModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeDeleteModal() {
    deleteModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    pendingDeleteId = null;
}

// ---------- DELETE ----------
async function handleDeleteSchedule() {
    if (!pendingDeleteId) return;

    deleteModalConfirmBtn.disabled = true;
    try {
        const schedule = schedules.find(s => s.id === pendingDeleteId);
        await deleteScheduleFromFirestore(pendingDeleteId);
        if (schedule) await logActivity('Schedule Deleted', pendingDeleteId, schedule);
        showToast(`Schedule ${pendingDeleteId} deleted.`, 'info');
        await refreshSchedules();
        applyFiltersAndRender();
        updateKPIs();

        // ✅ FIX: run conflict detection after deletion to auto‑resolve any orphaned conflicts
        const { created, reopened } = await detectAndGenerateConflicts();
        const allNewConflicts = [...created, ...reopened];
        for (const conflict of allNewConflicts) {
            showConflictToast(conflict);
            await notifyConflictDetected(conflict);
        }

        closeDeleteModal();
    } catch (error) {
        showToast('Deletion failed: ' + error.message, 'error');
    } finally {
        deleteModalConfirmBtn.disabled = false;
    }
}

// ---------- VALIDATION ----------
async function validateScheduleForm() {
    let isValid = true;
    clearFormErrors();

    const scheduleId = document.getElementById('scheduleId').value.trim();
    const driver = document.getElementById('driverSelect').value;
    const route = document.getElementById('routeSelect').value;
    const vehicle = document.getElementById('vehicleSelect').value;
    const date = document.getElementById('scheduleDate').value;
    const departure = document.getElementById('departureTime').value;
    const arrival = document.getElementById('arrivalTime').value;
    const status = document.getElementById('scheduleStatus').value;

    if (currentUser.role === 'superadmin') {
        const depot = depotSelect.value;
        if (!depot) {
            showError('depotSelectError', 'Depot is required.');
            isValid = false;
        }
    }

    if (!scheduleId) { showError('scheduleIdError', 'Schedule ID is required.'); isValid = false; }
    if (!driver) { showError('driverSelectError', 'Driver is required.'); isValid = false; }
    if (!route) { showError('routeSelectError', 'Route is required.'); isValid = false; }
    if (!vehicle) { showError('vehicleSelectError', 'Vehicle is required.'); isValid = false; }
    if (!date) { showError('scheduleDateError', 'Date is required.'); isValid = false; }
    if (!departure) { showError('departureTimeError', 'Departure time is required.'); isValid = false; }
    if (!arrival) { showError('arrivalTimeError', 'Arrival time is required.'); isValid = false; }
    if (!status) { showError('scheduleStatusError', 'Status is required.'); isValid = false; }

    if (!editScheduleId && scheduleId) {
        const exists = schedules.some(s => s.id === scheduleId);
        if (exists) { showError('scheduleIdError', 'A schedule with this ID already exists.'); isValid = false; }
    }

    return isValid;
}

function showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) { el.textContent = message; el.style.display = 'block'; }
}

function clearFormErrors() {
    document.querySelectorAll('.form-error').forEach(el => {
        el.textContent = '';
        el.style.display = 'none';
    });
}

// ---------- CONFLICT TOAST ----------
function injectConflictToastStyles() {
    if (document.getElementById('conflict-toast-styles-schedules')) return;
    const style = document.createElement('style');
    style.id = 'conflict-toast-styles-schedules';
    style.textContent = `
        .conflict-toast-container { position: fixed; bottom: 2rem; right: 2rem; z-index: 10000; display: flex; flex-direction: column; gap: 0.75rem; pointer-events: none; }
        .conflict-toast { background: rgba(15, 20, 40, 0.85); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 1rem 1.25rem; display: flex; align-items: center; gap: 0.75rem; color: white; box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3); pointer-events: auto; animation: toastSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1); min-width: 320px; max-width: 420px; font-family: 'Outfit', sans-serif; }
        @keyframes toastSlideIn { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .toast-icon { font-size: 1.6rem; line-height: 1; }
        .toast-content { flex: 1; min-width: 0; }
        .toast-title { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.2rem; }
        .toast-message { font-size: 0.85rem; opacity: 0.85; white-space: normal; }
        .toast-action { background: rgba(79, 124, 255, 0.2); border: 1px solid rgba(79, 124, 255, 0.5); color: white; padding: 0.4rem 0.9rem; border-radius: 12px; font-size: 0.8rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background 0.2s; }
        .toast-action:hover { background: rgba(79, 124, 255, 0.4); }
        .toast-close { background: none; border: none; color: rgba(255, 255, 255, 0.6); font-size: 1.4rem; cursor: pointer; padding: 0 0.2rem; line-height: 1; }
        @media (max-width: 768px) { .conflict-toast-container { right: 1rem; left: 1rem; bottom: 1rem; } .conflict-toast { min-width: auto; max-width: 100%; } }
    `;
    document.head.appendChild(style);
}

function showConflictToast(conflict) {
    injectConflictToastStyles();
    let container = document.querySelector('.conflict-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'conflict-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'conflict-toast';
    toast.innerHTML = `
        <div class="toast-icon">⚠️</div>
        <div class="toast-content">
            <div class="toast-title">Conflict Detected</div>
            <div class="toast-message">${conflict.type || 'Conflict'} – ${conflict.affectedResource || 'resource'}</div>
        </div>
        <button class="toast-action">View Conflict</button>
        <button class="toast-close" aria-label="Close">×</button>
    `;
    const viewBtn = toast.querySelector('.toast-action');
    const closeBtn = toast.querySelector('.toast-close');

    viewBtn.addEventListener('click', () => {
        window.location.href = `conflicts.html?id=${conflict.id}`;
    });
    closeBtn.addEventListener('click', () => {
        toast.remove();
    });

    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 6000);
}

// ---------- ACTIVITY LOGGING ----------
async function logActivity(action, scheduleId, scheduleData) {
    try {
        await createActivityLog({
            action,
            performedBy: currentUser.name,
            performedByName: currentUser.name,
            targetId: scheduleId,
            targetType: 'schedule',
            driverId: scheduleData.driverId,
            routeId: scheduleData.routeId,
            vehicleId: scheduleData.vehicleId
        });
    } catch (err) {
        console.warn('Activity logging failed:', err);
    }
}

// ---------- TOAST SYSTEM ----------
function injectToastStyles() {
    if (document.getElementById('toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
    .toast-container { position: fixed; top: 1.5rem; right: 1.5rem; z-index: 9999; display: flex; flex-direction: column; gap: 0.8rem; pointer-events: none; }
    .toast { background: rgba(255,255,255,0.15); backdrop-filter: blur(40px) saturate(180%); -webkit-backdrop-filter: blur(40px) saturate(180%); border: 1px solid rgba(255,255,255,0.3); border-radius: 20px; padding: 1rem 1.5rem; box-shadow: 0 12px 30px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.2); color: var(--text-dark); font-weight: 500; display: flex; align-items: center; gap: 0.6rem; pointer-events: auto; animation: slideInRight 0.3s ease; min-width: 250px; }
    .toast.success { background: rgba(16,185,129,0.2); color: #065f46; }
    .toast.error   { background: rgba(239,68,68,0.15); color: #991b1b; }
    .toast.info    { background: rgba(79,124,255,0.15); color: #1e0a5c; }
    @keyframes slideInRight { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
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