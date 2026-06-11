/* ============================================================
   ROUTEX TRANSIT — REPORTS MODULE
   Enterprise-grade fleet reports with PDF export
   ============================================================ */

// ---------- IMPORTS ----------
import {
    generateFuelReport,
    generateMaintenanceReport,
    generateVehicleUtilizationReport,
    generateRoutePerformanceReport,
    getAllFuelLogs,
    getAllMaintenanceLogs,
    getAllVehicles,
    getAllRoutes,
    getAllSchedules,
    getAllDepots                    // NEW: superadmin depot filter & column name lookup
} from '../firebase/firestore-service.js'
import { initRBAC } from './rbac-loader.js';          // centralised RBAC init
import { logout } from '../firebase/auth-service.js'; // centralised logout

// ---------- DOM READY ----------
document.addEventListener('DOMContentLoaded', () => {
    initPage();
});

// ---------- GLOBAL STATE ----------
let currentTab = 'fuel';
let currentReportData = null; // Store the generated report object for PDF export
let vehiclesCache = [];
let routesCache = [];
let fuelLogsCache = [];
let maintenanceLogsCache = [];
let schedulesCache = [];
let currentUserRole = null;
let currentUserDepotId = null;

// SUPERADMIN DEPOT FILTER
let activeDepotFilter = null;          // depotId selected in filter, null = all
let depotsMap = {};                    // { depotId: depotName } – cached depot names

// ---------- INITIALIZATION ----------
async function initPage() {
    // 1. Authenticate, render role‑filtered sidebar, get user data
    const user = await initRBAC('reports');
    if (!user) return;   // initRBAC handles redirects

    // 2. Store RBAC context globally for all data operations
    currentUserRole = user.role;
    currentUserDepotId = user.depotId || null;   // null for superadmin (no depot filter)

    // 3. Load depot names (needed for depot column and superadmin filter)
    try {
        const allDepots = await getAllDepots();
        allDepots.forEach(d => depotsMap[d.id] = d.depotName || d.id);
    } catch (err) {
        console.error('Failed to load depots', err);
    }

    // 4. Build superadmin depot filter (injected dynamically)
    buildDepotFilter();

    // 5. Populate topbar with user info
    document.getElementById('displayName').textContent = user.name;
    const roleEl = document.getElementById('displayRole');
    roleEl.textContent = user.role;
    roleEl.className = `role-badge role-${user.role.toLowerCase()}`;

    // 6. Date / time display & update interval
    updateDateTime();
    setInterval(updateDateTime, 60000);

    // 7. Sidebar toggle (mobile) – purely UI, not RBAC
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    const overlay = document.getElementById('sidebarOverlay');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (overlay) overlay.classList.toggle('active');
        });
    }
    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }

    // 8. Initialise animations & load report data
    AOS.init({ once: true });
    await preloadReferenceData();
    populateFilters();
    attachEventListeners();
    // Activate first tab
    switchTab('fuel');
}

// ---------- SUPERADMIN DEPOT FILTER (injected dynamically) ----------
function buildDepotFilter() {
    if (currentUserRole !== 'superadmin') return;

    const filterRow = document.querySelector('.filter-bar-row');
    if (!filterRow) return;

    // Prevent duplicate injection
    if (document.getElementById('depotFilterGroup')) return;

    const div = document.createElement('div');
    div.className = 'filter-group';
    div.id = 'depotFilterGroup';
    div.innerHTML = `
        <label class="filter-label" for="depotFilterSelect">Depot</label>
        <select class="filter-select" id="depotFilterSelect">
            <option value="">All Depots</option>
        </select>
    `;
    // Insert after the vehicle filter group (or at end)
    const vehicleGroup = document.getElementById('vehicleFilterSelect')?.closest('.filter-group');
    if (vehicleGroup) {
        vehicleGroup.after(div);
    } else {
        filterRow.appendChild(div);
    }

    // Populate options
    const select = document.getElementById('depotFilterSelect');
    for (const [id, name] of Object.entries(depotsMap)) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        select.appendChild(option);
    }

    // Listen for changes
    select.addEventListener('change', () => {
        activeDepotFilter = select.value || null;   // '' → null (all depots)
        // Clear caches to force re‑fetch with new filter
        vehiclesCache = [];
        routesCache = [];
        fuelLogsCache = [];
        maintenanceLogsCache = [];
        schedulesCache = [];
        loadReportByType(currentTab);
    });
}

// ---------- DATE/TIME ----------
function updateDateTime() {
    const el = document.getElementById('dateTimeText');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleString('en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// ---------- PRELOAD REFERENCE DATA (DEPOT‑AWARE) ----------
async function preloadReferenceData() {
    const depotForFetch = (currentUserRole === 'superadmin') ? activeDepotFilter : currentUserDepotId;
    try {
        const [vehicles, routes] = await Promise.all([
            getAllVehicles({ role: currentUserRole, depotId: depotForFetch }),
            getAllRoutes({ role: currentUserRole, depotId: depotForFetch })
        ]);
        vehiclesCache = vehicles;
        routesCache = routes;
    } catch (err) {
        console.error('Failed to load reference data', err);
        showToast('Failed to load filters', 'error');
    }
}

// ---------- POPULATE FILTER DROPDOWNS ----------
function populateFilters() {
    const vehicleSelect = document.getElementById('vehicleFilterSelect');
    const routeSelect = document.getElementById('routeFilterSelect');
    if (vehicleSelect) {
        vehicleSelect.innerHTML = '<option value="">All Vehicles</option>';
        vehiclesCache.forEach(v => {
            const option = document.createElement('option');
            option.value = v.id;
            option.textContent = `${v.id} (${v.registrationNo || 'N/A'})`;
            vehicleSelect.appendChild(option);
        });
    }
    if (routeSelect) {
        routeSelect.innerHTML = '<option value="">All Routes</option>';
        routesCache.forEach(r => {
            const option = document.createElement('option');
            option.value = r.id;
            option.textContent = `${r.id} - ${r.startPoint || ''} → ${r.endPoint || ''}`;
            routeSelect.appendChild(option);
        });
    }
    // Depot filter is already built, no need to repopulate here.
}

// ---------- ATTACH EVENT LISTENERS ----------
function attachEventListeners() {
    // Tabs
    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            if (tabName) switchTab(tabName);
        });
    });

    // Generate button – explicitly request toast
    document.getElementById('btnGenerateReport')?.addEventListener('click', () => {
        loadReportByType(currentTab, { showSuccessToast: true });
    });

    // Refresh button – no toast
    document.getElementById('btnRefreshData')?.addEventListener('click', async () => {
        await preloadReferenceData();
        populateFilters();
        loadReportByType(currentTab);
    });

    // Export PDF
    document.getElementById('btnExportPdf')?.addEventListener('click', () => {
        exportPDF();
    });

    // Filter changes - update active tags & auto-reload? (optional)
    document.getElementById('reportTypeSelect')?.addEventListener('change', (e) => {
        const type = e.target.value;
        switchTab(type);
    });

    // Clear filters button (if we add dynamic tags)
    document.getElementById('activeFilterTags')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-clear-all')) {
            clearFilters();
        } else if (e.target.classList.contains('filter-tag-close')) {
            const tag = e.target.closest('.filter-tag');
            if (tag) tag.remove();
            // Reset corresponding filter
            const filterType = tag.dataset.filterType;
            if (filterType === 'vehicle') document.getElementById('vehicleFilterSelect').value = '';
            else if (filterType === 'route') document.getElementById('routeFilterSelect').value = '';
            else if (filterType === 'date') {
                document.getElementById('dateRangeStart').value = '';
                document.getElementById('dateRangeEnd').value = '';
            }
            updateActiveFilterTags();
        }
    });

    // Logout – uses centralised auth‑service
    document.getElementById('sidebarLogoutBtn')?.addEventListener('click', () => {
        logout();
    });

    // Notification bell (basic)
    const bell = document.getElementById('notificationBell');
    const dropdown = document.getElementById('notificationDropdown');
    bell?.addEventListener('click', () => dropdown?.classList.toggle('open'));
}

function clearFilters() {
    document.getElementById('vehicleFilterSelect').value = '';
    document.getElementById('routeFilterSelect').value = '';
    document.getElementById('dateRangeStart').value = '';
    document.getElementById('dateRangeEnd').value = '';
    updateActiveFilterTags();
}

function updateActiveFilterTags() {
    const container = document.getElementById('activeFilterTags');
    if (!container) return;
    const vehicle = document.getElementById('vehicleFilterSelect')?.value;
    const route = document.getElementById('routeFilterSelect')?.value;
    const start = document.getElementById('dateRangeStart')?.value;
    const end = document.getElementById('dateRangeEnd')?.value;
    let tagsHTML = '';
    if (vehicle) tagsHTML += `<span class="filter-tag" data-filter-type="vehicle">Vehicle: ${vehicle} <button class="filter-tag-close">✕</button></span>`;
    if (route) tagsHTML += `<span class="filter-tag" data-filter-type="route">Route: ${route} <button class="filter-tag-close">✕</button></span>`;
    if (start || end) tagsHTML += `<span class="filter-tag" data-filter-type="date">Date: ${start || '...'} → ${end || '...'} <button class="filter-tag-close">✕</button></span>`;
    if (tagsHTML) tagsHTML += `<button class="filter-clear-all">Clear All</button>`;
    container.innerHTML = tagsHTML;
}

// ---------- TAB SWITCHING ----------
function switchTab(tabName) {
    currentTab = tabName;
    // Update tabs UI
    document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab${capitalize(tabName)}`)?.classList.add('active');
    // Update panels
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`${tabName}Panel`)?.classList.add('active');
    // Sync dropdown
    const typeSelect = document.getElementById('reportTypeSelect');
    if (typeSelect) typeSelect.value = tabName;
    // Load data
    loadReportByType(tabName);
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- LOAD REPORT DATA ----------
async function loadReportByType(type, { showSuccessToast = false } = {}) {
    // Show skeleton, hide others
    showLoading(type);
    try {
        // Fetch raw data for tables & apply filters
        await fetchRawDataIfNeeded(type);
        const filteredData = applyFilters(type);
        // Generate summary reports using service functions
        const report = await generateReportByType(type);
        currentReportData = { ...report, filteredTableData: filteredData };
        // Update header stats
        updateHeaderStats(report, type);
        // Render KPI cards and table
        renderKPIs(type, report);
        renderTable(type, filteredData);
        // Hide skeleton
        hideLoading(type);
        // Only show toast for explicit user actions (Generate Report button click)
        if (showSuccessToast) {
            showToast('Report generated successfully', 'success');
        }
    } catch (error) {
        console.error(`Failed to load ${type} report:`, error);
        showError(type, error.message);
        hideLoading(type);
    }
}

async function fetchRawDataIfNeeded(type) {
    const depotForFetch = (currentUserRole === 'superadmin') ? activeDepotFilter : currentUserDepotId;
    switch (type) {
        case 'fuel':
            if (!fuelLogsCache.length)
                fuelLogsCache = await getAllFuelLogs({ role: currentUserRole, depotId: depotForFetch });
            break;
        case 'maintenance':
            if (!maintenanceLogsCache.length)
                maintenanceLogsCache = await getAllMaintenanceLogs({ role: currentUserRole, depotId: depotForFetch });
            break;
        case 'utilization':
            if (!schedulesCache.length)
                schedulesCache = await getAllSchedules({ role: currentUserRole, depotId: depotForFetch });
            if (!vehiclesCache.length)
                vehiclesCache = await getAllVehicles({ role: currentUserRole, depotId: depotForFetch });
            break;
        case 'route':
            if (!schedulesCache.length)
                schedulesCache = await getAllSchedules({ role: currentUserRole, depotId: depotForFetch });
            if (!routesCache.length)
                routesCache = await getAllRoutes({ role: currentUserRole, depotId: depotForFetch });
            break;
    }
}

function applyFilters(type) {
    const vehicleFilter = document.getElementById('vehicleFilterSelect')?.value || '';
    const routeFilter = document.getElementById('routeFilterSelect')?.value || '';
    const startDate = document.getElementById('dateRangeStart')?.value ? new Date(document.getElementById('dateRangeStart').value) : null;
    const endDate = document.getElementById('dateRangeEnd')?.value ? new Date(document.getElementById('dateRangeEnd').value) : null;

    let data = [];
    switch (type) {
        case 'fuel':
            data = fuelLogsCache.slice();
            if (vehicleFilter) data = data.filter(log => log.vehicleId === vehicleFilter);
            if (startDate) data = data.filter(log => log.fuelDate && new Date(log.fuelDate) >= startDate);
            if (endDate) data = data.filter(log => log.fuelDate && new Date(log.fuelDate) <= endDate);
            return data;
        case 'maintenance':
            data = maintenanceLogsCache.slice();
            if (vehicleFilter) data = data.filter(log => log.vehicleId === vehicleFilter);
            if (startDate) data = data.filter(log => log.serviceDate && new Date(log.serviceDate) >= startDate);
            if (endDate) data = data.filter(log => log.serviceDate && new Date(log.serviceDate) <= endDate);
            return data;
        case 'utilization':
            // utilization table: vehicles with trip counts
            if (!schedulesCache.length || !vehiclesCache.length) return [];
            const counts = {};
            vehiclesCache.forEach(v => counts[v.id] = 0);
            schedulesCache.forEach(s => {
                if (s.vehicleId && counts.hasOwnProperty(s.vehicleId)) counts[s.vehicleId]++;
            });
            let utilRows = vehiclesCache.map(v => ({
                vehicleId: v.id,
                registrationNo: v.registrationNo || '—',
                tripCount: counts[v.id] || 0,
                status: v.status || '—',
                depotId: v.depotId                     // <-- for Depot column
            }));
            if (vehicleFilter) utilRows = utilRows.filter(r => r.vehicleId === vehicleFilter);
            return utilRows;
        case 'route':
            if (!schedulesCache.length || !routesCache.length) return [];
            const routeCounts = {};
            routesCache.forEach(r => routeCounts[r.id] = 0);
            schedulesCache.forEach(s => {
                if (s.routeId && routeCounts.hasOwnProperty(s.routeId)) routeCounts[s.routeId]++;
            });
            let routeRows = routesCache.map(r => ({
                routeId: r.id,
                startPoint: r.startPoint || '—',
                endPoint: r.endPoint || '—',
                distance: r.distance || '—',
                tripCount: routeCounts[r.id] || 0,
                depotId: r.depotId                     // <-- for Depot column
            }));
            if (routeFilter) routeRows = routeRows.filter(r => r.routeId === routeFilter);
            return routeRows;
        default: return [];
    }
}

async function generateReportByType(type) {
    const depotForFetch = (currentUserRole === 'superadmin') ? activeDepotFilter : currentUserDepotId;
    switch (type) {
        case 'fuel':
            return await generateFuelReport(currentUserRole, depotForFetch);
        case 'maintenance':
            return await generateMaintenanceReport(currentUserRole, depotForFetch);
        case 'utilization':
            return await generateVehicleUtilizationReport(currentUserRole, depotForFetch);
        case 'route':
            return await generateRoutePerformanceReport(currentUserRole, depotForFetch);
        default:
            throw new Error('Unknown report type');
    }
}

// ---------- HEADER STATS ----------
function updateHeaderStats(report, type) {
    document.getElementById('headerTotalReports').textContent = '4'; // static
    document.getElementById('headerDataSources').textContent = '4';
    const lastGenEl = document.getElementById('headerLastGenerated');
    if (lastGenEl) {
        lastGenEl.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
}

// ---------- KPI RENDERING ----------
function renderKPIs(type, report) {
    const container = document.getElementById(`${type}KpiGrid`);
    if (!container) return;
    let cardsHTML = '';
    switch (type) {
        case 'fuel':
            cardsHTML = `
        <div class="stat-card"><div class="stat-icon-wrap">⛽</div><div class="stat-body"><span class="stat-label">Total Fuel Logs</span><span class="stat-value">${report.totalFuelLogs}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">⛽</div><div class="stat-body"><span class="stat-label">Total Fuel Amount (L)</span><span class="stat-value">${report.totalFuelAmount.toFixed(1)}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">💰</div><div class="stat-body"><span class="stat-label">Total Fuel Cost ($)</span><span class="stat-value">${report.totalFuelCost.toFixed(2)}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">📊</div><div class="stat-body"><span class="stat-label">Avg Cost per L ($)</span><span class="stat-value">${report.averageFuelCost.toFixed(2)}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">🔥</div><div class="stat-body"><span class="stat-label">Most Consumed Vehicle</span><span class="stat-value">${report.mostFuelConsumedVehicle || 'N/A'}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">💧</div><div class="stat-body"><span class="stat-label">Least Consumed Vehicle</span><span class="stat-value">${report.leastFuelConsumedVehicle || 'N/A'}</span></div></div>
      `;
            break;
        case 'maintenance':
            cardsHTML = `
        <div class="stat-card"><div class="stat-icon-wrap">🔧</div><div class="stat-body"><span class="stat-label">Total Records</span><span class="stat-value">${report.totalMaintenanceRecords}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">📅</div><div class="stat-body"><span class="stat-label">Scheduled</span><span class="stat-value">${report.scheduledMaintenance}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">⏳</div><div class="stat-body"><span class="stat-label">In Progress</span><span class="stat-value">${report.inProgressMaintenance}</span></div></div>
        <div class="stat-card stat-card--success"><div class="stat-icon-wrap">✅</div><div class="stat-body"><span class="stat-label">Completed</span><span class="stat-value">${report.completedMaintenance}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">❌</div><div class="stat-body"><span class="stat-label">Cancelled</span><span class="stat-value">${report.cancelledMaintenance}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">💰</div><div class="stat-body"><span class="stat-label">Total Cost ($)</span><span class="stat-value">${report.totalMaintenanceCost.toFixed(2)}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">🏆</div><div class="stat-body"><span class="stat-label">Highest Cost Vehicle</span><span class="stat-value">${report.highestCostVehicle || 'N/A'}</span></div></div>
      `;
            break;
        case 'utilization':
            cardsHTML = `
        <div class="stat-card"><div class="stat-icon-wrap">🚌</div><div class="stat-body"><span class="stat-label">Total Vehicles</span><span class="stat-value">${report.totalVehicles}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">🏆</div><div class="stat-body"><span class="stat-label">Most Used Vehicle</span><span class="stat-value">${report.mostUsedVehicle || 'N/A'}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">💤</div><div class="stat-body"><span class="stat-label">Least Used Vehicle</span><span class="stat-value">${report.leastUsedVehicle || 'N/A'}</span></div></div>
      `;
            break;
        case 'route':
            cardsHTML = `
        <div class="stat-card"><div class="stat-icon-wrap">🗺️</div><div class="stat-body"><span class="stat-label">Total Routes</span><span class="stat-value">${report.totalRoutes}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">📅</div><div class="stat-body"><span class="stat-label">Total Schedules</span><span class="stat-value">${report.totalSchedules}</span></div></div>
        <div class="stat-card stat-card--success"><div class="stat-icon-wrap">✅</div><div class="stat-body"><span class="stat-label">Completed Trips</span><span class="stat-value">${report.completedTrips}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">❌</div><div class="stat-body"><span class="stat-label">Cancelled Trips</span><span class="stat-value">${report.cancelledTrips}</span></div></div>
        <div class="stat-card"><div class="stat-icon-wrap">📌</div><div class="stat-body"><span class="stat-label">Scheduled Trips</span><span class="stat-value">${report.scheduledTrips}</span></div></div>
      `;
            break;
    }
    container.innerHTML = cardsHTML;
}

// ---------- TABLE RENDERING (now includes Depot column) ----------
function renderTable(type, data) {
    const tbody = document.getElementById(`${type}TableBody`);
    const infoEl = document.getElementById(`${type}ResultsInfo`);
    if (!tbody) return;

    // Ensure the table header contains a "Depot" column
    ensureDepotColumnHeader(type);

    let rowsHTML = '';
    data.forEach(row => {
        const depotName = getDepotName(row);   // resolve depotId → name
        if (type === 'fuel') {
            rowsHTML += `<tr>
        <td>${row.fuelId || row.id}</td>
        <td>${row.vehicleId || '—'}</td>
        <td>${row.fuelDate || '—'}</td>
        <td>${row.fuelAmount || 0}</td>
        <td>${row.fuelCost || 0}</td>
        <td>${row.odometerReading || row.vehicleMileageBefore || '—'}</td>
        <td>${row.fuelType || '—'}</td>
        <td class="depot-cell">${depotName}</td>
      </tr>`;
        } else if (type === 'maintenance') {
            rowsHTML += `<tr>
        <td>${row.maintenanceId || row.id}</td>
        <td>${row.vehicleId || '—'}</td>
        <td>${row.maintenanceType || '—'}</td>
        <td>${row.serviceDate || '—'}</td>
        <td>${row.cost || 0}</td>
        <td>${row.status || '—'}</td>
        <td>${row.description || '—'}</td>
        <td class="depot-cell">${depotName}</td>
      </tr>`;
        } else if (type === 'utilization') {
            rowsHTML += `<tr>
        <td>${row.vehicleId}</td>
        <td>${row.registrationNo}</td>
        <td>${row.tripCount}</td>
        <td>${row.status}</td>
        <td class="depot-cell">${depotName}</td>
      </tr>`;
        } else if (type === 'route') {
            rowsHTML += `<tr>
        <td>${row.routeId}</td>
        <td>${row.startPoint}</td>
        <td>${row.endPoint}</td>
        <td>${row.distance}</td>
        <td>${row.tripCount}</td>
        <td class="depot-cell">${depotName}</td>
      </tr>`;
        }
    });
    tbody.innerHTML = rowsHTML || '<tr><td colspan="8" style="text-align:center; color:var(--text-soft)">No records found</td></tr>';
    if (infoEl) infoEl.textContent = `Showing ${data.length} records`;
}

/**
 * Ensure the report table's thead contains a "Depot" column header.
 * Injects a <th> element if missing.
 */
function ensureDepotColumnHeader(type) {
    const table = document.getElementById(`${type}Table`);
    if (!table) return;
    const theadRow = table.querySelector('thead tr');
    if (!theadRow) return;
    // Check if already added
    if (theadRow.querySelector('.depot-col-header')) return;

    const th = document.createElement('th');
    th.className = 'depot-col-header';
    th.textContent = 'Depot';
    theadRow.appendChild(th);
}

/**
 * Resolve the depot name for a given row.
 * Uses the row's depotId if available, otherwise looks up from caches.
 * Returns '—' if no depot can be determined.
 */
function getDepotName(row) {
    let depId = row.depotId;
    if (!depId && row.vehicleId) {
        const vehicle = vehiclesCache.find(v => v.id === row.vehicleId);
        depId = vehicle?.depotId;
    }
    if (!depId && row.routeId) {
        const route = routesCache.find(r => r.id === row.routeId);
        depId = route?.depotId;
    }
    return depId ? (depotsMap[depId] || depId) : '—';
}

// ---------- LOADING / SKELETON STATES ----------
function showLoading(type) {
    const skeleton = document.getElementById(`${type}Skeleton`);
    if (skeleton) skeleton.style.display = 'block';

    const kpiGrid = document.getElementById(`${type}KpiGrid`);
    if (kpiGrid && kpiGrid.parentElement) {
        kpiGrid.parentElement.style.display = 'none';
    }

    const tableSection = document.getElementById(`${type}TableSection`);
    if (tableSection) tableSection.style.display = 'none';

    const emptyState = document.getElementById(`${type}EmptyState`);
    if (emptyState) emptyState.style.display = 'none';

    const errorState = document.getElementById(`${type}ErrorState`);
    if (errorState) errorState.style.display = 'none';
}

function hideLoading(type) {
    const skeleton = document.getElementById(`${type}Skeleton`);
    if (skeleton) skeleton.style.display = 'none';

    const kpiGrid = document.getElementById(`${type}KpiGrid`);
    if (kpiGrid && kpiGrid.parentElement) {
        kpiGrid.parentElement.style.display = '';
    }

    const tableSection = document.getElementById(`${type}TableSection`);
    if (tableSection) tableSection.style.display = '';
}

function showError(type, message) {
    const errorEl = document.getElementById(`${type}ErrorState`);
    const msgEl = document.getElementById(`${type}ErrorMsg`);
    if (errorEl) errorEl.style.display = 'flex';
    if (msgEl) msgEl.textContent = message;

    const emptyState = document.getElementById(`${type}EmptyState`);
    if (emptyState) emptyState.style.display = 'none';
}

// ---------- TOAST ----------
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ---------- PDF EXPORT (using jsPDF + html2canvas + autoTable) ----------
async function exportPDF() {
    if (!currentReportData) {
        showToast('No report data to export. Generate a report first.', 'error');
        return;
    }
    try {
        showToast('Generating PDF...', 'info');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;
        let yPos = margin;

        // ---- Logo / Header ----
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(108, 34, 245);
        doc.text('RouteX', margin, yPos);
        doc.setFontSize(12);
        doc.setTextColor(100, 100, 100);
        doc.text('Transit Management System', margin, yPos + 6);
        yPos += 14;

        // ---- Report Title ----
        doc.setFontSize(16);
        doc.setTextColor(30, 10, 60);
        const reportTypeName = {
            fuel: 'Fuel Analytics Report',
            maintenance: 'Maintenance Analytics Report',
            utilization: 'Vehicle Utilization Report',
            route: 'Route Performance Report'
        }[currentTab] || 'Report';
        doc.text(reportTypeName, margin, yPos);
        yPos += 8;

        // ---- Date & Filters ----
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 80);
        doc.text(`Generated: ${new Date().toLocaleString()}`, margin, yPos);
        yPos += 5;
        // Add filter info
        const vehicle = document.getElementById('vehicleFilterSelect')?.value || 'All';
        const route = document.getElementById('routeFilterSelect')?.value || 'All';
        const start = document.getElementById('dateRangeStart')?.value || 'Any';
        const end = document.getElementById('dateRangeEnd')?.value || 'Any';
        doc.text(`Filters: Vehicle=${vehicle}, Route=${route}, Date=${start} to ${end}`, margin, yPos);
        yPos += 10;

        // ---- Summary KPI Screenshot (using html2canvas) ----
        const kpiContainer = document.getElementById(`${currentTab}KpiGrid`);
        if (kpiContainer && kpiContainer.children.length > 0) {
            const canvas = await html2canvas(kpiContainer, { scale: 2, backgroundColor: null });
            const imgData = canvas.toDataURL('image/png');
            const imgWidth = pageWidth - margin * 2;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            if (yPos + imgHeight > 270) {
                doc.addPage();
                yPos = margin;
            }
            doc.addImage(imgData, 'PNG', margin, yPos, imgWidth, imgHeight);
            yPos += imgHeight + 8;
        }

        // ---- Table using autoTable ----
        const tableData = currentReportData.filteredTableData || [];
        if (tableData.length > 0) {
            let columns = [];
            let rows = [];
            switch (currentTab) {
                case 'fuel':
                    columns = ['Fuel ID', 'Vehicle', 'Date', 'Amount (L)', 'Cost ($)', 'Odometer', 'Type', 'Depot'];
                    rows = tableData.map(r => [
                        r.fuelId || r.id,
                        r.vehicleId,
                        r.fuelDate,
                        r.fuelAmount,
                        r.fuelCost,
                        r.odometerReading || r.vehicleMileageBefore,
                        r.fuelType,
                        getDepotName(r)                // <-- Depot column in PDF
                    ]);
                    break;
                case 'maintenance':
                    columns = ['Maint. ID', 'Vehicle', 'Type', 'Service Date', 'Cost ($)', 'Status', 'Description', 'Depot'];
                    rows = tableData.map(r => [
                        r.maintenanceId || r.id,
                        r.vehicleId,
                        r.maintenanceType,
                        r.serviceDate,
                        r.cost,
                        r.status,
                        r.description,
                        getDepotName(r)
                    ]);
                    break;
                case 'utilization':
                    columns = ['Vehicle ID', 'Registration', 'Trips', 'Status', 'Depot'];
                    rows = tableData.map(r => [
                        r.vehicleId,
                        r.registrationNo,
                        r.tripCount,
                        r.status,
                        getDepotName(r)
                    ]);
                    break;
                case 'route':
                    columns = ['Route ID', 'Start Point', 'End Point', 'Distance (km)', 'Trips', 'Depot'];
                    rows = tableData.map(r => [
                        r.routeId,
                        r.startPoint,
                        r.endPoint,
                        r.distance,
                        r.tripCount,
                        getDepotName(r)
                    ]);
                    break;
            }
            doc.autoTable({
                startY: yPos,
                margin: { left: margin, right: margin },
                head: [columns],
                body: rows,
                theme: 'grid',
                styles: {
                    font: 'helvetica',
                    fontSize: 9,
                    cellPadding: 3,
                    textColor: [30, 30, 50],
                },
                headStyles: {
                    fillColor: [108, 34, 245],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                },
                alternateRowStyles: {
                    fillColor: [245, 245, 255],
                },
                didDrawPage: (data) => {
                    // Footer on each page
                    doc.setFontSize(8);
                    doc.setTextColor(150);
                    doc.text('RouteX Transit Management System — Confidential', pageWidth / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });
                }
            });
        } else {
            doc.setFontSize(11);
            doc.text('No detailed records available for this report.', margin, yPos);
        }

        // Add final footer
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
        }

        doc.save(`RouteX_${reportTypeName.replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
        showToast('PDF exported successfully!', 'success');
    } catch (error) {
        console.error('PDF export failed:', error);
        showToast('Failed to export PDF. Please try again.', 'error');
    }
}