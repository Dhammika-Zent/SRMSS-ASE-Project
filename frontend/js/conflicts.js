/* ============================================================
   ROUTEX TRANSIT — CONFLICT DETECTION JS (PHASE 2 · IDEMPOTENT UPDATE)
   Firestore integration · Dynamic KPIs · Full action support
   DEPOT‑AWARE UPDATE: Visibility derived from related schedule
   ============================================================ */

import { initRBAC } from './rbac-loader.js';
import { getCurrentUserData } from '../firebase/auth-service.js';
import {
    getAllConflicts,
    dismissConflict,
    getAllSchedules,
    detectAndGenerateConflicts,
    createNotification,
    createActivityLog,
    getUserDepotId,
    getAllDepots
} from '../firebase/firestore-service.js';

// ---------- STATE ----------
let allConflicts = [];
let totalSchedulesCount = 0;
let currentUser = null;
let currentConflicts = [];
let activeFilters = {
    status: 'all',
    severity: 'all',
    type: 'all',
    search: '',
    depot: 'all'
};

let scheduleDepotMap = {};
let depotNameMap = {};

// ---------- DOM REFS ----------
const skeletonEl = document.getElementById('conflictsSkeleton');
const errorEl = document.getElementById('conflictsErrorState');
const deniedEl = document.getElementById('conflictsAccessDenied');
const liveContentEl = document.getElementById('conflictsLiveContent');
const kpiGrid = document.getElementById('conflictsKpiGrid');
const tableBody = document.getElementById('conflictsTableBody');
const filterCount = document.getElementById('filterCount');
const searchInput = document.getElementById('filterSearch');
const searchClearBtn = document.getElementById('searchClearBtn');
const filterStatus = document.getElementById('filterStatus');
const filterSeverity = document.getElementById('filterSeverity');
const filterType = document.getElementById('filterType');
const filterResetBtn = document.getElementById('filterResetBtn');
const emptySection = document.getElementById('conflictsEmptySection');
const tableSection = document.querySelector('.conflicts-table-section');
const tableScrollWrapper = document.getElementById('tableScrollWrapper');
const tableScrollFade = document.getElementById('tableScrollFade');
const errorMsg = document.getElementById('conflictsErrorMsg');
const retryBtn = document.getElementById('conflictsRetryBtn');
const dateTimeText = document.getElementById('dateTimeText');

// ---------- UTILS ----------
function formatDate(dateInput) {
    if (!dateInput) return '—';
    const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function updateDateTime() {
    if (dateTimeText) {
        const now = new Date();
        dateTimeText.textContent = now.toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

// ---------- DYNAMIC KPI GENERATION ----------
function computeKPIs(conflicts) {
    const activeConflicts = conflicts.filter(c => c.status === 'open' || c.status === 'under-review');
    const highSeverityConflicts = conflicts.filter(c => c.severity === 'high' || c.severity === 'critical');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const resolvedToday = conflicts.filter(c => {
        if (!c.resolvedAt) return false;
        const resolvedDate = c.resolvedAt.toDate ? c.resolvedAt.toDate() : new Date(c.resolvedAt);
        return resolvedDate >= today;
    });

    const conflictRate = totalSchedulesCount > 0
        ? ((activeConflicts.length / totalSchedulesCount) * 100).toFixed(1) + '%'
        : '0%';

    return [
        {
            label: 'Active Conflicts',
            value: activeConflicts.length,
            subtitle: `Across ${new Set(activeConflicts.map(c => c.affectedResource)).size} resources`,
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
            trend: activeConflicts.length === 0 ? 'All clear' : 'Requires action',
            trendClass: activeConflicts.length === 0 ? 'positive' : 'negative',
            cardClass: '',
        },
        {
            label: 'High Severity',
            value: highSeverityConflicts.length,
            subtitle: 'Critical & High',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
            trend: highSeverityConflicts.length > 0 ? 'Immediate attention' : 'None',
            trendClass: highSeverityConflicts.length > 0 ? 'warning' : 'positive',
            cardClass: highSeverityConflicts.length > 0 ? 'kpi-card--danger' : '',
        },
        {
            label: 'Resolved Today',
            value: resolvedToday.length,
            subtitle: 'Cleared conflicts',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
            trend: resolvedToday.length > 0 ? `${resolvedToday.length} resolved` : 'None yet',
            trendClass: 'positive',
            cardClass: 'kpi-card--success',
        },
        {
            label: 'Conflict Rate',
            value: conflictRate,
            subtitle: 'Per 100 schedules',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
            trend: conflictRate === '0%' ? 'No conflicts' : '',
            trendClass: 'neutral',
            cardClass: 'kpi-card--info',
        }
    ];
}

function renderKPIs(kpiData) {
    if (!kpiGrid) return;
    kpiGrid.innerHTML = kpiData.map(kpi => `
        <div class="kpi-card ${kpi.cardClass || ''}" data-aos="fade-up">
            <div class="kpi-card-shimmer"></div>
            <div class="kpi-card-top">
                <div class="kpi-icon-wrap">${kpi.icon}</div>
                <span class="kpi-label">${kpi.label}</span>
            </div>
            <div class="kpi-value">${kpi.value}</div>
            <div class="kpi-trend kpi-trend--${kpi.trendClass || 'neutral'}">
                <svg class="kpi-trend-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    ${kpi.trendClass === 'positive' ? '<polyline points="18 15 12 9 6 15"/>' : kpi.trendClass === 'negative' ? '<polyline points="6 9 12 15 18 9"/>' : '<line x1="5" y1="12" x2="19" y2="12"/>'}
                </svg>
                ${kpi.trend}
            </div>
            <div class="kpi-subtitle">${kpi.subtitle}</div>
        </div>
    `).join('');
}

// ---------- FILTER & SEARCH LOGIC ----------
function filterConflicts() {
    let filtered = [...allConflicts];

    if (activeFilters.status !== 'all') {
        filtered = filtered.filter(c => c.status === activeFilters.status);
    }
    if (activeFilters.severity !== 'all') {
        filtered = filtered.filter(c => c.severity === activeFilters.severity);
    }
    if (activeFilters.type !== 'all') {
        const typeMap = {
            'driver': 'Driver Conflict',
            'vehicle': 'Vehicle Conflict',
            'maintenance': 'Maintenance Conflict',
            'inactive-vehicle': 'Inactive Vehicle Conflict'
        };
        const targetType = typeMap[activeFilters.type] || activeFilters.type;
        filtered = filtered.filter(c => c.type === targetType);
    }
    if (activeFilters.search.trim()) {
        const query = activeFilters.search.trim().toLowerCase();
        filtered = filtered.filter(c =>
            (c.conflictId || '').toLowerCase().includes(query) ||
            (c.type || '').toLowerCase().includes(query) ||
            (c.affectedResource || '').toLowerCase().includes(query) ||
            (c.relatedSchedule || '').toLowerCase().includes(query) ||
            (c.status || '').toLowerCase().includes(query) ||
            (c.description || '').toLowerCase().includes(query)
        );
    }

    // Depot filter (client‑side, after all other filters)
    if (activeFilters.depot !== 'all') {
        filtered = filtered.filter(c => {
            const scheduleId = c.relatedSchedule;
            return scheduleDepotMap[scheduleId] === activeFilters.depot;
        });
    }

    currentConflicts = filtered;
    renderTable();
    updateFilterCount();
    toggleEmptyState();
}

function updateFilterCount() {
    if (filterCount) {
        filterCount.textContent = `${currentConflicts.length} result${currentConflicts.length !== 1 ? 's' : ''}`;
    }
}

function toggleEmptyState() {
    if (allConflicts.length === 0) {
        if (emptySection) emptySection.style.display = 'block';
        if (tableSection) tableSection.style.display = 'none';
    } else {
        if (emptySection) emptySection.style.display = 'none';
        if (tableSection) tableSection.style.display = 'block';
    }
}

// ---------- RENDER TABLE ----------
function getSeverityBadge(severity) {
    return `<span class="badge badge-severity-${severity}">${severity}</span>`;
}

function getStatusBadge(status) {
    const displayStatus = status === 'under-review' ? 'Under Review' :
        status === 'auto_resolved' ? 'Auto Resolved' : status;
    return `<span class="badge badge-status-${status}">${displayStatus}</span>`;
}

function getActionButtons(conflict) {
    return `
        <div class="actions-cell">
            <button class="action-btn btn-view" data-action="view" data-id="${conflict.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                View
            </button>
            <button class="action-btn btn-dismiss" data-action="dismiss" data-id="${conflict.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Dismiss
            </button>
        </div>
    `;
}

function renderTable() {
    if (!tableBody) return;
    if (currentConflicts.length === 0) {
        tableBody.innerHTML = '';
        return;
    }

    tableBody.innerHTML = currentConflicts.map(conflict => {
        const scheduleId = conflict.relatedSchedule;
        const depotId = scheduleDepotMap[scheduleId] || '—';
        const depotName = depotNameMap[depotId] || depotId;
        return `
        <tr data-id="${conflict.id}">
            <td class="conflict-id">${conflict.conflictId || '—'}</td>
            <td>${conflict.type || '—'}</td>
            <td>${getSeverityBadge(conflict.severity)}</td>
            <td class="affected-resource">${conflict.affectedResource || '—'}</td>
            <td><span class="schedule-link">${conflict.relatedSchedule || '—'}</span></td>
            <td>${depotName}</td>
            <td>${getStatusBadge(conflict.status)}</td>
            <td>${formatDate(conflict.detectedDate)}</td>
            <td>${getActionButtons(conflict)}</td>
        </tr>
        `;
    }).join('');

    // Attach event listeners to action buttons
    tableBody.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const action = btn.dataset.action;
            const docId = btn.dataset.id;
            await handleAction(action, docId);
        });
    });
}

// ---------- ACTIONS (view, dismiss) – NO manual resolve ----------
async function handleAction(action, firestoreDocId) {
    const conflict = allConflicts.find(c => c.id === firestoreDocId);
    if (!conflict) return;

    if (action === 'dismiss') {
        try {
            await dismissConflict(firestoreDocId, currentUser.email);
            await createActivityLog({
                action: 'CONFLICT_DISMISSED',
                performedBy: currentUser.uid,
                performedByName: currentUser.displayName || currentUser.email,
                targetId: conflict.conflictId || conflict.id,
                targetType: 'conflict',
                timestamp: new Date()
            });
            await reloadConflicts();
        } catch (error) {
            console.error('Dismiss failed:', error);
            alert('Failed to dismiss conflict. Please try again.');
        }
    } else if (action === 'view') {
        showConflictModal(conflict);
    }
}

// ---------- MODAL (View Conflict Details) ----------
function showConflictModal(conflict) {
    const overlay = document.getElementById('conflictModalOverlay');
    if (!overlay) return;

    overlay.querySelector('.modal-conflict-id').textContent = conflict.conflictId || '—';
    overlay.querySelector('.modal-type').textContent = conflict.type || '—';
    overlay.querySelector('.modal-severity').textContent = conflict.severity || '—';
    overlay.querySelector('.modal-affected-resource').textContent = conflict.affectedResource || '—';
    overlay.querySelector('.modal-related-schedule').textContent = conflict.relatedSchedule || '—';
    overlay.querySelector('.modal-status').textContent = conflict.status || '—';
    overlay.querySelector('.modal-description').textContent = conflict.description || '—';
    overlay.querySelector('.modal-detected-date').textContent = formatDate(conflict.detectedDate);

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Close handlers
    overlay.querySelector('.modal-close-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    function closeModal() {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
    }
}

// ---------- NOTIFICATION & ACTIVITY LOG FOR NEW CONFLICTS ----------
async function handleNewConflict(conflict) {
    try {
        await createNotification({
            title: 'Conflict Detected',
            message: `${conflict.type || 'Conflict'} detected: ${conflict.affectedResource || 'resource'} ${conflict.description ? '- ' + conflict.description : ''}`.trim(),
            type: 'conflict_detected',
            targetRoles: ['superadmin', 'admin', 'supervisor'],
            targetUserIds: [],
            conflictId: conflict.id
        });
        await createActivityLog({
            action: 'CONFLICT_DETECTED',
            performedBy: null,
            performedByName: 'System',
            targetId: conflict.conflictId || conflict.id,
            targetType: 'conflict',
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Failed to create notification/activity for conflict', conflict.id, error);
    }
}

// ---------- SCROLL FADE INDICATOR ----------
function updateScrollFade() {
    if (!tableScrollWrapper || !tableScrollFade) return;
    const isScrollable = tableScrollWrapper.scrollWidth > tableScrollWrapper.clientWidth;
    const isAtEnd = tableScrollWrapper.scrollLeft + tableScrollWrapper.clientWidth >= tableScrollWrapper.scrollWidth - 2;
    if (isScrollable && !isAtEnd) {
        tableScrollFade.classList.add('visible');
    } else {
        tableScrollFade.classList.remove('visible');
    }
}

// ---------- FILTER HANDLERS ----------
function onFilterChange() {
    activeFilters.status = filterStatus.value;
    activeFilters.severity = filterSeverity.value;
    activeFilters.type = filterType.value;
    const depotSelect = document.getElementById('filterDepot');
    activeFilters.depot = depotSelect ? depotSelect.value : 'all';
    filterConflicts();
}

function onSearchInput() {
    activeFilters.search = searchInput.value;
    if (searchClearBtn) {
        searchClearBtn.style.display = activeFilters.search ? 'flex' : 'none';
    }
    filterConflicts();
}

function clearSearch() {
    searchInput.value = '';
    activeFilters.search = '';
    if (searchClearBtn) searchClearBtn.style.display = 'none';
    filterConflicts();
}

function resetAllFilters() {
    if (filterStatus) filterStatus.value = 'all';
    if (filterSeverity) filterSeverity.value = 'all';
    if (filterType) filterType.value = 'all';
    const depotSelect = document.getElementById('filterDepot');
    if (depotSelect) depotSelect.value = 'all';
    activeFilters = { status: 'all', severity: 'all', type: 'all', search: '', depot: 'all' };
    if (searchInput) searchInput.value = '';
    if (searchClearBtn) searchClearBtn.style.display = 'none';
    filterConflicts();
}

// ---------- SHOW STATES (error, access denied, live content) ----------
function showError(message = 'An unexpected error occurred. Please try again.') {
    if (skeletonEl) skeletonEl.style.display = 'none';
    if (liveContentEl) liveContentEl.style.display = 'none';
    if (deniedEl) deniedEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'flex';
    if (errorMsg) errorMsg.textContent = message;
}

function showAccessDenied() {
    if (skeletonEl) skeletonEl.style.display = 'none';
    if (liveContentEl) liveContentEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    if (deniedEl) deniedEl.style.display = 'flex';
}

function showLiveContent() {
    if (skeletonEl) skeletonEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    if (deniedEl) deniedEl.style.display = 'none';
    if (liveContentEl) liveContentEl.style.display = 'block';
}

// ---------- LOAD DATA FROM FIRESTORE (MODIFIED TO USE DETECTION RESULT) ----------
async function reloadConflicts() {
    try {
        // Run detection and get change sets
        const { created, reopened } = await detectAndGenerateConflicts();

        // Notify for genuinely new or reopened conflicts
        for (const c of [...created, ...reopened]) {
            await handleNewConflict(c);
        }

        // Refresh full list for UI
        const conflicts = await getAllConflicts({
            role: currentUser.role,
            depotId: currentUser.depotId
        });
        allConflicts = conflicts;
        totalSchedulesCount = Object.keys(scheduleDepotMap).length;

        const kpiData = computeKPIs(allConflicts);
        renderKPIs(kpiData);
        filterConflicts();
    } catch (error) {
        throw error;
    }
}

async function loadInitialData() {
    if (skeletonEl) skeletonEl.style.display = 'flex';
    if (liveContentEl) liveContentEl.style.display = 'none';

    try {
        // 1. Fetch all depots for name mapping
        const depots = await getAllDepots();
        depotNameMap = {};
        depots.forEach(d => { depotNameMap[d.depotId] = d.depotName || d.depotId; });

        // 2. Fetch schedules scoped to user's depot (superadmin gets all)
        const schedules = await getAllSchedules({
            role: currentUser.role,
            depotId: currentUser.depotId
        });
        scheduleDepotMap = {};
        schedules.forEach(s => {
            scheduleDepotMap[s.id] = s.depotId || 'unknown';
        });

        // 3. Load conflicts (scoped automatically by getAllConflicts)
        await reloadConflicts();
        showLiveContent();

        // 4. Setup depot filter dropdown for superadmin only
        if (currentUser.role === 'superadmin') {
            const depotFilterGroup = document.getElementById('depotFilterGroup');
            const depotSelect = document.getElementById('filterDepot');
            if (depotFilterGroup && depotSelect) {
                depotFilterGroup.style.display = 'block';
                depotSelect.innerHTML = '<option value="all">All Depots</option>';
                Object.keys(depotNameMap).forEach(dId => {
                    const opt = document.createElement('option');
                    opt.value = dId;
                    opt.textContent = depotNameMap[dId];
                    depotSelect.appendChild(opt);
                });
                depotSelect.addEventListener('change', onFilterChange);
            }
        }

        // Deep link handling after table render
        setTimeout(() => {
            handleDeepLink();
        }, 100);
    } catch (error) {
        console.error('Failed to load conflicts:', error);
        showError(error.message || 'Unable to load conflicts from the server.');
    }
}

// ---------- DEEP LINK & AUTO‑OPEN (CLEAN URL AFTER USE) ----------
function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const conflictId = params.get('id');
    if (!conflictId) return;

    const conflict = allConflicts.find(c => c.id === conflictId);
    if (!conflict) {
        cleanDeepLinkParam();
        return;
    }

    const row = document.querySelector(`tr[data-id="${conflictId}"]`);
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('conflict-highlight');
        setTimeout(() => {
            row.classList.remove('conflict-highlight');
        }, 3000);
    }

    showConflictModal(conflict);
    cleanDeepLinkParam();
}

function cleanDeepLinkParam() {
    const url = new URL(window.location.href);
    url.searchParams.delete('id');
    window.history.replaceState({}, document.title, url.toString());
}

// ---------- INITIALISE PAGE ----------
async function initConflictsPage() {
    try {
        const user = await initRBAC('conflicts');
        if (!user) return;

        const allowedRoles = ['superadmin', 'admin', 'supervisor'];
        if (!allowedRoles.includes(user.role)) {
            showAccessDenied();
            return;
        }

        currentUser = user;

        // Attach depotId to currentUser for depot‑aware filtering
        try {
            currentUser.depotId = await getUserDepotId(currentUser.uid);
        } catch (e) {
            console.warn('Could not fetch user depotId:', e);
            currentUser.depotId = null;
        }

        const displayNameEl = document.getElementById('displayName');
        const displayRoleEl = document.getElementById('displayRole');
        try {
            const userData = await getCurrentUserData({ uid: user.uid, email: user.email });
            if (displayNameEl) displayNameEl.textContent = userData?.name || user.email || 'User';
            if (displayRoleEl) {
                displayRoleEl.textContent = userData?.role || user.role;
                displayRoleEl.className = `role-badge role-${userData?.role || user.role}`;
            }
        } catch (e) {
            console.warn('Could not fetch user data for topbar, falling back to RBAC data', e);
            if (displayNameEl) displayNameEl.textContent = user.displayName || user.email || 'User';
            if (displayRoleEl) {
                displayRoleEl.textContent = user.role;
                displayRoleEl.className = `role-badge role-${user.role}`;
            }
        }

        updateDateTime();
        setInterval(updateDateTime, 30000);

        if (typeof AOS !== 'undefined') {
            AOS.init({
                disable: false,
                once: true,
                duration: 500,
                easing: 'ease-out-cubic'
            });
        } else {
            document.querySelectorAll('[data-aos]').forEach(el => {
                el.style.opacity = '1';
                el.style.transform = 'none';
            });
        }

        await loadInitialData();

        if (filterStatus) filterStatus.addEventListener('change', onFilterChange);
        if (filterSeverity) filterSeverity.addEventListener('change', onFilterChange);
        if (filterType) filterType.addEventListener('change', onFilterChange);
        if (searchInput) searchInput.addEventListener('input', onSearchInput);
        if (searchClearBtn) searchClearBtn.addEventListener('click', clearSearch);
        if (filterResetBtn) filterResetBtn.addEventListener('click', resetAllFilters);

        if (tableScrollWrapper) {
            tableScrollWrapper.addEventListener('scroll', updateScrollFade);
            window.addEventListener('resize', updateScrollFade);
            setTimeout(updateScrollFade, 50);
        }

        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                location.reload();
            });
        }

        if (typeof AOS !== 'undefined') {
            AOS.refresh();
        } else {
            document.querySelectorAll('[data-aos]').forEach(el => {
                el.style.opacity = '1';
                el.style.transform = 'none';
            });
        }

    } catch (error) {
        console.error('Conflict Detection init error:', error);
        showError(error.message || 'Failed to initialise Conflict Detection Center.');
    }
}

document.addEventListener('DOMContentLoaded', initConflictsPage);