/* ============================================================
   ROUTEX TRANSIT — SHARED SIDEBAR RENDERER
   ============================================================
   Reusable function to render role‑filtered sidebar menus.
   Uses the same ROLE_PERMISSIONS as the dashboard to keep
   consistency across all protected pages.
   ============================================================ */

// ---- Role-Based Permissions (identical to dashboard.js) ----
const ROLE_PERMISSIONS = {
    superadmin: [
        'dashboard', 'users', 'depots', 'routes', 'vehicles', 'schedules',
        'fuel', 'maintenance', 'reports', 'analytics', 'conflicts', 'settings'
    ],
    admin: [
        'dashboard', 'users', 'routes', 'vehicles', 'schedules',
        'fuel', 'maintenance', 'reports', 'analytics', 'conflicts'
    ],
    supervisor: [
        'dashboard', 'routes', 'vehicles', 'schedules',
        'fuel', 'maintenance', 'reports', 'analytics', 'conflicts'
    ],
    staff: ['dashboard', 'routes', 'vehicles', 'schedules', 'fuel', 'maintenance'],
    driver: ['dashboard', 'schedules']
};

// ---- Page URLs mapping (data-page → href) ----
const PAGE_URLS = {
    dashboard: 'dashboard.html',
    users: 'users.html',
    depots: 'depots.html',
    routes: 'routes.html',
    vehicles: 'vehicles.html',
    schedules: 'schedules.html',
    fuel: 'fuel.html',
    maintenance: 'maintenance.html',
    reports: 'reports.html',
    analytics: 'analytics.html',
    conflicts: 'conflicts.html',
    settings: 'settings.html'
};

/**
 * Renders the sidebar navigation for the given role.
 * Expects a <nav> element with id="sidebarNav" and nav-items with data-page attributes.
 * Hides items not allowed, sets correct href, and marks the current page as active.
 *
 * @param {string} role        - The user's role (e.g. 'admin', 'driver')
 * @param {string} currentPage - The data-page value of the current page (e.g. 'users')
 */
export function renderRoleSidebar(role, currentPage = 'dashboard') {
    const sidebarNav = document.getElementById('sidebarNav');
    if (!sidebarNav) return;

    const allowedPages = ROLE_PERMISSIONS[role] || ['dashboard'];
    const navItems = sidebarNav.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        const page = item.dataset.page;
        if (!page) return;

        // Hide items not allowed for the role
        if (!allowedPages.includes(page)) {
            item.style.display = 'none';
            return;
        }

        // Ensure item is visible
        item.style.display = '';

        // Set the correct navigation link
        const url = PAGE_URLS[page] || '#';
        item.setAttribute('href', url);

        // Highlight the active page
        if (page === currentPage) {
            item.classList.add('active');
            item.setAttribute('aria-current', 'page');
        } else {
            item.classList.remove('active');
            item.removeAttribute('aria-current');
        }
    });
}