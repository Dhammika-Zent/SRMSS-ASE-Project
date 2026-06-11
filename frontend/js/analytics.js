/* ============================================================
   ROUTEX TRANSIT — ANALYTICS MODULE
   Fleet Intelligence Center · Production-ready
   Depot-aware · RBAC-enforced · No new Firestore collections
   ============================================================ */

// ---------- IMPORTS ----------
import {
    getAllVehicles,
    getAllDrivers,
    getAllRoutes,
    getAllSchedules,
    getAllFuelLogs,
    getAllMaintenanceLogs,
    getAllConflicts,
    getAllDepots,
    getFleetAnalytics,
    getFuelAnalytics,
    getMaintenanceAnalytics,
    getScheduleAnalytics
} from '../firebase/firestore-service.js';
import { initRBAC } from './rbac-loader.js';

// ============================================================
//  STATE
// ============================================================
let currentUser = null;
let allDepots = [];
let selectedDepotId = null;   // null = "All Depots" (superadmin only)

// Raw data (depot-filtered)
let vehicles = [];
let drivers = [];
let routes = [];
let schedules = [];
let fuelLogs = [];
let maintenanceLogs = [];
let conflicts = [];

// Aggregated analytics objects
let fleetAnalytics = null;
let fuelAnalytics = null;
let maintenanceAnalytics = null;
let scheduleAnalytics = null;

// Chart instances
const chartInstances = {};

// KPI tooltip state
let kpiTooltipEl = null;
let kpiTooltipPinned = null;
let kpiTooltipCurrent = null;
let kpiTooltipHideTimer = null;
let kpiIsTouch = false;

// ============================================================
//  INITIALISATION
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        currentUser = await initRBAC('analytics');
        if (!currentUser) return;

        // Role gate
        if (currentUser.role === 'staff' || currentUser.role === 'driver') {
            showAccessDenied();
            return;
        }

        setupTopbar(currentUser);
        setupSidebarToggle();
        setupLogout();
        updateDateTime();
        setInterval(updateDateTime, 30_000);

        showSkeletons();

        // For superadmin: load all depots, build depot filter UI
        if (currentUser.role === 'superadmin') {
            try {
                allDepots = await getAllDepots();
            } catch {
                allDepots = [];
            }
            buildDepotFilter();
        }

        // Admin / Supervisor: scope to their own depot automatically
        if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            selectedDepotId = currentUser.depotId || null;
        }

        await loadAndRender();

        if (typeof AOS !== 'undefined') {
            AOS.init({ duration: 500, once: true, easing: 'ease-out-cubic' });
        }

        console.log('📊 Fleet Intelligence Center ready.');
    } catch (error) {
        console.error('❌ Analytics init failed:', error);
        showError(error.message || 'Failed to load analytics data.');
    }
});

// ============================================================
//  DEPOT FILTER (Superadmin only)
// ============================================================
function buildDepotFilter() {
    const filterWrap = document.getElementById('depotFilterWrap');
    if (!filterWrap) return;

    filterWrap.style.display = 'flex';

    const select = document.getElementById('depotFilterSelect');
    if (!select) return;

    // Populate options
    select.innerHTML = '<option value="">All Depots</option>';
    allDepots.forEach(depot => {
        const opt = document.createElement('option');
        opt.value = depot.id;
        opt.textContent = depot.depotName || depot.id;
        select.appendChild(opt);
    });

    select.addEventListener('change', async () => {
        selectedDepotId = select.value || null;
        showSkeletons();
        // Destroy charts before re-render
        destroyAllCharts();
        await loadAndRender();
    });
}

// ============================================================
//  DATA LOADING
// ============================================================
async function loadAndRender() {
    try {
        await loadAllData();
        computeAggregates();

        renderExecutiveKPIs();
        renderAllCharts();
        renderIntelligenceInsights();
        renderExecutiveSummary();

        // Depot comparison (superadmin only, when "All Depots" selected)
        if (currentUser.role === 'superadmin' && !selectedDepotId) {
            await renderDepotComparison();
        } else {
            hideDepotComparison();
        }

        hideSkeletons();
        showLiveContent();
    } catch (error) {
        console.error('❌ Load & render failed:', error);
        showError(error.message || 'Failed to load analytics data.');
    }
}

async function loadAllData() {
    const isSuperadmin = currentUser.role === 'superadmin';
    const filters = isSuperadmin
        ? (selectedDepotId ? { role: 'admin', depotId: selectedDepotId } : {})
        : { role: currentUser.role, depotId: currentUser.depotId };

    [vehicles, drivers, routes, schedules, fuelLogs, maintenanceLogs, conflicts] =
        await Promise.all([
            getAllVehicles(filters).catch(() => []),
            getAllDrivers(filters).catch(() => []),
            getAllRoutes(filters).catch(() => []),
            getAllSchedules(filters).catch(() => []),
            getAllFuelLogs(filters).catch(() => []),
            getAllMaintenanceLogs(filters).catch(() => []),
            getAllConflicts(filters).catch(() => [])
        ]);

    console.log('✅ Analytics data loaded:', {
        vehicles: vehicles.length,
        drivers: drivers.length,
        routes: routes.length,
        schedules: schedules.length,
        fuelLogs: fuelLogs.length,
        maintenanceLogs: maintenanceLogs.length,
        conflicts: conflicts.length
    });
}

// ============================================================
//  AGGREGATE COMPUTATION  (from raw arrays — no extra reads)
// ============================================================
function computeAggregates() {
    // --- Fleet ---
    const totalVehicles = vehicles.length;
    let activeVehicles = 0, maintenanceVehicles = 0, inactiveVehicles = 0;
    vehicles.forEach(v => {
        const s = (v.status || '').toLowerCase();
        if (s === 'active') activeVehicles++;
        else if (s === 'maintenance') maintenanceVehicles++;
        else if (s === 'inactive') inactiveVehicles++;
    });
    fleetAnalytics = {
        totalVehicles,
        activeVehicles,
        maintenanceVehicles,
        inactiveVehicles,
        fleetAvailabilityRate: totalVehicles > 0 ? (activeVehicles / totalVehicles) * 100 : 0
    };

    // --- Fuel ---
    let totalFuelAmount = 0, totalFuelCost = 0;
    fuelLogs.forEach(l => {
        totalFuelAmount += Number(l.fuelAmount) || 0;
        totalFuelCost += Number(l.fuelCost) || 0;
    });
    fuelAnalytics = {
        totalFuelLogs: fuelLogs.length,
        totalFuelAmount,
        totalFuelCost,
        averageFuelCost: totalFuelAmount > 0 ? totalFuelCost / totalFuelAmount : 0,
        averageFuelAmount: fuelLogs.length > 0 ? totalFuelAmount / fuelLogs.length : 0
    };

    // --- Maintenance ---
    let scheduledCount = 0, inProgressCount = 0, completedCount = 0, cancelledCount = 0, totalMaintenanceCost = 0;
    maintenanceLogs.forEach(r => {
        const s = r.status || '';
        if (s === 'Scheduled') scheduledCount++;
        else if (s === 'In Progress') inProgressCount++;
        else if (s === 'Completed') completedCount++;
        else if (s === 'Cancelled') cancelledCount++;
        totalMaintenanceCost += Number(r.cost) || 0;
    });
    maintenanceAnalytics = {
        totalMaintenanceRecords: maintenanceLogs.length,
        scheduledCount,
        inProgressCount,
        completedCount,
        cancelledCount,
        totalMaintenanceCost
    };

    // --- Schedules ---
    let completedSchedules = 0, cancelledSchedules = 0, inProgressSchedules = 0, scheduledSchedules = 0;
    schedules.forEach(s => {
        const st = s.status || '';
        if (st === 'Completed') completedSchedules++;
        else if (st === 'Cancelled') cancelledSchedules++;
        else if (st === 'In Progress') inProgressSchedules++;
        else if (st === 'Scheduled') scheduledSchedules++;
    });
    const totalSchedules = schedules.length;
    scheduleAnalytics = {
        totalSchedules,
        completedSchedules,
        cancelledSchedules,
        inProgressSchedules,
        scheduledSchedules,
        completionRate: totalSchedules > 0 ? (completedSchedules / totalSchedules) * 100 : 0
    };
}

// ============================================================
//  UI STATE HELPERS
// ============================================================
function showSkeletons() {
    el('analyticsSkeleton').style.display = 'flex';
    el('analyticsLiveContent').style.display = 'none';
    el('analyticsErrorState').style.display = 'none';
    el('analyticsAccessDenied').style.display = 'none';
}
function hideSkeletons() { el('analyticsSkeleton').style.display = 'none'; }
function showLiveContent() { el('analyticsLiveContent').style.display = 'block'; }

function showError(message) {
    hideSkeletons();
    el('analyticsLiveContent').style.display = 'none';
    el('analyticsErrorState').style.display = 'flex';
    el('analyticsAccessDenied').style.display = 'none';
    const msgEl = el('analyticsErrorMsg');
    if (msgEl && message) msgEl.textContent = message;
    const retryBtn = el('analyticsRetryBtn');
    if (retryBtn) retryBtn.onclick = () => window.location.reload();
}

function showAccessDenied() {
    hideSkeletons();
    el('analyticsLiveContent').style.display = 'none';
    el('analyticsErrorState').style.display = 'none';
    el('analyticsAccessDenied').style.display = 'flex';
}

function el(id) { return document.getElementById(id) || { style: {}, textContent: '', innerHTML: '' }; }

function destroyAllCharts() {
    Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch { } });
    for (const k in chartInstances) delete chartInstances[k];
}

// ============================================================
//  TOPBAR / SIDEBAR / AUTH
// ============================================================
function setupTopbar(user) {
    const nameEl = el('displayName');
    const roleEl = el('displayRole');
    nameEl.textContent = user.name || 'User';
    roleEl.textContent = user.role || 'user';
    roleEl.className = 'role-badge';
    if (user.role === 'superadmin') roleEl.classList.add('role-superadmin');
}

function updateDateTime() {
    const textEl = el('dateTimeText');
    if (!textEl.textContent === undefined) return;
    textEl.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

function setupSidebarToggle() {
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!toggleBtn || !sidebar || !overlay) return;
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    });
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    });
}

function setupLogout() {
    const btn = document.getElementById('sidebarLogoutBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        import('../firebase/auth-service.js')
            .then(({ logoutUser }) => logoutUser())
            .catch(() => { sessionStorage.clear(); window.location.href = '../login.html'; });
    });
}

// ============================================================
//  EXECUTIVE KPI SECTION
// ============================================================
function renderExecutiveKPIs() {
    const grid = document.getElementById('kpiGrid');
    if (!grid) return;

    const openConflicts = conflicts.filter(c => c.status === 'open').length;
    const neutral = { direction: 'neutral', text: 'No historical comparison available' };

    const kpis = [
        {
            label: 'Total Vehicles',
            value: fleetAnalytics.totalVehicles,
            icon: 'bus',
            trend: neutral,
            subtitle: `${fleetAnalytics.activeVehicles} Active · ${fleetAnalytics.maintenanceVehicles} Maint · ${fleetAnalytics.inactiveVehicles} Inactive`,
            variant: ''
        },
        {
            label: 'Active Vehicles',
            value: fleetAnalytics.activeVehicles,
            icon: 'shield',
            trend: neutral,
            subtitle: `${formatPercent(fleetAnalytics.fleetAvailabilityRate)} fleet availability`,
            variant: fleetAnalytics.fleetAvailabilityRate >= 85 ? 'success'
                : fleetAnalytics.fleetAvailabilityRate >= 60 ? 'warning-accent' : ''
        },
        {
            label: 'Total Drivers',
            value: drivers.length,
            icon: 'driver',
            trend: neutral,
            subtitle: 'Registered in this depot',
            variant: ''
        },
        {
            label: 'Total Routes',
            value: routes.length,
            icon: 'route',
            trend: neutral,
            subtitle: `${routes.filter(r => (r.status || '').toLowerCase() === 'active').length} active routes`,
            variant: ''
        },
        {
            label: 'Total Schedules',
            value: scheduleAnalytics.totalSchedules,
            icon: 'calendar',
            trend: neutral,
            subtitle: `${scheduleAnalytics.completedSchedules} completed · ${scheduleAnalytics.scheduledSchedules} upcoming`,
            variant: ''
        },
        {
            label: 'Open Conflicts',
            value: openConflicts,
            icon: 'conflict',
            trend: neutral,
            subtitle: `${conflicts.length} total conflicts detected`,
            variant: openConflicts > 0 ? 'warning-accent' : 'success'
        }
    ];

    grid.innerHTML = kpis.map(kpi => createKPICard(kpi)).join('');
    initKPITooltips();
}

function createKPICard(kpi) {
    const trendClass = `kpi-trend--${kpi.trend.direction}`;
    const variantClass = kpi.variant ? ` kpi-card--${kpi.variant}` : '';
    const trendArrow = getTrendArrowSVG(kpi.trend.direction);
    const iconSVG = getKPIIconSVG(kpi.icon);
    const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `
    <div class="kpi-card${variantClass}"
         data-aos="zoom-in" data-aos-delay="100"
         data-tooltip-label="${attr(kpi.label)}"
         data-tooltip-value="${attr(String(kpi.value))}"
         data-tooltip-subtitle="${attr(kpi.subtitle)}"
         data-tooltip-trend="${attr(kpi.trend.text)}"
         tabindex="0" role="button" aria-haspopup="true" aria-expanded="false">
        <div class="kpi-card-shimmer"></div>
        <div class="kpi-card-top">
            <div class="kpi-icon-wrap">${iconSVG}</div>
            <span class="kpi-label">${kpi.label}</span>
        </div>
        <span class="kpi-value">${kpi.value}</span>
        <span class="kpi-trend ${trendClass}">${trendArrow}${kpi.trend.text}</span>
        <span class="kpi-subtitle">${kpi.subtitle}</span>
    </div>`;
}

function getTrendArrowSVG(dir) {
    if (dir === 'positive') return `<svg class="kpi-trend-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
    if (dir === 'negative') return `<svg class="kpi-trend-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    return `<svg class="kpi-trend-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
}

function getKPIIconSVG(icon) {
    const map = {
        bus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="18" height="12" rx="2"/><circle cx="5" cy="18" r="2"/><circle cx="15" cy="18" r="2"/><line x1="7" y1="6" x2="7" y2="18"/><line x1="13" y1="6" x2="13" y2="18"/></svg>`,
        shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
        driver: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>`,
        route: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 9 12 3 21 9"/><polyline points="3 9 3 21 9 21 9 15 15 15 15 21 21 21 21 9"/></svg>`,
        calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>`,
        conflict: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
    };
    return map[icon] || map.shield;
}

// ============================================================
//  CHARTS
// ============================================================
function renderAllCharts() {
    renderVehicleStatusChart();
    renderSchedulePerformanceChart();
    renderConflictSeverityChart();
    renderFuelCostTrendsChart();
}

// Chart 1 — Vehicle Status Distribution (Doughnut)
function renderVehicleStatusChart() {
    const canvas = document.getElementById('vehicleStatusChart');
    const emptyEl = document.getElementById('vehicleStatusEmpty');
    if (!canvas) return;
    if (chartInstances.vehicleStatus) { chartInstances.vehicleStatus.destroy(); delete chartInstances.vehicleStatus; }

    const { activeVehicles, maintenanceVehicles, inactiveVehicles, totalVehicles } = fleetAnalytics;
    if (totalVehicles === 0) {
        canvas.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    canvas.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';

    chartInstances.vehicleStatus = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Active', 'Maintenance', 'Inactive'],
            datasets: [{
                data: [activeVehicles, maintenanceVehicles, inactiveVehicles],
                backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'],
                borderColor: 'rgba(255,255,255,0.6)',
                borderWidth: 3,
                hoverBorderColor: 'rgba(255,255,255,0.9)',
                hoverBorderWidth: 4,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true, pointStyleWidth: 12, padding: 20,
                        font: { family: "'Outfit', sans-serif", size: 11 },
                        color: '#18182c',
                        generateLabels: chart => chart.data.labels.map((label, i) => ({
                            text: `${label} (${chart.data.datasets[0].data[i]})`,
                            fillStyle: chart.data.datasets[0].backgroundColor[i],
                            strokeStyle: chart.data.datasets[0].backgroundColor[i],
                            pointStyle: 'circle', index: i
                        }))
                    }
                },
                tooltip: buildTooltipConfig(total => (v, label) => ` ${label}: ${v} (${((v / totalVehicles) * 100).toFixed(1)}%)`)
            },
            animation: { animateRotate: true, duration: 1000, easing: 'easeOutQuart' }
        }
    });
}

// Chart 2 — Schedule Performance (Horizontal Bar)
function renderSchedulePerformanceChart() {
    const canvas = document.getElementById('schedulePerformanceChart');
    const emptyEl = document.getElementById('schedulePerformanceEmpty');
    if (!canvas) return;
    if (chartInstances.schedulePerf) { chartInstances.schedulePerf.destroy(); delete chartInstances.schedulePerf; }

    const { completedSchedules, cancelledSchedules, inProgressSchedules, scheduledSchedules, totalSchedules } = scheduleAnalytics;
    if (totalSchedules === 0) {
        canvas.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    canvas.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';

    chartInstances.schedulePerf = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Completed', 'Cancelled', 'In Progress', 'Scheduled'],
            datasets: [{
                data: [completedSchedules, cancelledSchedules, inProgressSchedules, scheduledSchedules],
                backgroundColor: ['rgba(34,197,94,0.75)', 'rgba(239,68,68,0.70)', 'rgba(245,158,11,0.75)', 'rgba(79,124,255,0.75)'],
                borderColor: ['#22c55e', '#ef4444', '#f59e0b', '#4f7cff'],
                borderWidth: 1.5, borderRadius: 10, borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...buildBaseTooltipStyle(),
                    callbacks: { label: ctx => ` ${ctx.raw} trips (${totalSchedules > 0 ? ((ctx.raw / totalSchedules) * 100).toFixed(1) : 0}%)` }
                }
            },
            scales: {
                x: { grid: { color: 'rgba(108,34,245,0.06)' }, ticks: { font: { family: "'Outfit', sans-serif", size: 10 }, color: '#8c8c9e' }, beginAtZero: true },
                y: { grid: { display: false }, ticks: { font: { family: "'Outfit', sans-serif", size: 11, weight: '600' }, color: '#18182c' } }
            },
            animation: { duration: 1000, easing: 'easeOutQuart' }
        }
    });
}

// Chart 3 — Conflict Severity Distribution (Doughnut)
function renderConflictSeverityChart() {
    const canvas = document.getElementById('conflictSeverityChart');
    const emptyEl = document.getElementById('conflictSeverityEmpty');
    if (!canvas) return;
    if (chartInstances.conflictSeverity) { chartInstances.conflictSeverity.destroy(); delete chartInstances.conflictSeverity; }

    // Only open conflicts
    const open = conflicts.filter(c => c.status === 'open');
    const low = open.filter(c => (c.severity || '').toLowerCase() === 'low').length;
    const medium = open.filter(c => (c.severity || '').toLowerCase() === 'medium').length;
    const high = open.filter(c => (c.severity || '').toLowerCase() === 'high').length;
    const critical = open.filter(c => (c.severity || '').toLowerCase() === 'critical').length;
    const total = open.length;

    if (total === 0 && conflicts.length === 0) {
        canvas.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    canvas.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';

    chartInstances.conflictSeverity = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Low', 'Medium', 'High', 'Critical'],
            datasets: [{
                data: [low, medium, high, critical],
                backgroundColor: ['#22c55e', '#f59e0b', '#f97316', '#ef4444'],
                borderColor: 'rgba(255,255,255,0.6)',
                borderWidth: 3,
                hoverBorderColor: 'rgba(255,255,255,0.9)',
                hoverBorderWidth: 4,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '62%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true, pointStyleWidth: 12, padding: 20,
                        font: { family: "'Outfit', sans-serif", size: 11 }, color: '#18182c',
                        generateLabels: chart => chart.data.labels.map((label, i) => ({
                            text: `${label} (${chart.data.datasets[0].data[i]})`,
                            fillStyle: chart.data.datasets[0].backgroundColor[i],
                            strokeStyle: chart.data.datasets[0].backgroundColor[i],
                            pointStyle: 'circle', index: i
                        }))
                    }
                },
                tooltip: {
                    ...buildBaseTooltipStyle(),
                    callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}${total > 0 ? ` (${((ctx.raw / total) * 100).toFixed(1)}%)` : ''}` }
                }
            },
            animation: { animateRotate: true, duration: 1000, easing: 'easeOutQuart' }
        }
    });
}

// Chart 4 — Fuel Cost Trends (Line / Area)
function renderFuelCostTrendsChart() {
    const canvas = document.getElementById('fuelCostTrendsChart');
    const emptyEl = document.getElementById('fuelCostTrendsEmpty');
    if (!canvas) return;
    if (chartInstances.fuelCostTrends) { chartInstances.fuelCostTrends.destroy(); delete chartInstances.fuelCostTrends; }

    if (!fuelLogs || fuelLogs.length === 0) {
        canvas.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    canvas.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';

    const sorted = [...fuelLogs].sort((a, b) => {
        const dA = a.fuelDate ? new Date(a.fuelDate) : (a.createdAt?.toDate?.() ?? new Date(0));
        const dB = b.fuelDate ? new Date(b.fuelDate) : (b.createdAt?.toDate?.() ?? new Date(0));
        return dA - dB;
    }).slice(-30);

    const labels = sorted.map(l => {
        const d = l.fuelDate ? new Date(l.fuelDate) : (l.createdAt?.toDate?.() ?? new Date());
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const costs = sorted.map(l => Number(l.fuelCost) || 0);
    const amounts = sorted.map(l => Number(l.fuelAmount) || 0);

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(108,34,245,0.35)');
    gradient.addColorStop(0.5, 'rgba(79,124,255,0.15)');
    gradient.addColorStop(1, 'rgba(108,34,245,0.0)');

    chartInstances.fuelCostTrends = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Fuel Cost (රු)',
                    data: costs,
                    borderColor: '#6c22f5',
                    backgroundColor: gradient,
                    fill: true, tension: 0.45,
                    pointRadius: costs.length > 15 ? 0 : 3,
                    pointBackgroundColor: '#6c22f5', pointBorderColor: '#fff', pointBorderWidth: 2, pointHoverRadius: 6,
                    borderWidth: 2.5, order: 2
                },
                {
                    label: 'Fuel Amount (L)',
                    data: amounts,
                    borderColor: '#f59e0b',
                    backgroundColor: 'transparent',
                    fill: false, tension: 0.45,
                    pointRadius: amounts.length > 15 ? 0 : 3,
                    pointBackgroundColor: '#f59e0b', pointBorderColor: '#fff', pointBorderWidth: 2, pointHoverRadius: 6,
                    borderWidth: 2, borderDash: [6, 3], order: 1
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { usePointStyle: true, pointStyleWidth: 10, padding: 24, font: { family: "'Outfit', sans-serif", size: 11 }, color: '#18182c' }
                },
                tooltip: {
                    ...buildBaseTooltipStyle(),
                    callbacks: {
                        label: ctx => ctx.dataset.label?.includes('Cost')
                            ? ` ${ctx.dataset.label}: රු${Number(ctx.raw).toFixed(2)}`
                            : ` ${ctx.dataset.label}: ${ctx.raw} L`
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: "'Outfit', sans-serif", size: 10 }, color: '#8c8c9e', maxTicksLimit: 8 } },
                y: { grid: { color: 'rgba(108,34,245,0.06)' }, ticks: { font: { family: "'Outfit', sans-serif", size: 10 }, color: '#8c8c9e' }, beginAtZero: true }
            },
            animation: { duration: 1200, easing: 'easeOutQuart' }
        }
    });
}

// ============================================================
//  DEPOT COMPARISON (Superadmin — All Depots view only)
// ============================================================
async function renderDepotComparison() {
    const section = document.getElementById('depotComparisonSection');
    if (!section) return;
    section.style.display = 'block';

    if (allDepots.length < 2) {
        section.style.display = 'none';
        return;
    }

    // Load per-depot aggregates in parallel
    const depotStats = await Promise.all(
        allDepots.map(async depot => {
            const f = { role: 'admin', depotId: depot.id };
            const [v, s, c] = await Promise.all([
                getAllVehicles(f).catch(() => []),
                getAllSchedules(f).catch(() => []),
                getAllConflicts(f).catch(() => [])
            ]);
            const active = v.filter(x => (x.status || '').toLowerCase() === 'active').length;
            const completed = s.filter(x => x.status === 'Completed').length;
            return {
                name: depot.depotName || depot.id,
                totalVehicles: v.length,
                activeVehicles: active,
                availability: v.length > 0 ? Math.round((active / v.length) * 100) : 0,
                totalSchedules: s.length,
                completionRate: s.length > 0 ? Math.round((completed / s.length) * 100) : 0,
                openConflicts: c.filter(x => x.status === 'open').length
            };
        })
    );

    renderDepotComparisonChart(depotStats);
    renderDepotComparisonTable(depotStats);
}

function renderDepotComparisonChart(depotStats) {
    const canvas = document.getElementById('depotComparisonChart');
    if (!canvas) return;
    if (chartInstances.depotComparison) { chartInstances.depotComparison.destroy(); delete chartInstances.depotComparison; }

    chartInstances.depotComparison = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: depotStats.map(d => d.name),
            datasets: [
                {
                    label: 'Fleet Availability (%)',
                    data: depotStats.map(d => d.availability),
                    backgroundColor: 'rgba(79,124,255,0.75)',
                    borderColor: '#4f7cff',
                    borderWidth: 1.5, borderRadius: 8, borderSkipped: false
                },
                {
                    label: 'Trip Completion (%)',
                    data: depotStats.map(d => d.completionRate),
                    backgroundColor: 'rgba(34,197,94,0.70)',
                    borderColor: '#22c55e',
                    borderWidth: 1.5, borderRadius: 8, borderSkipped: false
                },
                {
                    label: 'Open Conflicts',
                    data: depotStats.map(d => d.openConflicts),
                    backgroundColor: 'rgba(239,68,68,0.70)',
                    borderColor: '#ef4444',
                    borderWidth: 1.5, borderRadius: 8, borderSkipped: false
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { usePointStyle: true, pointStyleWidth: 10, padding: 20, font: { family: "'Outfit', sans-serif", size: 11 }, color: '#18182c' }
                },
                tooltip: { ...buildBaseTooltipStyle() }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: "'Outfit', sans-serif", size: 11 }, color: '#18182c' } },
                y: {
                    grid: { color: 'rgba(108,34,245,0.06)' },
                    ticks: { font: { family: "'Outfit', sans-serif", size: 10 }, color: '#8c8c9e' },
                    beginAtZero: true, max: 100
                }
            },
            animation: { duration: 1000, easing: 'easeOutQuart' }
        }
    });
}

function renderDepotComparisonTable(depotStats) {
    const tableWrap = document.getElementById('depotComparisonTable');
    if (!tableWrap) return;

    tableWrap.innerHTML = `
        <table class="depot-comparison-table">
            <thead>
                <tr>
                    <th>Depot</th>
                    <th>Total Vehicles</th>
                    <th>Active Vehicles</th>
                    <th>Availability</th>
                    <th>Total Schedules</th>
                    <th>Completion Rate</th>
                    <th>Open Conflicts</th>
                </tr>
            </thead>
            <tbody>
                ${depotStats.map(d => `
                <tr>
                    <td class="depot-name-cell">${escHtml(d.name)}</td>
                    <td>${d.totalVehicles}</td>
                    <td>${d.activeVehicles}</td>
                    <td>
                        <span class="depot-badge ${d.availability >= 85 ? 'badge-green' : d.availability >= 60 ? 'badge-orange' : 'badge-red'}">
                            ${d.availability}%
                        </span>
                    </td>
                    <td>${d.totalSchedules}</td>
                    <td>
                        <span class="depot-badge ${d.completionRate >= 80 ? 'badge-green' : d.completionRate >= 50 ? 'badge-orange' : 'badge-red'}">
                            ${d.completionRate}%
                        </span>
                    </td>
                    <td>
                        <span class="depot-badge ${d.openConflicts === 0 ? 'badge-green' : 'badge-red'}">
                            ${d.openConflicts}
                        </span>
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}

function hideDepotComparison() {
    const section = document.getElementById('depotComparisonSection');
    if (section) section.style.display = 'none';
}

// ============================================================
//  INTELLIGENCE INSIGHTS
// ============================================================
function renderIntelligenceInsights() {
    const grid = document.getElementById('intelligenceGrid');
    if (!grid) return;

    const insights = generateInsights();
    grid.innerHTML = insights.map((ins, i) => `
        <div class="intel-card" data-aos="fade-up" data-aos-delay="${100 + i * 80}">
            <div class="intel-icon-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
            </div>
            <div class="intel-body">
                <span class="intel-label">${ins.label}</span>
                <p class="intel-text">${ins.text}</p>
            </div>
        </div>`).join('');
}

function generateInsights() {
    const ins = [];
    const { fleetAvailabilityRate, activeVehicles, totalVehicles, maintenanceVehicles } = fleetAnalytics;
    const { completionRate, totalSchedules, completedSchedules, cancelledSchedules } = scheduleAnalytics;
    const { scheduledCount, inProgressCount, totalMaintenanceRecords } = maintenanceAnalytics;
    const { totalFuelLogs, averageFuelCost, totalFuelCost } = fuelAnalytics;
    const openConflicts = conflicts.filter(c => c.status === 'open').length;

    // Fleet health
    if (totalVehicles === 0) {
        ins.push({ label: 'Fleet Health', text: 'No vehicle data available. Add vehicles to begin tracking fleet availability.' });
    } else if (fleetAvailabilityRate >= 90) {
        ins.push({ label: 'Fleet Health', text: `Fleet availability is excellent at ${Math.round(fleetAvailabilityRate)}%. ${activeVehicles} of ${totalVehicles} vehicles are operational.` });
    } else if (fleetAvailabilityRate >= 60) {
        ins.push({ label: 'Fleet Health', text: `Fleet availability is at ${Math.round(fleetAvailabilityRate)}%. ${maintenanceVehicles} vehicle(s) are in maintenance — monitor to improve readiness.` });
    } else {
        ins.push({ label: 'Fleet Health', text: `Fleet availability is critically low at ${Math.round(fleetAvailabilityRate)}%. Immediate action required to address inactive and maintenance vehicles.` });
    }

    // Conflicts
    if (openConflicts === 0) {
        ins.push({ label: 'Conflict Status', text: 'No open conflicts detected. All scheduling and resource assignments are clean.' });
    } else {
        const critical = conflicts.filter(c => c.status === 'open' && (c.severity || '').toLowerCase() === 'critical').length;
        const high = conflicts.filter(c => c.status === 'open' && (c.severity || '').toLowerCase() === 'high').length;
        ins.push({ label: 'Conflict Status', text: `${openConflicts} open conflict(s) require attention — ${critical} critical, ${high} high severity. Review the Conflicts module promptly.` });
    }

    // Maintenance workload
    const pendingMaint = scheduledCount + inProgressCount;
    if (totalMaintenanceRecords === 0) {
        ins.push({ label: 'Maintenance', text: 'No maintenance records found. The fleet may not have undergone documented service yet.' });
    } else if (pendingMaint === 0) {
        ins.push({ label: 'Maintenance', text: 'No pending maintenance tasks. All recorded service items have been addressed or cancelled.' });
    } else if (pendingMaint <= 3) {
        ins.push({ label: 'Maintenance', text: `Maintenance workload is low with ${pendingMaint} open task(s). The fleet is well maintained.` });
    } else {
        ins.push({ label: 'Maintenance', text: `${pendingMaint} maintenance tasks are currently open. Monitor workload to prevent backlog.` });
    }

    // Operations
    if (totalSchedules === 0) {
        ins.push({ label: 'Operations', text: 'No trip data available. Schedule trips to begin tracking operational performance.' });
    } else if (completionRate >= 90) {
        ins.push({ label: 'Operations', text: `Trip completion is outstanding at ${Math.round(completionRate)}%. ${completedSchedules} trips completed successfully.` });
    } else if (completionRate >= 70) {
        ins.push({ label: 'Operations', text: `Trip completion is strong at ${Math.round(completionRate)}%. Operations are running smoothly.` });
    } else {
        ins.push({ label: 'Operations', text: `Trip completion is at ${Math.round(completionRate)}% with ${cancelledSchedules} cancellations. Review root causes for improvement.` });
    }

    // Fuel
    if (totalFuelLogs > 0) {
        ins.push({ label: 'Fuel Performance', text: `Average fuel cost is ${formatCurrency(averageFuelCost)} per unit across ${totalFuelLogs} log(s). Total spend: ${formatCurrency(totalFuelCost)}.` });
    } else {
        ins.push({ label: 'Fuel Performance', text: 'No fuel logs recorded yet. Begin logging fuel data to unlock consumption analytics.' });
    }

    // Top fuel-consuming vehicle
    if (fuelLogs.length > 0) {
        const byVehicle = {};
        fuelLogs.forEach(l => {
            if (!l.vehicleId) return;
            byVehicle[l.vehicleId] = (byVehicle[l.vehicleId] || 0) + (Number(l.fuelCost) || 0);
        });
        const top = Object.entries(byVehicle).sort((a, b) => b[1] - a[1])[0];
        if (top) {
            ins.push({ label: 'Highest Fuel Cost', text: `Vehicle ${top[0]} incurred the highest fuel expenditure at ${formatCurrency(top[1])}.` });
        }
    }

    return ins.slice(0, 6);
}

// ============================================================
//  EXECUTIVE SUMMARY
// ============================================================
function renderExecutiveSummary() {
    const panel = document.getElementById('executiveSummaryPanel');
    if (!panel) return;

    const { fleetAvailabilityRate, activeVehicles, maintenanceVehicles, totalVehicles } = fleetAnalytics;
    const { completionRate, completedSchedules, cancelledSchedules, totalSchedules } = scheduleAnalytics;
    const { scheduledCount, inProgressCount, totalMaintenanceRecords } = maintenanceAnalytics;
    const { totalFuelCost, totalFuelLogs } = fuelAnalytics;
    const openConflicts = conflicts.filter(c => c.status === 'open').length;

    // Fleet
    let fleetBadge, fleetDot, fleetText;
    if (totalVehicles === 0) { fleetBadge = 'summary-badge--neutral'; fleetDot = 'summary-dot--gray'; fleetText = 'No vehicles in the fleet.'; }
    else if (fleetAvailabilityRate >= 85) { fleetBadge = 'summary-badge--healthy'; fleetDot = 'summary-dot--green'; fleetText = `${activeVehicles} active, ${maintenanceVehicles} in maintenance.`; }
    else if (fleetAvailabilityRate >= 60) { fleetBadge = 'summary-badge--moderate'; fleetDot = 'summary-dot--orange'; fleetText = `${activeVehicles} active — availability needs monitoring.`; }
    else { fleetBadge = 'summary-badge--critical'; fleetDot = 'summary-dot--red'; fleetText = 'Critical — immediate fleet review required.'; }

    // Ops
    let opsBadge, opsDot, opsText;
    if (!totalSchedules) { opsBadge = 'summary-badge--neutral'; opsDot = 'summary-dot--gray'; opsText = 'No trip data recorded yet.'; }
    else if (completionRate >= 80) { opsBadge = 'summary-badge--strong'; opsDot = 'summary-dot--blue'; opsText = `${completedSchedules} trips completed successfully.`; }
    else if (completionRate >= 50) { opsBadge = 'summary-badge--moderate'; opsDot = 'summary-dot--orange'; opsText = `${cancelledSchedules} cancellations — review needed.`; }
    else { opsBadge = 'summary-badge--critical'; opsDot = 'summary-dot--red'; opsText = 'High cancellation rate — investigate root causes.'; }

    // Maintenance
    const pendingMaint = scheduledCount + inProgressCount;
    let maintBadge, maintDot, maintText;
    if (totalMaintenanceRecords === 0) { maintBadge = 'summary-badge--neutral'; maintDot = 'summary-dot--gray'; maintText = 'No maintenance records on file.'; }
    else if (pendingMaint <= 4) { maintBadge = 'summary-badge--healthy'; maintDot = 'summary-dot--green'; maintText = `${scheduledCount} scheduled, ${inProgressCount} in progress — low risk.`; }
    else if (pendingMaint <= 8) { maintBadge = 'summary-badge--moderate'; maintDot = 'summary-dot--orange'; maintText = `${pendingMaint} open tasks — moderate workload.`; }
    else { maintBadge = 'summary-badge--critical'; maintDot = 'summary-dot--red'; maintText = `${pendingMaint} open tasks — high maintenance backlog.`; }

    // Conflicts
    let conBadge, conDot, conText;
    if (openConflicts === 0) { conBadge = 'summary-badge--healthy'; conDot = 'summary-dot--green'; conText = 'No open conflicts. All schedules are conflict-free.'; }
    else if (openConflicts <= 3) { conBadge = 'summary-badge--moderate'; conDot = 'summary-dot--orange'; conText = `${openConflicts} open conflict(s) — moderate risk.`; }
    else { conBadge = 'summary-badge--critical'; conDot = 'summary-dot--red'; conText = `${openConflicts} open conflicts — immediate resolution required.`; }

    // Fuel
    let fuelBadge, fuelDot, fuelText;
    if (totalFuelLogs === 0) { fuelBadge = 'summary-badge--neutral'; fuelDot = 'summary-dot--gray'; fuelText = 'No fuel data recorded yet.'; }
    else { fuelBadge = 'summary-badge--strong'; fuelDot = 'summary-dot--blue'; fuelText = `${formatCurrency(totalFuelCost)} total spend across ${totalFuelLogs} log(s).`; }

    panel.innerHTML = `
        <div class="summary-item">
            <div class="summary-item-header"><span class="summary-dot ${fleetDot}"></span><span class="summary-item-label">Fleet Status</span></div>
            <span class="summary-badge ${fleetBadge}">${totalVehicles === 0 ? 'No Fleet' : fleetAvailabilityRate >= 85 ? 'Healthy' : fleetAvailabilityRate >= 60 ? 'Moderate' : 'Critical'}</span>
            <span class="summary-item-value">${fleetText}</span>
        </div>
        <div class="summary-item">
            <div class="summary-item-header"><span class="summary-dot ${opsDot}"></span><span class="summary-item-label">Operational Health</span></div>
            <span class="summary-badge ${opsBadge}">${!totalSchedules ? 'No Data' : completionRate >= 80 ? 'Strong' : completionRate >= 50 ? 'Average' : 'Weak'}</span>
            <span class="summary-item-value">${opsText}</span>
        </div>
        <div class="summary-item">
            <div class="summary-item-header"><span class="summary-dot ${maintDot}"></span><span class="summary-item-label">Maintenance Risk</span></div>
            <span class="summary-badge ${maintBadge}">${totalMaintenanceRecords === 0 ? 'No Data' : pendingMaint <= 4 ? 'Low Risk' : pendingMaint <= 8 ? 'Moderate' : 'High Risk'}</span>
            <span class="summary-item-value">${maintText}</span>
        </div>
        <div class="summary-item">
            <div class="summary-item-header"><span class="summary-dot ${conDot}"></span><span class="summary-item-label">Conflict Status</span></div>
            <span class="summary-badge ${conBadge}">${openConflicts === 0 ? 'Clear' : openConflicts <= 3 ? 'Moderate' : 'Critical'}</span>
            <span class="summary-item-value">${conText}</span>
        </div>
        <div class="summary-item">
            <div class="summary-item-header"><span class="summary-dot ${fuelDot}"></span><span class="summary-item-label">Fuel Performance</span></div>
            <span class="summary-badge ${fuelBadge}">${totalFuelLogs > 0 ? 'Active' : 'No Data'}</span>
            <span class="summary-item-value">${fuelText}</span>
        </div>`;
}

// ============================================================
//  TOOLTIP HELPERS — shared chart config
// ============================================================
function buildBaseTooltipStyle() {
    return {
        backgroundColor: 'rgba(255,255,255,0.9)',
        titleColor: '#08081a', bodyColor: '#18182c',
        borderColor: 'rgba(108,34,245,0.2)', borderWidth: 1,
        cornerRadius: 12, padding: 12,
        titleFont: { family: "'Outfit', sans-serif", weight: '600' },
        bodyFont: { family: "'Outfit', sans-serif" }
    };
}

function buildTooltipConfig() {
    return { ...buildBaseTooltipStyle() };
}

// ============================================================
//  FORMATTING HELPERS
// ============================================================
function formatPercent(v) {
    if (v == null || isNaN(v)) return '0%';
    return Math.round(v) + '%';
}

function formatCurrency(v) {
    if (v == null || isNaN(v)) return 'රු0';
    if (v >= 1_000_000) { const m = v / 1_000_000; return 'රු' + (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + 'M'; }
    if (v >= 1_000) { const k = v / 1_000; return 'රු' + (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'K'; }
    return 'රු' + Math.round(v);
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
//  KPI GLASS TOOLTIP
// ============================================================
function ensureTooltipElement() {
    if (kpiTooltipEl) return;
    kpiTooltipEl = document.createElement('div');
    kpiTooltipEl.id = 'kpiTooltip';
    kpiTooltipEl.className = 'kpi-tooltip';
    kpiTooltipEl.setAttribute('role', 'tooltip');
    kpiTooltipEl.setAttribute('aria-hidden', 'true');
    kpiTooltipEl.innerHTML = `
        <div class="kpi-tooltip-inner">
            <span class="kpi-tooltip-title"></span>
            <span class="kpi-tooltip-value"></span>
            <span class="kpi-tooltip-subtitle"></span>
            <span class="kpi-tooltip-status"></span>
        </div>`;
    document.body.appendChild(kpiTooltipEl);
    kpiIsTouch = window.matchMedia('(pointer: coarse)').matches;
}

function showTooltip(card) {
    if (!card) return;
    ensureTooltipElement();
    if (kpiTooltipHideTimer) { clearTimeout(kpiTooltipHideTimer); kpiTooltipHideTimer = null; }
    kpiTooltipCurrent = card;
    kpiTooltipEl.querySelector('.kpi-tooltip-title').textContent = card.getAttribute('data-tooltip-label') || '';
    kpiTooltipEl.querySelector('.kpi-tooltip-value').textContent = card.getAttribute('data-tooltip-value') || '';
    kpiTooltipEl.querySelector('.kpi-tooltip-subtitle').textContent = card.getAttribute('data-tooltip-subtitle') || '';
    kpiTooltipEl.querySelector('.kpi-tooltip-status').textContent = card.getAttribute('data-tooltip-trend') || '';
    positionTooltip(card);
    kpiTooltipEl.classList.add('active');
    kpiTooltipEl.setAttribute('aria-hidden', 'false');
    card.setAttribute('aria-describedby', 'kpiTooltip');
}

function hideTooltip(force) {
    if (!force && kpiTooltipPinned) return;
    if (kpiTooltipHideTimer) clearTimeout(kpiTooltipHideTimer);
    kpiTooltipHideTimer = setTimeout(() => {
        if (kpiTooltipPinned && !force) return;
        if (kpiTooltipEl) { kpiTooltipEl.classList.remove('active'); kpiTooltipEl.setAttribute('aria-hidden', 'true'); }
        if (kpiTooltipCurrent) { kpiTooltipCurrent.removeAttribute('aria-describedby'); kpiTooltipCurrent = null; }
        kpiTooltipHideTimer = null;
    }, 80);
}

function positionTooltip(card) {
    if (!kpiTooltipEl || !card) return;
    const cr = card.getBoundingClientRect();
    const tr = kpiTooltipEl.getBoundingClientRect();
    const vW = window.innerWidth, vH = window.innerHeight;
    let top = cr.top - tr.height - 10;
    let arrow = 'arrow-down';
    if (top < 10) { top = cr.bottom + 10; arrow = 'arrow-up'; }
    top = Math.max(10, Math.min(top, vH - tr.height - 10));
    let left = cr.left + cr.width / 2 - tr.width / 2;
    left = Math.max(10, Math.min(left, vW - tr.width - 10));
    kpiTooltipEl.style.top = top + 'px';
    kpiTooltipEl.style.left = left + 'px';
    kpiTooltipEl.classList.remove('arrow-up', 'arrow-down');
    kpiTooltipEl.classList.add(arrow);
}

function pinTooltip(card) {
    ensureTooltipElement();
    if (kpiTooltipPinned === card) { kpiTooltipPinned = null; hideTooltip(true); return; }
    kpiTooltipPinned = card;
    showTooltip(card);
}

function initKPITooltips() {
    ensureTooltipElement();
    const grid = document.getElementById('kpiGrid');
    if (!grid) return;

    grid.addEventListener('mouseenter', e => {
        const card = e.target.closest('.kpi-card');
        if (!card || kpiIsTouch) return;
        showTooltip(card);
    }, true);

    grid.addEventListener('mouseleave', e => {
        const card = e.target.closest('.kpi-card');
        if (!card || kpiIsTouch) return;
        hideTooltip(false);
    }, true);

    grid.addEventListener('focusin', e => { const c = e.target.closest('.kpi-card'); if (c) showTooltip(c); });
    grid.addEventListener('focusout', e => {
        const c = e.target.closest('.kpi-card');
        if (c) setTimeout(() => { if (kpiTooltipCurrent === c && document.activeElement?.closest('.kpi-card') !== c) hideTooltip(false); }, 150);
    });
    grid.addEventListener('click', e => { const c = e.target.closest('.kpi-card'); if (c) pinTooltip(c); });

    document.addEventListener('click', e => {
        if (!kpiTooltipPinned) return;
        if (!e.target.closest('.kpi-card') && !e.target.closest('#kpiTooltip')) { kpiTooltipPinned = null; hideTooltip(true); }
    });

    let repositionTimer;
    const reposition = () => {
        if (repositionTimer) return;
        repositionTimer = requestAnimationFrame(() => {
            if (kpiTooltipEl?.classList.contains('active') && kpiTooltipCurrent) positionTooltip(kpiTooltipCurrent);
            repositionTimer = null;
        });
    };
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });

    if (kpiTooltipEl) {
        kpiTooltipEl.addEventListener('mouseleave', () => { if (!kpiTooltipPinned) hideTooltip(true); });
        kpiTooltipEl.addEventListener('mouseenter', () => { if (kpiTooltipHideTimer) { clearTimeout(kpiTooltipHideTimer); kpiTooltipHideTimer = null; } });
    }
}