/* ============================================================
   ROUTEX TRANSIT — AUTHENTICATION (Modular Firebase)
   Login · error handling · UI states
   ============================================================ */

// ---------- IMPORTS (from the Firebase CDN & your config) ----------
import { auth } from '../firebase/firebase-config.js';

// Import the specific functions we need from Firebase Authentication
import {
    signInWithEmailAndPassword,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// ---------- NEW IMPORT for firstLogin check ----------
import { getCurrentUserData } from '../firebase/auth-service.js';

// ---------- DOM ELEMENTS ----------
const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.getElementById('togglePassword');
const loginButton = document.getElementById('loginButton');
const errorDiv = document.getElementById('errorMessage');
const rememberCheckbox = document.getElementById('rememberMe');
const forgotLink = document.getElementById('forgotPassword');

// ---------- SHOW / HIDE PASSWORD TOGGLE ----------
togglePasswordBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    // Toggle input type
    passwordInput.type = isPassword ? 'text' : 'password';
    // Toggle class to swap eye icons
    togglePasswordBtn.classList.toggle('show', isPassword);
    togglePasswordBtn.setAttribute(
        'aria-label',
        isPassword ? 'Hide password' : 'Show password'
    );
});

// ---------- FORGOT PASSWORD (placeholder) ----------
forgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    alert('Password reset will be available soon. Contact your administrator.');
});

// ---------- ERROR MESSAGE HELPERS ----------
function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.add('visible');
}

function clearError() {
    errorDiv.textContent = '';
    errorDiv.classList.remove('visible');
}

// ---------- LOADING STATE ----------
function setLoading(isLoading) {
    if (isLoading) {
        loginButton.classList.add('loading');
        loginButton.disabled = true;
    } else {
        loginButton.classList.remove('loading');
        loginButton.disabled = false;
    }
}

// ---------- LOGIN HANDLER ----------
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();   // stop page reload
    clearError();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    // Simple validation
    if (!email || !password) {
        showError('Please enter both email and password.');
        return;
    }

    setLoading(true);      // show spinner on button

    try {
        // --- Step 1: Set session persistence based on "Remember me" ---
        // LOCAL = stays logged in after browser close
        // SESSION = logged out when tab closes
        const persistence = rememberCheckbox.checked
            ? browserLocalPersistence
            : browserSessionPersistence;

        await setPersistence(auth, persistence);

        // --- Step 2: Sign in with email & password ---
        const userCredential = await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

        // Success! Now check whether the user needs a password reset.
        console.log('✅ Logged in as:', userCredential.user.email);

        // ---- NEW: Check firstLogin flag ----
        try {
            const userData = await getCurrentUserData(userCredential.user);
            if (userData && userData.firstLogin) {
                // Force password reset
                window.location.href = '../pages/reset-password.html';
                return;
            }
        } catch (dataError) {
            // If we cannot read user data, fall back to normal dashboard
            console.warn('Could not read user document after login:', dataError);
        }
        // ---- END NEW ----

        // Normal redirection (firstLogin is false or unknown)
        window.location.href = '../pages/dashboard.html';

    } catch (error) {
        // Map Firebase error codes to friendly messages
        let message = 'Login failed. Please try again.';
        switch (error.code) {
            case 'auth/user-not-found':
            case 'auth/wrong-password':
            case 'auth/invalid-credential':
                message = 'Invalid email or password.';
                break;
            case 'auth/too-many-requests':
                message = 'Too many attempts. Please wait and try again.';
                break;
            case 'auth/invalid-email':
                message = 'Please enter a valid email address.';
                break;
            default:
                message = error.message;
        }
        showError(message);
    } finally {
        setLoading(false);   // hide spinner regardless of outcome
    }
});
