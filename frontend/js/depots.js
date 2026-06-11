// depots.js – RouteX Depot Management Module
import { initRBAC } from '../js/rbac-loader.js';
import {
    getAllDepots,
    createDepotInFirestore,
    updateDepotInFirestore,
    deleteDepotFromFirestore,
    getUsersByRole
} from '../firebase/firestore-service.js';

// ---------- STATE ----------
let currentUser = null;
let allDepots = [];
let adminUsers = [];
let currentPage = 1;
const itemsPerPage = 10;
let sortField = 'depotId';
let sortDirection = 'asc';
let searchTerm = '';
let statusFilter = 'all';
let deleteTargetId = null;

// ---------- INITIALISATION ----------
document.addEventListener('DOMContentLoaded', async () => {
    try {
        AOS.init({ once: true });
        await initializeDepotPage();
    } catch (err) {
        console.error('Depot page init error:', err);
        showToast('Failed to initialise page.', 'error');
    }
});

async function initializeDepotPage() {
    // 1. Authenticate & enforce Super Admin
    const user = await initRBAC('depots');
    if (!user) return;
    if (user.role !== 'superadmin') {
        window.location.href = 'dashboard.html';
        return;
    }
    currentUser = user;

    // 2. Set topbar user info
    document.getElementById('displayName').textContent = user.name || 'Super Admin';
    const roleEl = document.getElementById('displayRole');
    roleEl.textContent = 'superadmin';
    roleEl.classList.add('role-superadmin');
    updateDateTime();

    // 3. Load admin users
    try {
        adminUsers = await getUsersByRole('admin');
    } catch (err) {
        console.error('Failed to load admin users:', err);
        adminUsers = [];
        showToast('Failed to load admin users. Some features may be limited.', 'error');
    }

    // 4. Setup UI event listeners
    setupEventListeners();

    // 5. Load data
    await loadDepotKPIs();
    await loadDepotTable();
}

// ---------- DATETIME ----------
function updateDateTime() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('dateTimeText').textContent = now.toLocaleDateString('en-US', options);
}

// ---------- KPI CARDS ----------
async function loadDepotKPIs() {
    try {
        allDepots = await getAllDepots();
        const total = allDepots.length;
        const active = allDepots.filter(d => d.status === 'active').length;
        const inactive = total - active;
        const totalCap = allDepots.reduce((sum, d) => sum + (Number(d.capacity) || 0), 0);

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statActive').textContent = active;
        document.getElementById('statInactive').textContent = inactive;
        document.getElementById('statCap').textContent = totalCap;
    } catch (err) {
        console.error('KPI load error:', err);
        showToast('Failed to load depot statistics.', 'error');
    }
}

// ---------- TABLE LOGIC ----------
function resolveAdminName(depot) {
    if (depot.adminUserId) {
        const admin = adminUsers.find(a => a.id === depot.adminUserId);
        return admin ? (admin.name || admin.email || admin.id) : 'Unknown Admin';
    }
    // backward compatibility – if managerName exists and no adminUserId
    if (depot.managerName) return depot.managerName;
    return 'Unassigned';
}

function filterAndSortDepots() {
    let data = [...allDepots];

    // Augment with resolved admin name for sorting/display
    data = data.map(d => ({
        ...d,
        _adminName: resolveAdminName(d)
    }));

    // Search
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        data = data.filter(d =>
            d.depotId.toLowerCase().includes(term) ||
            (d.depotName || '').toLowerCase().includes(term) ||
            (d.location || '').toLowerCase().includes(term)
        );
    }

    // Status filter
    if (statusFilter !== 'all') {
        data = data.filter(d => d.status === statusFilter);
    }

    // Sort
    data.sort((a, b) => {
        let valA, valB;
        if (sortField === 'adminName' || sortField === 'managerName') {
            valA = a._adminName;
            valB = b._adminName;
        } else {
            valA = a[sortField] || '';
            valB = b[sortField] || '';
        }
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    return data;
}

function renderDepotTable() {
    const filtered = filterAndSortDepots();
    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * itemsPerPage;
    const pageData = filtered.slice(start, start + itemsPerPage);

    const tbody = document.getElementById('depotTableBody');
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        document.getElementById('tableEmpty').style.display = 'block';
        document.getElementById('depotTableContainer').style.display = 'none';
        document.getElementById('paginationControls').style.display = 'none';
        return;
    }

    document.getElementById('tableEmpty').style.display = 'none';
    document.getElementById('depotTableContainer').style.display = 'block';
    document.getElementById('paginationControls').style.display = 'flex';

    pageData.forEach(depot => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${depot.depotId}</td>
            <td>${depot.depotName || ''}</td>
            <td>${depot.location || ''}</td>
            <td>${depot._adminName}</td>
            <td>${depot.contactNo || ''}</td>
            <td>${depot.capacity || 0}</td>
            <td>${depot.currentVehicleCount ?? 0}</td>
            <td><span class="status-badge ${depot.status}">${depot.status}</span></td>
            <td class="action-btns">
                <button class="action-btn view" data-id="${depot.id}">View</button>
                <button class="action-btn edit" data-id="${depot.id}">Edit</button>
                <button class="action-btn delete" data-id="${depot.id}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Attach action handlers
    document.querySelectorAll('.action-btn.view').forEach(btn => {
        btn.addEventListener('click', () => openViewDepotModal(btn.dataset.id));
    });
    document.querySelectorAll('.action-btn.edit').forEach(btn => {
        btn.addEventListener('click', () => openEditDepotModal(btn.dataset.id));
    });
    document.querySelectorAll('.action-btn.delete').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteTargetId = btn.dataset.id;
            const depot = allDepots.find(d => d.id === deleteTargetId);
            document.getElementById('deleteDepotName').textContent = depot?.depotName || 'Unknown';
            openModal('deleteModal');
        });
    });

    // Update pagination
    document.getElementById('prevPageBtn').disabled = currentPage === 1;
    document.getElementById('nextPageBtn').disabled = currentPage === totalPages;
    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
}

async function loadDepotTable() {
    document.getElementById('tableLoading').style.display = 'block';
    document.getElementById('tableError').style.display = 'none';
    document.getElementById('tableEmpty').style.display = 'none';
    document.getElementById('depotTableContainer').style.display = 'none';
    document.getElementById('paginationControls').style.display = 'none';

    try {
        allDepots = await getAllDepots();
        document.getElementById('tableLoading').style.display = 'none';
        renderDepotTable();
    } catch (err) {
        document.getElementById('tableLoading').style.display = 'none';
        document.getElementById('tableError').style.display = 'block';
    }
}

// ---------- MODAL HELPERS ----------
function openModal(id) {
    document.getElementById(id).classList.add('active');
}
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

// ---------- POPULATE ADMIN DROPDOWN ----------
function populateAdminDropdown(selectElement, selectedUserId = null) {
    selectElement.innerHTML = '<option value="">Select Admin User</option>';
    adminUsers.forEach(admin => {
        const option = document.createElement('option');
        option.value = admin.id;
        option.textContent = admin.name || admin.email || admin.id;
        if (selectedUserId && admin.id === selectedUserId) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });
}

// ---------- MODAL OPERATIONS ----------
function openCreateDepotModal() {
    document.getElementById('createDepotName').value = '';
    document.getElementById('createLocation').value = '';
    populateAdminDropdown(document.getElementById('createAdminUser'));
    document.getElementById('createContact').value = '';
    document.getElementById('createCapacity').value = '';
    document.getElementById('createCurrentVehicleCount').value = '';  // NEW
    document.getElementById('createStatus').value = 'active';
    clearErrors();
    openModal('createModal');
}

function openEditDepotModal(docId) {
    const depot = allDepots.find(d => d.id === docId);
    if (!depot) return;
    document.getElementById('editDocId').value = docId;
    document.getElementById('editDepotId').value = depot.depotId;
    document.getElementById('editDepotName').value = depot.depotName || '';
    document.getElementById('editLocation').value = depot.location || '';
    populateAdminDropdown(document.getElementById('editAdminUser'), depot.adminUserId || null);
    document.getElementById('editContact').value = depot.contactNo || '';
    document.getElementById('editCapacity').value = depot.capacity || '';
    document.getElementById('editCurrentVehicleCount').value = depot.currentVehicleCount ?? 0;  // NEW
    document.getElementById('editStatus').value = depot.status || 'active';
    clearErrors();
    openModal('editModal');
}

function openViewDepotModal(docId) {
    const depot = allDepots.find(d => d.id === docId);
    if (!depot) return;
    document.getElementById('viewDepotId').textContent = depot.depotId;
    document.getElementById('viewDepotName').textContent = depot.depotName || '';
    document.getElementById('viewLocation').textContent = depot.location || '';
    document.getElementById('viewAdmin').textContent = resolveAdminName(depot);
    document.getElementById('viewContact').textContent = depot.contactNo || '';
    document.getElementById('viewCapacity').textContent = depot.capacity || 0;
    document.getElementById('viewCurrentVehicleCount').textContent = depot.currentVehicleCount ?? 0;  // NEW
    const statusEl = document.getElementById('viewStatus');
    statusEl.textContent = depot.status;
    statusEl.className = `status-badge ${depot.status}`;
    openModal('viewModal');
}

// ---------- FORM SUBMISSIONS ----------
async function handleCreateSubmit(e) {
    e.preventDefault();
    clearErrors();
    let valid = true;

    const depotName = document.getElementById('createDepotName').value.trim();
    const location = document.getElementById('createLocation').value.trim();
    const adminUserId = document.getElementById('createAdminUser').value;
    const contact = document.getElementById('createContact').value.trim();
    const capacity = document.getElementById('createCapacity').value;
    const currentVehicleCount = document.getElementById('createCurrentVehicleCount').value;  // NEW
    const status = document.getElementById('createStatus').value;

    if (!/^0\d{9}$/.test(contact)) {
        document.getElementById('createContactErr').textContent = 'Invalid contact number (e.g., 0112345678).';
        valid = false;
    }
    if (!depotName) {
        document.getElementById('createDepotNameErr').textContent = 'Depot name is required.';
        valid = false;
    }
    if (!location) {
        document.getElementById('createLocationErr').textContent = 'Location is required.';
        valid = false;
    }
    if (!adminUserId) {
        document.getElementById('createAdminErr').textContent = 'Please select an admin user.';
        valid = false;
    }
    if (!capacity || Number(capacity) <= 0) {
        document.getElementById('createCapacityErr').textContent = 'Capacity must be a positive number.';
        valid = false;
    }
    // NEW validation for currentVehicleCount
    if (currentVehicleCount === '' || isNaN(currentVehicleCount) || Number(currentVehicleCount) < 0) {
        document.getElementById('createCurrentVehicleCountErr').textContent = 'Current vehicle count must be a number >= 0.';
        valid = false;
    }

    if (!valid) return;

    // Duplicate admin check
    if (allDepots.some(d => d.adminUserId === adminUserId)) {
        document.getElementById('createAdminErr').textContent = 'This admin is already assigned to another depot.';
        return;
    }

    try {
        await createDepotInFirestore({
            depotName,
            location,
            adminUserId,
            contactNo: contact,
            capacity: Number(capacity),
            currentVehicleCount: Number(currentVehicleCount),  // no longer hardcoded 0
            status
        });
        closeModal('createModal');
        showToast('Depot created successfully.', 'success');
        await loadDepotKPIs();
        await loadDepotTable();
    } catch (err) {
        showToast('Failed to create depot.', 'error');
        console.error(err);
    }
}

async function handleEditSubmit(e) {
    e.preventDefault();
    clearErrors();
    const docId = document.getElementById('editDocId').value;
    const depotName = document.getElementById('editDepotName').value.trim();
    const location = document.getElementById('editLocation').value.trim();
    const adminUserId = document.getElementById('editAdminUser').value;
    const contact = document.getElementById('editContact').value.trim();
    const capacity = document.getElementById('editCapacity').value;
    const currentVehicleCount = document.getElementById('editCurrentVehicleCount').value; // NEW
    const status = document.getElementById('editStatus').value;

    if (!/^0\d{9}$/.test(contact)) {
        document.getElementById('editContactErr').textContent = 'Invalid contact number.';
        return;
    }
    if (!adminUserId) {
        document.getElementById('editAdminErr').textContent = 'Please select an admin user.';
        return;
    }
    if (!depotName || !location || capacity <= 0) return;

    // NEW validation
    if (currentVehicleCount === '' || isNaN(currentVehicleCount) || Number(currentVehicleCount) < 0) {
        document.getElementById('editCurrentVehicleCountErr').textContent = 'Current vehicle count must be a number >= 0.';
        return;
    }

    // Duplicate admin check (excluding current depot)
    if (allDepots.some(d => d.id !== docId && d.adminUserId === adminUserId)) {
        document.getElementById('editAdminErr').textContent = 'This admin is already assigned to another depot.';
        return;
    }

    try {
        await updateDepotInFirestore(docId, {
            depotName,
            location,
            adminUserId,
            contactNo: contact,
            capacity: Number(capacity),
            currentVehicleCount: Number(currentVehicleCount),  // NEW
            status
        });
        closeModal('editModal');
        showToast('Depot updated.', 'success');
        await loadDepotKPIs();
        await loadDepotTable();
    } catch (err) {
        showToast('Update failed.', 'error');
    }
}

async function handleDelete() {
    if (!deleteTargetId) return;
    try {
        await deleteDepotFromFirestore(deleteTargetId);
        closeModal('deleteModal');
        showToast('Depot deleted.', 'success');
        await loadDepotKPIs();
        await loadDepotTable();
    } catch (err) {
        showToast('Delete failed.', 'error');
    }
}

// ---------- VALIDATION HELPERS ----------
function clearErrors() {
    document.querySelectorAll('.error-msg').forEach(el => el.textContent = '');
}

// ---------- TOAST ----------
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ---------- EVENT LISTENERS ----------
function setupEventListeners() {
    // Sidebar toggle
    document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

    // Search
    document.getElementById('depotSearch').addEventListener('input', (e) => {
        searchTerm = e.target.value.trim();
        currentPage = 1;
        renderDepotTable();
    });

    // Status filter
    document.getElementById('statusFilter').addEventListener('change', (e) => {
        statusFilter = e.target.value;
        currentPage = 1;
        renderDepotTable();
    });

    // Sort headers
    document.querySelectorAll('.depot-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (sortField === field) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortField = field;
                sortDirection = 'asc';
            }
            // Update header classes
            document.querySelectorAll('.depot-table th').forEach(h => {
                h.classList.remove('asc', 'desc');
            });
            th.classList.add(sortDirection);
            renderDepotTable();
        });
    });

    // Pagination
    document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderDepotTable();
        }
    });
    document.getElementById('nextPageBtn').addEventListener('click', () => {
        const totalPages = Math.ceil(filterAndSortDepots().length / itemsPerPage) || 1;
        if (currentPage < totalPages) {
            currentPage++;
            renderDepotTable();
        }
    });

    // Add Depot button
    document.getElementById('addDepotBtn').addEventListener('click', openCreateDepotModal);

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeAllModals());
    });

    // Form submissions
    document.getElementById('createDepotForm').addEventListener('submit', handleCreateSubmit);
    document.getElementById('editDepotForm').addEventListener('submit', handleEditSubmit);
    document.getElementById('confirmDeleteBtn').addEventListener('click', handleDelete);

    // Retry button
    document.getElementById('retryBtn').addEventListener('click', loadDepotTable);

    // Notification bell toggle (preserve existing logic)
    const bell = document.getElementById('notificationBell');
    const dropdown = document.getElementById('notificationDropdown');
    if (bell && dropdown) {
        bell.addEventListener('click', () => dropdown.classList.toggle('open'));
        document.addEventListener('click', (e) => {
            if (!bell.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });
    }
}

// ---------- SIDEBAR MOBILE LOGIC ----------
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('active');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('active');
}