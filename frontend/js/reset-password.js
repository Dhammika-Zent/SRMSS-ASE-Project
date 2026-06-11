/* ============================================================
   ROUTEX TRANSIT — FIRST LOGIN PASSWORD RESET
   ============================================================ */

import { auth, db } from '../firebase/firebase-config.js';
import {
    checkAuth,
    getCurrentUserData
} from '../firebase/auth-service.js';
import {
    updateUserInFirestore
} from '../firebase/firestore-service.js';
import {
    updatePassword,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// DOM elements
const resetForm = document.getElementById('resetPasswordForm');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const resetButton = document.getElementById('resetButton');
const errorDiv = document.getElementById('resetErrorMessage');
const successDiv = document.getElementById('resetSuccessMessage');
const userNameSpan = document.getElementById('resetUserName');
const userRoleSpan = document.getElementById('resetUserRole');

// Toggle password visibility
function setupToggle(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    btn.addEventListener('click', () => {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.classList.toggle('show', isPassword);
    });
}
setupToggle('toggleNewPassword', 'newPassword');
setupToggle('toggleConfirmPassword', 'confirmPassword');

// Validate password rules
function validatePassword(password) {
    const errors = [];
    if (password.length < 8) errors.push('at least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('one uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('one lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('one number');
    return errors;
}

// UI helpers
function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.add('visible');
    successDiv.classList.remove('visible');
}
function showSuccess(message) {
    successDiv.textContent = message;
    successDiv.classList.add('visible');
    errorDiv.classList.remove('visible');
}
function clearMessages() {
    errorDiv.classList.remove('visible');
    successDiv.classList.remove('visible');
}
function setLoading(isLoading) {
    if (isLoading) {
        resetButton.classList.add('loading');
        resetButton.disabled = true;
    } else {
        resetButton.classList.remove('loading');
        resetButton.disabled = false;
    }
}

// ---------- INIT ----------
async function initResetPage() {
    try {
        // 1. Ensure user is logged in
        const authUser = await checkAuth();
        if (!authUser) return; // redirects to login

        // 2. Get Firestore user data
        const userData = await getCurrentUserData(authUser);
        if (!userData) {
            // getCurrentUserData already forces logout if needed
            return;
        }

        // 3. IMPORTANT: Allow access only if firstLogin === true
        if (!userData.firstLogin) {
            // Already reset password – redirect to dashboard
            window.location.href = 'dashboard.html';
            return;
        }

        // 4. Populate UI
        userNameSpan.textContent = userData.name;
        userRoleSpan.textContent = userData.role;

        // 5. Handle form submission
        resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearMessages();

            const newPassword = newPasswordInput.value;
            const confirmPassword = confirmPasswordInput.value;

            // Client-side validation
            const passwordErrors = validatePassword(newPassword);
            if (passwordErrors.length > 0) {
                showError(`Password must contain: ${passwordErrors.join(', ')}.`);
                return;
            }
            if (newPassword !== confirmPassword) {
                showError('Passwords do not match.');
                return;
            }

            setLoading(true);
            try {
                // Update Firebase Authentication password
                await updatePassword(authUser, newPassword);

                // Update Firestore: set firstLogin = false
                await updateUserInFirestore(authUser.uid, { firstLogin: false });

                showSuccess('Password updated successfully! Redirecting...');

                // Short delay so user sees success message
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1500);

            } catch (error) {
                console.error('Password update failed:', error);
                let message = 'Failed to update password. Please try again.';
                if (error.code === 'auth/weak-password') {
                    message = 'Password is too weak. Use at least 8 characters with mixed case and numbers.';
                } else if (error.code === 'auth/requires-recent-login') {
                    message = 'Session expired. Please log out and log in again.';
                }
                showError(message);
            } finally {
                setLoading(false);
            }
        });

    } catch (error) {
        console.error('Reset page init error:', error);
        // Something went wrong – force redirect to login
        window.location.href = 'login.html';
    }
}

// Start everything after DOM is ready
document.addEventListener('DOMContentLoaded', initResetPage);