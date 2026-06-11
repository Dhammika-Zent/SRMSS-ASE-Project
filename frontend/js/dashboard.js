/* ============================================================
   ROUTEX TRANSIT — DASHBOARD CONTROLLER (REFACTORED)
   ============================================================ */

// ---------- IMPORTS ----------
import { initRBAC } from './rbac-loader.js';
import { logout } from '../firebase/auth-service.js';
import {
    getAllUsers,
    getAllRoutes,
    getAllVehicles,
    getAllSchedules,
    getDriverData,
    getNotificationsForUser,
    getUnreadCount,
    markNotificationRead,
    getRecentActivityLogs
} from '../firebase/firestore-service.js';

/* ============================================================
   DOM REFERENCES
   ============================================================ */
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');

const displayNameEl = document.getElementById('displayName');
const displayRoleEl = document.getElementById('displayRole');
const welcomeNameEl = document.getElementById('welcomeName');
const welcomeMessageEl = document.getElementById('welcomeMessage');

const sidebarNav = document.getElementById('sidebarNav');
const quickActionsContainer = document.getElementById('quickActions');

const statRoutes = document.getElementById('statRoutes');
const statVehicles = document.getElementById('statVehicles');
const statTrips = document.getElementById('statTrips');
const statOnTime = document.getElementById('statOnTime');
const statDelayed = document.getElementById('statDelayed');
const statUsers = document.getElementById('statUsers');
const statUsersLabel = document.getElementById('statUsersLabel');

const currentDateTimeEl = document.getElementById('dateTimeText');

const notificationBell = document.getElementById('notificationBell');
const notificationBadge = document.getElementById('notificationBadge');
const notificationDropdown = document.getElementById('notificationDropdown');
const notificationList = document.getElementById('notificationList');
const markAllReadBtn = document.getElementById('markAllReadBtn');

const activityPlaceholder = document.getElementById('activityPlaceholder');
const activityList = document.getElementById('activityList');

/* ============================================================
   QUICK ACTIONS PER ROLE (unchanged)
   ============================================================ */
const QUICK_ACTIONS = {
    superadmin: ['manage admins', 'system settings', 'global analytics', 'manage all users'],
    admin: ['manage staff', 'add route', 'fuel logs', 'maintenance'],
    supervisor: ['plan schedule', 'track routes', 'driver reports'],
    staff: ['check route', 'vehicle status'],
    driver: ['my route', 'my schedule']
};

/* ============================================================
   NOTIFICATION STATE
   ============================================================ */
let currentUser = null;
let notifications = [];
let unreadCount = 0;
let notificationInterval = null;
let driverSchedules = [];

/* ============================================================
   NOTIFICATION HELPER FUNCTIONS
   ============================================================ */
function timeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const now = Date.now();
    const then = timestamp.toMillis ? timestamp.toMillis() : timestamp;
    const seconds = Math.floor((now - then) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const date = new Date(then);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function loadNotifications() {
    if (!currentUser) return;
    try {
        notifications = await getNotificationsForUser(currentUser.uid, currentUser.role);
        unreadCount = notifications.filter(n => !n.readBy || !n.readBy.includes(currentUser.uid)).length;
        updateNotificationUI();
    } catch (error) {
        console.error('Failed to load notifications:', error);
    }
}

async function refreshUnreadCount() {
    if (!currentUser) return;
    try {
        unreadCount = await getUnreadCount(currentUser.uid, currentUser.role);
        updateBadge();
    } catch (error) {
        console.error('Failed to refresh unread count:', error);
    }
}

function updateBadge() {
    if (unreadCount > 0) {
        notificationBadge.textContent = unreadCount;
        notificationBadge.style.display = 'flex';
    } else {
        notificationBadge.style.display = 'none';
    }
}

function renderNotificationList() {
    notificationList.innerHTML = '';
    if (notifications.length === 0) {
        notificationList.innerHTML = '<li class="no-notifications">No notifications yet</li>';
        return;
    }
    const sliced = notifications.slice(0, 10);
    sliced.forEach(notification => {
        const isUnread = !notification.readBy || !notification.readBy.includes(currentUser.uid);
        const li = document.createElement('li');
        li.className = 'notification-item';
        li.dataset.id = notification.id;

        if (isUnread) {
            const dot = document.createElement('span');
            dot.className = 'notif-dot';
            li.appendChild(dot);
        } else {
            const spacer = document.createElement('span');
            spacer.style.width = '8px';
            spacer.style.marginRight = '10px';
            spacer.style.flexShrink = '0';
            li.appendChild(spacer);
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'notif-content';

        const titleEl = document.createElement('div');
        titleEl.className = 'notif-title';
        titleEl.textContent = notification.title;

        const msgEl = document.createElement('div');
        msgEl.className = 'notif-message';
        msgEl.textContent = notification.message;

        const timeEl = document.createElement('div');
        timeEl.className = 'notif-time';
        timeEl.textContent = timeAgo(notification.createdAt);

        contentDiv.appendChild(titleEl);
        contentDiv.appendChild(msgEl);
        contentDiv.appendChild(timeEl);
        li.appendChild(contentDiv);

        // Deep link support: if notification is conflict, clicking navigates to conflicts.html?id=...
        li.addEventListener('click', () => handleNotificationClick(notification));
        notificationList.appendChild(li);
    });
}

async function handleNotificationClick(notification) {
    const isUnread = !notification.readBy || !notification.readBy.includes(currentUser.uid);
    if (isUnread) {
        try {
            await markNotificationRead(notification.id, currentUser.uid);
            if (!notification.readBy) {
                notification.readBy = [currentUser.uid];
            } else {
                notification.readBy.push(currentUser.uid);
            }
            unreadCount = Math.max(0, unreadCount - 1);
            updateNotificationUI();
        } catch (error) {
            console.error('Failed to mark notification as read:', error);
        }
    }

    // Navigate to conflicts page if this is a conflict notification with a conflictId
    if (notification.type === 'conflict_detected' && notification.conflictId) {
        window.location.href = `conflicts.html?id=${notification.conflictId}`;
    }
}

async function markAllRead() {
    if (!currentUser || notifications.length === 0) return;
    const unreadNotifications = notifications.filter(n => !n.readBy || !n.readBy.includes(currentUser.uid));
    if (unreadNotifications.length === 0) return;
    try {
        const promises = unreadNotifications.map(n => markNotificationRead(n.id, currentUser.uid));
        await Promise.all(promises);
        unreadNotifications.forEach(n => {
            if (!n.readBy) n.readBy = [currentUser.uid];
            else n.readBy.push(currentUser.uid);
        });
        unreadCount = 0;
        updateNotificationUI();
    } catch (error) {
        console.error('Failed to mark all as read:', error);
    }
}

function updateNotificationUI() {
    updateBadge();
    renderNotificationList();
}

function toggleDropdown() {
    const isOpen = notificationDropdown.classList.contains('open');
    if (isOpen) {
        notificationDropdown.classList.remove('open');
    } else {
        renderNotificationList();
        notificationDropdown.classList.add('open');
    }
}

function handleClickOutside(event) {
    if (!notificationDropdown.classList.contains('open')) return;
    const wrapper = document.querySelector('.notification-wrapper');
    if (wrapper && !wrapper.contains(event.target)) {
        notificationDropdown.classList.remove('open');
    }
}

function setupNotifications(user) {
    currentUser = user;
    loadNotifications().then(() => {
        if (notificationInterval) clearInterval(notificationInterval);
        notificationInterval = setInterval(async () => {
            await loadNotifications();
        }, 30000);
    });

    notificationBell.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    markAllReadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        markAllRead();
    });

    document.addEventListener('click', handleClickOutside);
}

/* ============================================================
   RECENT ACTIVITY WIDGET (UPDATED WITH CONFLICT ACTIONS)
   ============================================================ */

const ACTION_NORMALIZATION_MAP = {
    'Trip Started': 'TRIP_STARTED',
    'Trip Completed': 'TRIP_COMPLETED',
    'Schedule Created': 'CREATE_SCHEDULE',
    'Schedule Updated': 'UPDATE_SCHEDULE',
    'Schedule Assigned': 'SCHEDULE_ASSIGNED',
    'Route Created': 'CREATE_ROUTE',
    'Route Updated': 'UPDATE_ROUTE',
    'Route Map Generated': 'GENERATED_ROUTE_MAP',
    'Vehicle Created': 'CREATE_VEHICLE',
    'Vehicle Updated': 'UPDATE_VEHICLE',
    'User Created': 'CREATE_USER',
    'User Updated': 'UPDATE_USER',
    'User Disabled': 'DISABLE_USER',
    'User Deleted': 'DELETE_USER',
    'Route Marked Completed': 'ROUTE_COMPLETED'
    // CONFLICT actions remain as raw strings
};

function normalizeAction(action) {
    return ACTION_NORMALIZATION_MAP[action] || action;
}

/**
 * Map raw activity log actions to human‑readable messages.
 * Fuel, Maintenance and Conflict actions are now fully supported.
 */
const actionMessages = {
    'CREATE_USER': (entry) => `${entry.performedByName || 'System'} created a new user`,
    'UPDATE_USER': (entry) => `${entry.performedByName || 'System'} updated a user`,
    'DISABLE_USER': (entry) => `${entry.performedByName || 'System'} deactivated a user`,
    'DELETE_USER': (entry) => `${entry.performedByName || 'System'} deleted a user`,
    'CREATE_ROUTE': (entry) => `${entry.performedByName || 'System'} created Route ${entry.targetId}`,
    'UPDATE_ROUTE': (entry) => `${entry.performedByName || 'System'} updated Route ${entry.targetId}`,
    'GENERATED_ROUTE_MAP': (entry) => `${entry.performedByName || 'System'} generated map for Route ${entry.targetId}`,
    'CREATE_VEHICLE': (entry) => `${entry.performedByName || 'System'} created Vehicle ${entry.targetId}`,
    'UPDATE_VEHICLE': (entry) => `${entry.performedByName || 'System'} updated Vehicle ${entry.targetId}`,
    'CREATE_SCHEDULE': (entry) => `${entry.performedByName || 'System'} created Schedule ${entry.targetId}`,
    'UPDATE_SCHEDULE': (entry) => `${entry.performedByName || 'System'} updated Schedule ${entry.targetId}`,
    'SCHEDULE_ASSIGNED': (entry) => `${entry.performedByName || 'System'} assigned Schedule ${entry.targetId}`,
    'SCHEDULE_UPDATED': (entry) => `${entry.performedByName || 'System'} updated Schedule ${entry.targetId}`,
    'TRIP_STARTED': (entry) => `${entry.performedByName || 'System'} started Schedule ${entry.targetId}`,
    'TRIP_COMPLETED': (entry) => `${entry.performedByName || 'System'} completed Schedule ${entry.targetId}`,
    // ---- FUEL LOG ACTIONS ----
    'CREATE_FUEL_LOG': (entry) => {
        const [fuelId, vehicleId] = (entry.targetId || '').split('||');
        const userName = entry.performedByName || 'System';
        if (fuelId && vehicleId) {
            return `${userName} created Fuel Log ${fuelId} for Vehicle ${vehicleId}`;
        }
        return `${userName} created Fuel Log ${entry.targetId}`;
    },
    'UPDATE_FUEL_LOG': (entry) => {
        const [fuelId, vehicleId] = (entry.targetId || '').split('||');
        const userName = entry.performedByName || 'System';
        if (fuelId && vehicleId) {
            return `${userName} updated Fuel Log ${fuelId} for Vehicle ${vehicleId}`;
        }
        return `${userName} updated Fuel Log ${entry.targetId}`;
    },
    'DELETE_FUEL_LOG': (entry) => {
        const [fuelId, vehicleId] = (entry.targetId || '').split('||');
        const userName = entry.performedByName || 'System';
        if (fuelId && vehicleId) {
            return `${userName} deleted Fuel Log ${fuelId} for Vehicle ${vehicleId}`;
        }
        return `${userName} deleted Fuel Log ${entry.targetId}`;
    },
    // ---- MAINTENANCE LOG ACTIONS ----
    'CREATE_MAINTENANCE_LOG': (entry) => {
        const [maintId, vehicleId] = (entry.targetId || '').split('||');
        const userName = entry.performedByName || 'System';
        if (maintId && vehicleId) {
            return `${userName} created Maintenance Log ${maintId} for Vehicle ${vehicleId}`;
        }
        return `${userName} created Maintenance Log ${entry.targetId}`;
    },
    'UPDATE_MAINTENANCE_LOG': (entry) => {
        const [maintId, vehicleId] = (entry.targetId || '').split('||');
        const userName = entry.performedByName || 'System';
        if (maintId && vehicleId) {
            return `${userName} updated Maintenance Log ${maintId} for Vehicle ${vehicleId}`;
        }
        return `${userName} updated Maintenance Log ${entry.targetId}`;
    },
    'DELETE_MAINTENANCE_LOG': (entry) => {
        const [maintId, vehicleId] = (entry.targetId || '').split('||');
        const userName = entry.performedByName || 'System';
        if (maintId && vehicleId) {
            return `${userName} deleted Maintenance Log ${maintId} for Vehicle ${vehicleId}`;
        }
        return `${userName} deleted Maintenance Log ${entry.targetId}`;
    },
    // ---- CONFLICT ACTIONS (NEW) ----
    'CONFLICT_DETECTED': (entry) => {
        return `${entry.performedByName || 'System'} detected ${entry.targetType || 'Conflict'} ${entry.targetId}`;
    },
    'CONFLICT_RESOLVED': (entry) => {
        return `${entry.performedByName || 'System'} resolved Conflict ${entry.targetId}`;
    },
    'CONFLICT_DISMISSED': (entry) => {
        return `${entry.performedByName || 'System'} dismissed Conflict ${entry.targetId}`;
    },
};

function buildActivityMessage(entry) {
    const { action, performedByName, targetType, targetId } = entry;
    const mapper = actionMessages[action];
    if (mapper) {
        return mapper(entry);
    }
    return `${performedByName || 'System'} performed ${action} (${targetType}: ${targetId})`;
}

function filterActivityByRole(logs, role, userId, driverSchedules = []) {
    return logs.filter(entry => {
        const action = entry.action;
        const targetType = entry.targetType;
        const targetId = entry.targetId;

        switch (role) {
            case 'driver': {
                if (targetType !== 'schedule') return false;
                const allowedDriverActions = ['SCHEDULE_ASSIGNED', 'SCHEDULE_UPDATED', 'TRIP_STARTED', 'TRIP_COMPLETED'];
                if (!allowedDriverActions.includes(action)) return false;
                const scheduleIds = driverSchedules.map(s => s.scheduleId);
                return scheduleIds.includes(targetId);
            }
            case 'staff': {
                const staffWhitelist = [
                    'CREATE_ROUTE', 'UPDATE_ROUTE',
                    'CREATE_VEHICLE', 'UPDATE_VEHICLE',
                    'CREATE_SCHEDULE', 'UPDATE_SCHEDULE',
                    'TRIP_STARTED', 'TRIP_COMPLETED',
                    'CREATE_FUEL_LOG', 'UPDATE_FUEL_LOG', 'DELETE_FUEL_LOG'
                ];
                return staffWhitelist.includes(action);
            }
            case 'supervisor': {
                const supervisorWhitelist = [
                    'CREATE_ROUTE', 'UPDATE_ROUTE', 'GENERATED_ROUTE_MAP',
                    'CREATE_VEHICLE', 'UPDATE_VEHICLE',
                    'CREATE_SCHEDULE', 'UPDATE_SCHEDULE',
                    'TRIP_STARTED', 'TRIP_COMPLETED',
                    // Conflict actions visible for supervisor
                    'CONFLICT_DETECTED',
                    'CONFLICT_RESOLVED',
                    'CONFLICT_DISMISSED'
                ];
                return supervisorWhitelist.includes(action);
            }
            case 'admin': {
                const superadminOnlyActions = [];
                return !superadminOnlyActions.includes(action);
            }
            case 'superadmin':
                return true;
            default:
                return true;
        }
    });
}

let activityRefreshInterval = null;

async function loadRecentActivity() {
    if (!currentUser) return;
    try {
        const logs = await getRecentActivityLogs(20);
        const normalizedLogs = logs.map(entry => ({
            ...entry,
            action: normalizeAction(entry.action)
        }));

        let filtered = filterActivityByRole(normalizedLogs, currentUser.role, currentUser.uid, driverSchedules);

        if (currentUser.role === 'driver' && filtered.length === 0 && driverSchedules.length > 0) {
            filtered = driverSchedules.map(schedule => ({
                action: 'SCHEDULE_ASSIGNED',
                performedBy: null,
                performedByName: 'System',
                targetId: schedule.scheduleId,
                targetType: 'schedule',
                timestamp: schedule.createdAt || Date.now()
            }));
        }

        filtered.sort((a, b) => {
            const tA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp || 0);
            const tB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp || 0);
            return tB - tA;
        });

        const latest10 = filtered.slice(0, 10);
        renderActivityList(latest10);
    } catch (error) {
        console.error('Failed to load recent activity:', error);
    }
}

function renderActivityList(activities) {
    activityList.innerHTML = '';
    if (activities.length === 0) {
        activityPlaceholder.style.display = 'block';
        activityList.style.display = 'none';
        return;
    }
    activityPlaceholder.style.display = 'none';
    activityList.style.display = 'flex';

    activities.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'activity-item';

        const icon = document.createElement('div');
        icon.className = 'activity-item-icon';
        const initials = (entry.performedByName || 'S').charAt(0).toUpperCase();
        icon.textContent = initials;

        const content = document.createElement('div');
        content.className = 'activity-item-content';

        const title = document.createElement('div');
        title.className = 'activity-item-title';
        title.textContent = buildActivityMessage(entry);

        const time = document.createElement('div');
        time.className = 'activity-item-time';
        time.textContent = timeAgo(entry.timestamp);

        content.appendChild(title);
        content.appendChild(time);
        item.appendChild(icon);
        item.appendChild(content);

        activityList.appendChild(item);
    });
}

function startActivityRefresh() {
    if (activityRefreshInterval) clearInterval(activityRefreshInterval);
    activityRefreshInterval = setInterval(loadRecentActivity, 30000);
}

/* ============================================================
   INITIALISE DASHBOARD
   ============================================================ */
async function initDashboard() {
    try {
        const currentUserLocal = await initRBAC('dashboard');
        if (!currentUserLocal) return;
        currentUser = currentUserLocal;

        populateUserInfo(currentUserLocal);
        applyRoleBasedUI(currentUserLocal.role);
        updateDateTime();
        setInterval(updateDateTime, 1000);

        const [users, routes, vehicles, schedules] = await Promise.all([
            getAllUsers(),
            getAllRoutes(),
            getAllVehicles(),
            getAllSchedules()
        ]);

        if (currentUserLocal.role === 'driver') {
            try {
                const driverData = await getDriverData(currentUserLocal.uid);
                const driverId = driverData?.driverId;
                const assignedRouteId = driverData?.assignedRouteId;

                const mySchedules = driverId
                    ? schedules.filter(s => s.driverId === driverId)
                    : [];
                driverSchedules = mySchedules;

                const myTrips = mySchedules.length;
                const completed = mySchedules.filter(s => s.status === 'Completed').length;
                const active = mySchedules.filter(s => s.status === 'In Progress').length;
                const onTime = mySchedules.filter(s => s.tripPerformance === 'On Time').length;
                const delayed = mySchedules.filter(s => s.tripPerformance === 'Delayed').length;

                setupDriverKPICards();
                updateDriverValues({
                    myTrips,
                    completed,
                    active,
                    onTime,
                    delayed,
                    assignedRouteId: assignedRouteId || '—'
                });
            } catch (err) {
                console.error('Failed to compute driver KPIs:', err);
                driverSchedules = [];
                setupDriverKPICards();
                updateDriverValues({
                    myTrips: 0,
                    completed: 0,
                    active: 0,
                    onTime: 0,
                    delayed: 0,
                    assignedRouteId: '—'
                });
            }
        } else {
            const totalUsers = users.length;
            const totalRoutes = routes.length;
            const activeVehicles = vehicles.filter(v => v.status === 'active').length;
            const trips = schedules.length;
            const onTime = schedules.filter(s => s.status === 'On Time').length;
            const delayed = schedules.filter(s => s.status === 'Delayed').length;

            if (currentUserLocal.role === 'staff') {
                const activeSchedules = schedules.filter(
                    s => s.status === 'Scheduled' || s.status === 'In Progress'
                ).length;
                updateKPIs(currentUserLocal.role, {
                    totalUsers: 0,
                    totalRoutes,
                    activeVehicles,
                    trips,
                    onTime,
                    delayed,
                    activeSchedules
                });
            } else {
                updateKPIs(currentUserLocal.role, {
                    totalUsers,
                    totalRoutes,
                    activeVehicles,
                    trips,
                    onTime,
                    delayed
                });
            }
        }

        setupNotifications(currentUserLocal);
        loadRecentActivity();
        startActivityRefresh();

        if (typeof animateNumbers === 'function') {
            animateNumbers('.stat-value');
        }
        if (typeof AOS !== 'undefined' && AOS.refresh) {
            AOS.refresh();
        }
    } catch (error) {
        console.error('Dashboard initialisation error:', error);
    }
}

function populateUserInfo(userData) {
    const { name, role } = userData;
    const firstName = name.split(' ')[0];
    displayNameEl.textContent = name;
    displayRoleEl.textContent = role;
    welcomeNameEl.textContent = firstName;

    if (role === 'superadmin') {
        welcomeMessageEl.textContent = 'You have full system control and analytics.';
    } else if (role === 'admin') {
        welcomeMessageEl.textContent = 'Manage depot operations and staff.';
    } else {
        welcomeMessageEl.textContent = 'Here’s your operational overview for today.';
    }

    displayRoleEl.className = 'role-badge';
    if (role === 'superadmin') {
        displayRoleEl.classList.add('role-superadmin');
    } else if (role === 'admin') {
        displayRoleEl.classList.add('role-admin');
    }
}

function applyRoleBasedUI(role) {
    const actions = QUICK_ACTIONS[role] || [];
    quickActionsContainer.innerHTML = actions
        .map(action => `<button class="action-btn">${action}</button>`)
        .join('');
}

function updateDateTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    currentDateTimeEl.textContent = dateStr;
}

function updateKPIs(role, counts = {}) {
    const { totalUsers, totalRoutes, activeVehicles, trips, onTime, delayed, activeSchedules } = counts;

    if (role === 'driver') return;

    if (role === 'staff') {
        statRoutes.textContent = totalRoutes !== undefined ? totalRoutes : '—';
        statVehicles.textContent = activeVehicles !== undefined ? activeVehicles : '—';
        statTrips.textContent = trips !== undefined ? trips : '0';
        statOnTime.textContent = onTime !== undefined ? onTime : '0';
        statDelayed.textContent = delayed !== undefined ? delayed : '0';
        statUsers.textContent = activeSchedules !== undefined ? activeSchedules : '0';
        statUsersLabel.textContent = 'Active Schedules';
        return;
    }

    if (role === 'supervisor') {
        statRoutes.textContent = totalRoutes !== undefined ? totalRoutes : '—';
        statVehicles.textContent = activeVehicles !== undefined ? activeVehicles : '—';
        statTrips.textContent = trips !== undefined ? trips : '0';
        statOnTime.textContent = onTime !== undefined ? onTime : '0';
        statDelayed.textContent = delayed !== undefined ? delayed : '0';
        statUsers.textContent = '0';
        statUsersLabel.textContent = 'Active Schedules';
        return;
    }

    statRoutes.textContent = totalRoutes !== undefined ? totalRoutes : '—';
    statVehicles.textContent = activeVehicles !== undefined ? activeVehicles : '—';
    statTrips.textContent = trips !== undefined ? trips : '0';
    statOnTime.textContent = onTime !== undefined ? onTime : '0';
    statDelayed.textContent = delayed !== undefined ? delayed : '0';
    statUsers.textContent = totalUsers !== undefined ? totalUsers : '—';
    statUsersLabel.textContent = 'Total Users';
}

function setupDriverKPICards() {
    document.querySelector('#statRoutesCard .stat-label').textContent = 'My Trips';
    document.querySelector('#statVehiclesCard .stat-label').textContent = 'Completed Trips';
    document.querySelector('#statTripsCard .stat-label').textContent = 'Active Trips';
    document.querySelector('#statOnTimeCard .stat-label').textContent = 'On-Time Trips';
    document.querySelector('#statDelayedCard .stat-label').textContent = 'Delayed Trips';
    document.querySelector('#statUsersCard .stat-label').textContent = 'Assigned Route';
    document.getElementById('statUsersLabel').textContent = 'Assigned Route';

    const driverIcons = {
        statRoutes: `<svg class="stat-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="5" width="24" height="23" rx="3.5" stroke="currentColor" stroke-width="1.6"/>
                        <path d="M4 12h24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                        <path d="M10 3v4M22 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                        <circle cx="10.5" cy="18.5" r="1.5" fill="currentColor"/>
                        <circle cx="16" cy="18.5" r="1.5" fill="currentColor"/>
                        <circle cx="21.5" cy="18.5" r="1.5" fill="currentColor"/>
                        <circle cx="10.5" cy="23.5" r="1.5" fill="currentColor"/>
                    </svg>`,
        statVehicles: `<svg class="stat-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="1.6"/>
                        <path d="M10 16l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>`,
        statTrips: `<svg class="stat-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="16" r="10" stroke="currentColor" stroke-width="1.6"/>
                        <path d="M16 8v8l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M8 4h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                    </svg>`,
        statOnTime: `<svg class="stat-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="1.6"/>
                        <path d="M16 9v7l3.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M9 26l3-2.5 2.5 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>`,
        statDelayed: `<svg class="stat-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="1.6"/>
                        <path d="M16 9v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                        <circle cx="16" cy="22" r="1.6" fill="currentColor"/>
                        <path d="M10 5l-1.5-1.5M22 5l1.5-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                    </svg>`,
        statUsers: `<svg class="stat-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <polyline points="4 22 10 16 16 22 22 10 28 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="10" cy="16" r="2" fill="currentColor"/>
                        <circle cx="16" cy="22" r="2" fill="currentColor"/>
                        <circle cx="22" cy="10" r="2" fill="currentColor"/>
                        <circle cx="28" cy="10" r="2" fill="currentColor"/>
                    </svg>`
    };

    for (let id in driverIcons) {
        const card = document.getElementById(id + 'Card');
        if (card) {
            const iconWrap = card.querySelector('.stat-icon-wrap');
            if (iconWrap) {
                iconWrap.innerHTML = driverIcons[id];
            }
        }
    }
}

function updateDriverValues({ myTrips, completed, active, onTime, delayed, assignedRouteId }) {
    document.getElementById('statRoutes').textContent = myTrips;
    document.getElementById('statVehicles').textContent = completed;
    document.getElementById('statTrips').textContent = active;
    document.getElementById('statOnTime').textContent = onTime;
    document.getElementById('statDelayed').textContent = delayed;
    document.getElementById('statUsers').textContent = assignedRouteId || '—';
}

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    if (
        window.innerWidth <= 768 &&
        !sidebar.contains(e.target) &&
        !sidebarToggle.contains(e.target)
    ) {
        sidebar.classList.remove('open');
    }
});

sidebarLogoutBtn.addEventListener('click', async () => {
    await logout();
});

sidebarNav.addEventListener('click', (e) => {
    const link = e.target.closest('.nav-item');
    if (link) {
        e.preventDefault();
        sidebarNav.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        link.classList.add('active');
        window.location.href = link.getAttribute('href');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    if (typeof AOS !== 'undefined') {
        AOS.init({
            duration: 600,
            once: true
        });
    }
    initDashboard();
});