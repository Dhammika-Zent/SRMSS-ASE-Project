/* ============================================================
   ROUTEX TRANSIT — USERS MODULE (REFACTORED)
   ============================================================ */

// ---------- IMPORTS ----------
import { initRBAC } from './rbac-loader.js';
import { logout } from '../firebase/auth-service.js';
import {
    getAllUsers,
    createUserInFirestore,
    updateUserInFirestore,
    toggleUserStatus as firestoreToggleUserStatus,
    createDriverRecord,
    getDriverData,
    updateDriverRecord,
    createActivityLog,
    getAllDepots,
    getUserDepotId          // NEW
} from '../firebase/firestore-service.js';
import { getAllRoutes } from '../firebase/firestore-service.js';
import { createAuthUser } from '../firebase/auth-service.js';
import { notifyUserCreated, notifyUserDeactivated } from './notifications-service.js';

// ---------- STATE ----------
let currentUser = null;
let currentUsers = [];
let allRoutes = [];
let allDepots = [];
let activeFilters = {
    search: '',
    role: 'all',
    status: 'all'
};
let editUserId = null;

// ---------- ROLE HIERARCHY ----------
const ROLE_HIERARCHY = ['superadmin', 'admin', 'supervisor', 'staff', 'driver'];

// ---------- CREATABLE ROLES MAP ----------
const CREATABLE_ROLES = {
    superadmin: ['admin', 'supervisor', 'staff', 'driver'],
    admin: ['supervisor', 'staff', 'driver']
};

function getCreatableRoles(role) {
    return CREATABLE_ROLES[role] || [];
}

// ---------- DOM REFERENCES ----------
const tableBody = document.getElementById('usersTableBody');
const tableResponsive = document.getElementById('tableResponsive');
const tableSkeleton = document.getElementById('tableSkeleton');
const emptyState = document.getElementById('emptyState');
const resultsCount = document.getElementById('resultsCount');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const roleFilter = document.getElementById('roleFilter');
const statusFilter = document.getElementById('statusFilter');
const activeFiltersContainer = document.getElementById('activeFilters');
const addUserBtn = document.getElementById('addUserBtn');
const modalOverlay = document.getElementById('userModalOverlay');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const userForm = document.getElementById('userForm');
const userRoleSelect = document.getElementById('userRole');
const driverFieldsContainer = document.getElementById('driverFieldsContainer');
const submitBtn = document.getElementById('modalSubmitBtn');
const submitSpinner = document.getElementById('submitSpinner');
const submitBtnText = document.getElementById('submitBtnText');
const headerStatsContainer = document.getElementById('headerStats');
const emptyStateClearBtn = document.getElementById('emptyStateClearBtn');
const togglePassword1 = document.getElementById('togglePassword1');
const togglePassword2 = document.getElementById('togglePassword2');
const userPassword = document.getElementById('userPassword');
const userConfirmPassword = document.getElementById('userConfirmPassword');
const logoutBtn = document.getElementById('logoutBtn');
const driverRouteSelect = document.getElementById('driverRoute');
const viewUserModalOverlay = document.getElementById('userViewModalOverlay');
const viewUserModalCloseBtn = document.getElementById('viewModalCloseBtn');
const viewUserModalCloseBtn2 = document.getElementById('viewModalCloseBtn');
const depotFieldGroup = document.getElementById('depotFieldGroup');
const depotSelect = document.getElementById('userDepot');

// ---------- PERMISSION HELPERS ----------
function getRoleIndex(role) {
    return ROLE_HIERARCHY.indexOf(role);
}

function canEditUser(targetUser) {
    if (!currentUser) return false;
    if (currentUser.role === 'superadmin') return true;
    if (targetUser.id === currentUser.uid) return false;
    if (currentUser.role === 'staff' || currentUser.role === 'driver') return false;
    const currentIdx = getRoleIndex(currentUser.role);
    const targetIdx = getRoleIndex(targetUser.role);
    if (currentIdx === -1 || targetIdx === -1) return false;
    return currentIdx < targetIdx;
}

function canDeactivateUser(targetUser) {
    if (!currentUser) return false;
    if (currentUser.role === 'superadmin' && targetUser.id === currentUser.uid) return false;
    return canEditUser(targetUser);
}

function canViewUser() {
    return true;
}

// ---------- SORT HELPERS ----------
function getPinPriority(user) {
    if (currentUser && user.id === currentUser.uid) return 0;
    if (user.role === 'superadmin') return 1;
    return 2;
}

function sortWithPinned(users) {
    return [...users].sort((a, b) => getPinPriority(a) - getPinPriority(b));
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

// ---------- INITIALISATION ----------
document.addEventListener('DOMContentLoaded', async () => {
    // RBAC init
    currentUser = await initRBAC('users');
    if (!currentUser) return;

    // Hide Add User button for roles that cannot create users
    if (addUserBtn) {
        const creatable = getCreatableRoles(currentUser.role);
        if (creatable.length === 0) {
            addUserBtn.style.display = 'none';
        } else {
            addUserBtn.style.display = '';   // ensure visible for permitted roles
        }
    }

    populateTopbar(currentUser);
    setupSidebarToggle();
    updateDateTime();
    attachEventListeners();
    initPasswordToggles();
    await loadRoutes();
    await loadDepots();
    loadUsers();
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

// ---------- Load routes & depots for dropdowns ----------
async function loadRoutes() {
    try {
        allRoutes = await getAllRoutes();
    } catch (error) {
        allRoutes = [];
        console.error('Failed to load routes for dropdown:', error);
    }
}

async function loadDepots() {
    try {
        allDepots = await getAllDepots();
    } catch (error) {
        allDepots = [];
        console.error('Failed to load depots:', error);
    }
}

function populateRouteDropdown() {
    if (!driverRouteSelect) return;
    while (driverRouteSelect.options.length > 1) {
        driverRouteSelect.remove(1);
    }
    const sortedRoutes = [...allRoutes].sort((a, b) =>
        (a.routeId || '').localeCompare(b.routeId || '')
    );
    sortedRoutes.forEach(route => {
        const option = document.createElement('option');
        option.value = route.routeId;
        option.textContent = `${route.routeId} - ${route.startPoint} → ${route.endPoint}`;
        driverRouteSelect.appendChild(option);
    });
}

function populateDepotDropdown() {
    if (!depotSelect) return;
    while (depotSelect.options.length > 1) {
        depotSelect.remove(1);
    }
    allDepots.forEach(depot => {
        const option = document.createElement('option');
        option.value = depot.depotId;
        option.textContent = depot.name || depot.depotId;
        depotSelect.appendChild(option);
    });
}

// ---------- LOAD USERS (UPDATED – depot-aware filtering) ----------
async function loadUsers() {
    try {
        tableSkeleton.style.display = 'block';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'none';

        // Build Firestore filter based on current user's role and depot
        let filters = {};
        if (currentUser.role !== 'superadmin') {
            if (currentUser.role === 'driver') {
                filters = { role: 'driver', uid: currentUser.uid };
            } else {
                // admin, supervisor, staff
                const depotId = await getUserDepotId(currentUser.uid);
                filters = { role: currentUser.role, depotId: depotId };
            }
        }

        const users = await getAllUsers(filters);

        const mergedUsers = await Promise.all(users.map(async (user) => {
            if (user.role === 'driver') {
                try {
                    const driver = await getDriverData(user.id);
                    return {
                        ...user,
                        licenseNo: driver?.licenseNo || null,
                        address: driver?.address || null,
                        assignedRouteId: driver?.assignedRouteId || null,
                        workingHours: driver?.workingHours || null,
                        driverDocId: driver?.id || null
                    };
                } catch { /* ignore */ }
            }
            return { ...user, licenseNo: null, address: null, assignedRouteId: null, workingHours: null };
        }));

        currentUsers = mergedUsers.map(user => {
            let parsedCreatedAt = null;
            try {
                const raw = user.createdAt;
                if (raw) {
                    if (typeof raw.toDate === 'function') {
                        parsedCreatedAt = raw.toDate();
                    } else if (typeof raw === 'string') {
                        parsedCreatedAt = new Date(raw);
                    } else if (raw instanceof Date) {
                        parsedCreatedAt = raw;
                    } else {
                        parsedCreatedAt = new Date(raw);
                    }
                    if (isNaN(parsedCreatedAt.getTime())) throw new Error('Invalid date');
                }
            } catch (parseErr) {
                console.error('Failed to parse createdAt for user', user.id, raw, parseErr);
                parsedCreatedAt = null;
            }
            return {
                id: user.id,
                fullName: user.name || 'Unknown',
                email: user.email || '',
                phone: user.phone || '',
                role: user.role || 'staff',
                status: user.status || 'active',
                depotId: user.depotId || null,
                createdAt: parsedCreatedAt,
                avatarInitials: user.name ? getInitials(user.name) : 'NA',
                licenseNo: user.licenseNo,
                address: user.address,
                assignedRouteId: user.assignedRouteId,
                workingHours: user.workingHours
            };
        });

        tableSkeleton.style.display = 'none';
        applyFiltersAndRender();
    } catch (error) {
        tableSkeleton.style.display = 'none';
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
        showToast(error.message || 'Failed to load users.', 'error');
        console.error('loadUsers error:', error);
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
    const total = currentUsers.length;
    const activeCount = currentUsers.filter(u => u.status === 'active').length;
    const driverCount = currentUsers.filter(u => u.role === 'driver').length;

    headerStatsContainer.innerHTML = `
    <div class="header-stat">
      <svg class="header-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
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
        <rect x="1" y="3" width="15" height="13" rx="2"/>
        <circle cx="18" cy="17" r="2"/>
        <circle cx="18" cy="9" r="2"/>
        <circle cx="7" cy="17" r="2"/>
      </svg>
      <span class="header-stat-value">${driverCount}</span>
      <span class="header-stat-label">Drivers</span>
    </div>
  `;
}

// ---------- FILTERING ----------
function getFilteredUsers() {
    let filtered = currentUsers;
    const term = activeFilters.search.toLowerCase().trim();
    if (term) {
        filtered = filtered.filter(u =>
            u.fullName.toLowerCase().includes(term) ||
            u.email.toLowerCase().includes(term) ||
            u.phone.includes(term)
        );
    }
    if (activeFilters.role !== 'all') filtered = filtered.filter(u => u.role === activeFilters.role);
    if (activeFilters.status !== 'all') filtered = filtered.filter(u => u.status === activeFilters.status);
    return filtered;
}

function applyFiltersAndRender() {
    const filtered = getFilteredUsers();
    renderUsersTable(filtered);
    renderActiveFilterTags();
    updateResultsCount(filtered.length);
    renderHeaderStats();
}

// ---------- DEPOT HELPER (FIXED) ----------
function getDepotName(depotId) {
    if (!depotId) return '—';
    const depot = allDepots.find(d => d.depotId === depotId);
    return depot ? (depot.depotName || depotId) : depotId;
}

// ---------- RENDER TABLE ----------
function renderUsersTable(users = null) {
    if (!tableBody) return;
    const raw = users || getFilteredUsers();
    const data = sortWithPinned(raw);
    tableBody.innerHTML = '';

    if (data.length === 0) {
        tableResponsive.style.display = 'none';
        emptyState.style.display = 'flex';
    } else {
        tableResponsive.style.display = 'block';
        emptyState.style.display = 'none';

        data.forEach(user => {
            const isSelf = currentUser && user.id === currentUser.uid;
            const isSuperAdmin = user.role === 'superadmin';
            const canEdit = canEditUser(user);
            const canDeactivate = canDeactivateUser(user);

            const meBadgeHTML = isSelf ? `<span class="me-badge">Me</span>` : '';

            const editBtnHTML = canEdit ? `
                <button class="action-icon-btn" title="Edit" data-action="edit" data-id="${user.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                </button>` : '';

            const deactivateBtnHTML = canDeactivate ? `
                <button class="action-icon-btn" title="${user.status === 'active' ? 'Deactivate' : 'Activate'}" data-action="toggle-status" data-id="${user.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                    </svg>
                </button>` : '';

            let rowClasses = '';
            if (isSelf) rowClasses += ' row-self row-pinned';
            else if (isSuperAdmin) rowClasses += ' row-pinned';

            const tr = document.createElement('tr');
            if (rowClasses) tr.className = rowClasses.trim();
            tr.setAttribute('data-id', user.id);

            tr.innerHTML = `
        <td class="col-avatar" data-label="User">
          <div class="user-avatar-cell">
            <div class="user-avatar">${user.avatarInitials}</div>
          </div>
        </td>
        <td class="col-name" data-label="Name">
          <span class="user-name-cell">${user.fullName}${meBadgeHTML}</span>
        </td>
        <td class="col-email"  data-label="Email">${user.email}</td>
        <td class="col-phone"  data-label="Phone">${user.phone}</td>
        <td class="col-role"   data-label="Role">
          <span class="role-badge-table role-${user.role}">${user.role}</span>
        </td>
        <td class="col-status" data-label="Status">
          <span class="status-badge ${user.status}">${user.status}</span>
        </td>
        <td class="col-depot"  data-label="Depot">${getDepotName(user.depotId)}</td>
        <td class="col-date"   data-label="Created">${formatDate(user.createdAt)}</td>
        <td class="col-actions" data-label="Actions">
          <div class="actions-cell">
            <button class="action-icon-btn" title="View" data-action="view" data-id="${user.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"/>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              </svg>
            </button>
            ${editBtnHTML}
            ${deactivateBtnHTML}
          </div>
        </td>
      `;
            tableBody.appendChild(tr);
        });

        document.querySelectorAll('.action-icon-btn[data-action="view"]').forEach(btn =>
            btn.addEventListener('click', e => handleViewUser(e.currentTarget.dataset.id)));
        document.querySelectorAll('.action-icon-btn[data-action="edit"]').forEach(btn =>
            btn.addEventListener('click', e => handleEditUser(e.currentTarget.dataset.id)));
        document.querySelectorAll('.action-icon-btn[data-action="toggle-status"]').forEach(btn =>
            btn.addEventListener('click', e => handleToggleStatus(e.currentTarget.dataset.id)));
    }
}

// ---------- ACTION HANDLERS ----------
function handleViewUser(id) {
    const user = currentUsers.find(u => u.id === id);
    if (!user) return;
    if (!canViewUser(user)) {
        showToast('You do not have permission to view this user.', 'error');
        return;
    }
    openViewModal(user);
}

function handleEditUser(id) {
    const user = currentUsers.find(u => u.id === id);
    if (!user) return;
    if (!canEditUser(user)) {
        showToast('You do not have permission to edit this user.', 'error');
        return;
    }
    openModal('edit', user);
}

async function handleToggleStatus(id) {
    const user = currentUsers.find(u => u.id === id);
    if (!user) return;
    if (!canDeactivateUser(user)) {
        showToast('You do not have permission to change this user\'s status.', 'error');
        return;
    }
    try {
        const newStatus = await firestoreToggleUserStatus(id, user.status);
        user.status = newStatus;
        if (newStatus === 'inactive') {
            await createActivityLog({
                action: 'DISABLE_USER',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: id,
                targetType: 'user'
            });
            await notifyUserDeactivated({ name: user.fullName });
        }
        applyFiltersAndRender();
        showToast(`Status changed to ${newStatus}`, 'success');
    } catch (error) {
        showToast(error.message || 'Failed to update status.', 'error');
    }
}

// ---------- ACTIVE FILTER TAGS ----------
function renderActiveFilterTags() {
    if (!activeFiltersContainer) return;
    let html = '';
    if (activeFilters.role !== 'all') {
        html += `<span class="filter-tag">Role: ${activeFilters.role}
            <button class="filter-tag-close" data-filter="role">
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
    if (activeFilters.role !== 'all' || activeFilters.status !== 'all') {
        html += `<button class="filter-clear-all" id="clearAllFilters">Clear All</button>`;
    }
    activeFiltersContainer.innerHTML = html;

    document.querySelectorAll('.filter-tag-close').forEach(btn =>
        btn.addEventListener('click', e => {
            const type = e.currentTarget.dataset.filter;
            if (type === 'role') { activeFilters.role = 'all'; roleFilter.value = 'all'; }
            if (type === 'status') { activeFilters.status = 'all'; statusFilter.value = 'all'; }
            applyFiltersAndRender();
        }));
    const clearAllBtn = document.getElementById('clearAllFilters');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            activeFilters = { search: '', role: 'all', status: 'all' };
            searchInput.value = '';
            searchClear.style.display = 'none';
            roleFilter.value = 'all';
            statusFilter.value = 'all';
            applyFiltersAndRender();
        });
    }
}

function updateResultsCount(count) {
    if (resultsCount) resultsCount.textContent = count;
}

// ---------- EVENT LISTENERS ----------
function attachEventListeners() {
    searchInput.addEventListener('input', e => {
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
    roleFilter.addEventListener('change', e => { activeFilters.role = e.target.value; applyFiltersAndRender(); });
    statusFilter.addEventListener('change', e => { activeFilters.status = e.target.value; applyFiltersAndRender(); });
    addUserBtn.addEventListener('click', () => openModal('add'));
    modalCloseBtn.addEventListener('click', closeModal);
    modalCancelBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
    userRoleSelect.addEventListener('change', handleRoleChange);
    userForm.addEventListener('submit', handleFormSubmit);
    if (emptyStateClearBtn) {
        emptyStateClearBtn.addEventListener('click', () => {
            activeFilters = { search: '', role: 'all', status: 'all' };
            searchInput.value = '';
            searchClear.style.display = 'none';
            roleFilter.value = 'all';
            statusFilter.value = 'all';
            applyFiltersAndRender();
        });
    }
}

// ---------- DYNAMIC ROLE DROPDOWN ----------
function populateRoleDropdown(allowedRoles, selectedRole = '') {
    while (userRoleSelect.options.length > 1) {
        userRoleSelect.remove(1);
    }

    allowedRoles.forEach(role => {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        userRoleSelect.appendChild(option);
    });

    if (selectedRole && allowedRoles.includes(selectedRole)) {
        userRoleSelect.value = selectedRole;
    } else {
        userRoleSelect.value = '';
    }
}

// ---------- MODAL ----------
function openModal(mode, userData = null) {
    document.getElementById('modalTitle').textContent =
        mode === 'edit' ? 'Edit User' : 'Add New User';
    submitBtnText.textContent = mode === 'edit' ? 'Update User' : 'Add User';

    userForm.reset();
    clearFormErrors();
    driverFieldsContainer.classList.remove('expanded');
    editUserId = null;

    const allowedRoles = getCreatableRoles(currentUser.role);
    let selectedRole = '';

    if (mode === 'edit' && userData) {
        editUserId = userData.id;
        document.getElementById('userFullName').value = userData.fullName || '';
        document.getElementById('userEmail').value = userData.email || '';
        document.getElementById('userPhone').value = userData.phone || '';
        selectedRole = userData.role || '';

        if (selectedRole && !allowedRoles.includes(selectedRole)) {
            selectedRole = '';
        }

        handleRoleChange();

        if (userData.role === 'driver') {
            document.getElementById('driverLicense').value = userData.licenseNo || '';
            document.getElementById('driverAddress').value = userData.address || '';
            document.getElementById('driverHours').value = userData.workingHours || '';
        }

        userPassword.required = false;
        userConfirmPassword.required = false;
    } else {
        userPassword.required = true;
        userConfirmPassword.required = true;
    }

    populateRoleDropdown(allowedRoles, selectedRole);
    populateRouteDropdown();
    populateDepotDropdown();

    // Depot field handling
    if (currentUser.role === 'superadmin') {
        depotFieldGroup.style.display = 'block';
        depotSelect.required = true;
        if (mode === 'edit' && userData && userData.depotId) {
            depotSelect.value = userData.depotId;
        } else {
            depotSelect.value = '';
        }
    } else {
        depotFieldGroup.style.display = 'none';
        depotSelect.required = false;
        depotSelect.value = '';
    }

    if (mode === 'edit' && userData && userData.assignedRouteId) {
        driverRouteSelect.value = userData.assignedRouteId;
    }

    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    userForm.reset();
    clearFormErrors();
}

function handleRoleChange() {
    const role = userRoleSelect.value;
    if (role === 'driver') {
        driverFieldsContainer.classList.add('expanded');
        document.getElementById('driverLicense').required = true;
        document.getElementById('driverAddress').required = true;
    } else {
        driverFieldsContainer.classList.remove('expanded');
        document.getElementById('driverLicense').required = false;
        document.getElementById('driverAddress').required = false;
    }
}

// ---------- FORM SUBMISSION ----------
async function handleFormSubmit(e) {
    e.preventDefault();
    if (!validateForm()) return;

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    const userPayload = {
        name: document.getElementById('userFullName').value.trim(),
        email: document.getElementById('userEmail').value.trim(),
        phone: document.getElementById('userPhone').value.trim(),
        role: userRoleSelect.value,
        status: editUserId
            ? (currentUsers.find(u => u.id === editUserId)?.status || 'active')
            : 'active',
        firstLogin: true,
    };

    // ---------- FIX: Assign depotId correctly for all roles ----------
    if (currentUser.role === 'superadmin') {
        // Super Admin picks a depot from the dropdown
        userPayload.depotId = depotSelect.value;
    } else {
        // Non-superadmin (Admin, Supervisor, etc.) must inherit their own depotId
        if (!currentUser.depotId) {
            showToast('Your account is missing a depot assignment. Cannot create user.', 'error');
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
            return;
        }
        userPayload.depotId = currentUser.depotId;
    }
    // ----------------------------------------------------------------

    try {
        if (editUserId) {
            const targetUser = currentUsers.find(u => u.id === editUserId);
            if (targetUser && !canEditUser(targetUser)) {
                throw new Error('You do not have permission to edit this user.');
            }
            const updateData = {
                name: userPayload.name,
                email: userPayload.email,
                phone: userPayload.phone,
                role: userPayload.role
            };
            if (currentUser.role === 'superadmin') {
                updateData.depotId = userPayload.depotId;
            }

            await updateUserInFirestore(editUserId, updateData);
            if (userPayload.role === 'driver') {
                const driver = await getDriverData(editUserId);
                const driverFields = {
                    userId: editUserId,
                    licenseNo: document.getElementById('driverLicense').value.trim(),
                    address: document.getElementById('driverAddress').value.trim(),
                    assignedRouteId: document.getElementById('driverRoute').value,
                    workingHours: document.getElementById('driverHours').value,
                };
                if (driver) {
                    await updateDriverRecord(driver.id, driverFields);
                } else {
                    await createDriverRecord({ ...driverFields, createdAt: new Date().toISOString() });
                }
            }
            await createActivityLog({
                action: 'UPDATE_USER',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: editUserId,
                targetType: 'user'
            });
            showToast('User updated successfully.', 'success');
        } else {
            const password = document.getElementById('userPassword').value;
            const userCredential = await createAuthUser(userPayload.email, password);
            const uid = userCredential.user.uid;
            const newUserData = { ...userPayload, createdAt: new Date().toISOString() };
            // depotId already included thanks to the fix above
            await createUserInFirestore(newUserData, uid);
            if (userPayload.role === 'driver') {
                await createDriverRecord({
                    userId: uid,
                    licenseNo: document.getElementById('driverLicense').value.trim(),
                    address: document.getElementById('driverAddress').value.trim(),
                    assignedRouteId: document.getElementById('driverRoute').value,
                    workingHours: document.getElementById('driverHours').value,
                    createdAt: new Date().toISOString(),
                });
            }
            await createActivityLog({
                action: 'CREATE_USER',
                performedBy: currentUser?.uid || 'unknown',
                performedByName: currentUser?.name || 'Unknown',
                targetId: uid,
                targetType: 'user'
            });
            await notifyUserCreated({ name: userPayload.name, role: userPayload.role });
            showToast('User added successfully.', 'success');
        }
        closeModal();
        await loadUsers();
    } catch (error) {
        showToast(error.message || 'Operation failed.', 'error');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// ---------- FORM VALIDATION ----------
function validateForm() {
    let isValid = true;
    const name = document.getElementById('userFullName').value.trim();
    const email = document.getElementById('userEmail').value.trim();
    const phone = document.getElementById('userPhone').value.trim();
    const role = userRoleSelect.value;
    const pw = userPassword.value;
    const cpw = userConfirmPassword.value;

    clearFormErrors();

    if (!name) { showError('nameError', 'Full name is required.'); isValid = false; }
    if (!email || !isValidEmail(email)) { showError('emailError', 'Valid email is required.'); isValid = false; }
    if (!phone) { showError('phoneError', 'Phone number is required.'); isValid = false; }
    if (!role) { showError('roleError', 'Please select a role.'); isValid = false; }

    const allowedRoles = getCreatableRoles(currentUser.role);
    if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
        showError('roleError', 'You are not authorised to assign this role.');
        isValid = false;
    }

    if (!editUserId) {
        if (pw.length < 8) { showError('passwordError', 'Password must be at least 8 characters.'); isValid = false; }
        if (pw !== cpw) { showError('confirmPasswordError', 'Passwords do not match.'); isValid = false; }
    } else {
        if (pw && pw.length < 8) { showError('passwordError', 'Password must be at least 8 characters.'); isValid = false; }
        if (pw !== cpw) { showError('confirmPasswordError', 'Passwords do not match.'); isValid = false; }
    }

    if (role === 'driver') {
        const lic = document.getElementById('driverLicense').value.trim();
        const addr = document.getElementById('driverAddress').value.trim();
        if (!lic) { showError('licenseError', 'License number is required for drivers.'); isValid = false; }
        if (!addr) { showError('addressError', 'Address is required for drivers.'); isValid = false; }
    }

    // Depot validation for superadmin
    if (currentUser.role === 'superadmin') {
        if (!depotSelect.value) {
            showError('depotError', 'Assigned depot is required.');
            isValid = false;
        }
    }

    return isValid;
}

function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function clearFormErrors() {
    document.querySelectorAll('.form-error').forEach(e => {
        e.textContent = '';
        e.style.display = 'none';
    });
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

// ---------- PASSWORD TOGGLES ----------
function initPasswordToggles() {
    const setup = (btn, input) => btn.addEventListener('click', () => {
        const t = input.getAttribute('type') === 'password' ? 'text' : 'password';
        input.setAttribute('type', t);
        btn.classList.toggle('show-password');
    });
    if (togglePassword1 && userPassword) setup(togglePassword1, userPassword);
    if (togglePassword2 && userConfirmPassword) setup(togglePassword2, userConfirmPassword);
}

// ---------- VIEW USER MODAL ----------
function openViewModal(user) {
    if (!viewUserModalOverlay) return;

    document.getElementById('viewFullName').textContent = user.fullName || '—';
    document.getElementById('viewEmail').textContent = user.email || '—';
    document.getElementById('viewPhone').textContent = user.phone || '—';
    document.getElementById('viewRole').textContent = user.role || '—';
    document.getElementById('viewDepot').textContent = getDepotName(user.depotId);
    document.getElementById('viewStatus').textContent = user.status || '—';
    document.getElementById('viewCreatedDate').textContent = formatDate(user.createdAt);

    const driverSection = document.getElementById('viewDriverSection');
    if (user.role === 'driver') {
        driverSection.style.display = 'block';
        document.getElementById('viewLicenseNo').textContent = user.licenseNo || '—';
        document.getElementById('viewAddress').textContent = user.address || '—';
        document.getElementById('viewWorkingHours').textContent = user.workingHours || 'Flexible';

        const routeId = user.assignedRouteId;
        if (routeId) {
            const route = allRoutes.find(r => r.routeId === routeId);
            document.getElementById('viewAssignedRoute').textContent =
                route ? `${route.routeId} - ${route.startPoint} → ${route.endPoint}` : routeId;
        } else {
            document.getElementById('viewAssignedRoute').textContent = 'Unassigned';
        }
    } else {
        driverSection.style.display = 'none';
    }

    viewUserModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    viewUserModalCloseBtn.onclick = closeViewModal;
    viewUserModalCloseBtn2.onclick = closeViewModal;
    viewUserModalOverlay.onclick = (e) => {
        if (e.target === viewUserModalOverlay) closeViewModal();
    };
    document.addEventListener('keydown', escCloseViewModal);
}

function closeViewModal() {
    if (!viewUserModalOverlay) return;
    viewUserModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', escCloseViewModal);
}

function escCloseViewModal(e) {
    if (e.key === 'Escape') closeViewModal();
}

// ---------- UTILS ----------
function formatDate(dateValue) {
    if (!dateValue) return '—';
    try {
        const date = dateValue instanceof Date && !isNaN(dateValue) ? dateValue : new Date(dateValue);
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (e) {
        console.error('Invalid date:', dateValue, e);
        return '—';
    }
}