/* ============================================================
   ROUTEX TRANSIT — CENTRALISED RBAC INITIALISATION
   ============================================================ */
import { initializeProtectedPage } from '../firebase/auth-service.js';
import { renderRoleSidebar } from './sidebar.js';

/**
 * Initialise RBAC on any protected page.
 *
 * @param {string} currentPage - The data-page value of the current page
 *   (e.g. 'dashboard', 'schedules', 'routes', 'users', 'vehicles')
 * @returns {Promise<object|null>} The authenticated user object, or null if
 *   redirecting (e.g. to login or password reset).
 */
export async function initRBAC(currentPage) {
    const sidebar = document.getElementById('sidebar');

    // 1. Authenticate – will redirect to login if not authenticated
    const user = await initializeProtectedPage();
    if (!user) return null;

    // 2. Redirect to password reset if firstLogin is still true
    if (user.firstLogin) {
        window.location.href = 'reset-password.html';
        return null;
    }

    // 3. Render the role‑filtered sidebar (hide unauthorized items)
    renderRoleSidebar(user.role, currentPage);

    // 4. Fade in the sidebar (transition defined in CSS)
    if (sidebar) {
        sidebar.classList.add('rbac-ready');
    }

    // 5. Return the user object so the page can continue initialisation
    return user;
}