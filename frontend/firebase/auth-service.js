/* ============================================================
   ROUTEX TRANSIT — CENTRALISED AUTHENTICATION SERVICE
   ============================================================
   This module provides reusable, enterprise-grade functions for
   session management, user data retrieval and logout.

   It is the single point of contact for any page that requires
   authentication or wants to know the current user’s details.

   Features:
   • Checks authentication state with Firebase’s onAuthStateChanged
   • Redirects unauthenticated users to the login page
   • Fetches Firestore user document (role, status, etc.)
   • Gracefully handles missing/inactive accounts
   • Signs out the user and clears the session
   • Creates real Firebase Auth accounts (for admin user creation)
     using a secondary auth instance to preserve the admin session
   ============================================================ */

// ---------- IMPORTS (Firebase Modular SDK v10.x) ----------
// Auth & Firestore instances from the project’s central config
import { auth, secondaryAuth, db } from './firebase-config.js';

// Firebase Authentication functions
import {
    onAuthStateChanged,
    signOut,
    createUserWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// Firestore functions (document reads)
import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';


/* ============================================================
   CHECK AUTHENTICATION (Route Protection)
   ============================================================
   • Listens once to Firebase’s authentication state observer.
   • If no user is signed in, redirects immediately to login.html.
   • Returns the Firebase user object so pages can use it further.
   • This function MUST be awaited before rendering any protected UI.
   ============================================================ */
export async function checkAuth() {
    /*
     * onAuthStateChanged fires synchronously with the current state,
     * so wrapping it in a promise gives us a simple await‑friendly API.
     */
    const user = await new Promise((resolve, reject) => {
        // onAuthStateChanged takes a callback – we unsubscribe after the first call.
        const unsubscribe = onAuthStateChanged(
            auth,
            (firebaseUser) => {
                unsubscribe();          // stop listening immediately
                resolve(firebaseUser);  // may be null if signed out
            },
            (error) => {
                unsubscribe();
                reject(error);
            }
        );
    });

    // No authenticated user → redirect to login page.
    if (!user) {
        console.warn('🔒 No authenticated user – redirecting to login.');
        window.location.href = '../pages/login.html';
        return null; // Execution stops after redirect, but return null for safety.
    }

    console.log(`✅ Authenticated user: ${user.email}`);
    return user; // Firebase Auth user object (uid, email, etc.)
}


/* ============================================================
   GET CURRENT USER’S FIRESTORE DATA
   ============================================================
   • Reads the document from the “users” collection matching the UID.
   • If not found, falls back to searching by email.
   • Returns a clean object with:
       name, email, role, status, firstLogin, phone, depotId
   • If the document is still missing or the account is inactive,
     the user is signed out and redirected to login.
   • Firestore errors are logged and handled gracefully.
   ============================================================ */
export async function getCurrentUserData(authUser) {
    // Safety check – authUser must contain a uid
    if (!authUser || !authUser.uid) {
        console.error('❌ getCurrentUserData called without a valid auth user object.');
        return null;
    }

    try {
        // Reference to the user’s Firestore document by UID
        const userDocRef = doc(db, 'users', authUser.uid);
        const docSnap = await getDoc(userDocRef);

        // ---- Document exists ----
        if (docSnap.exists()) {
            const data = docSnap.data();

            // Account status check
            if (data.status !== 'active') {
                console.warn(`🚫 Inactive account (status: ${data.status}) – signing out.`);
                await performLogout();
                return null;
            }

            return {
                name: data.name || 'Unknown',
                email: data.email || authUser.email,
                role: data.role || 'staff',
                status: data.status || 'active',
                firstLogin: data.firstLogin || false,
                phone: data.phone || '',
                depotId: data.depotId || null          // ← FIX: include depotId
            };
        }

        // ---- UID document not found – fallback to email search ----
        console.warn(`⚠️ No Firestore document for UID: ${authUser.uid}. Searching by email...`);

        const usersCol = collection(db, 'users');
        const q = query(usersCol, where('email', '==', authUser.email));
        const querySnap = await getDocs(q);

        if (!querySnap.empty) {
            // Found a document with matching email – use its data
            const docData = querySnap.docs[0].data();
            console.warn(`ℹ️ Found user document by email: ${authUser.email}. Consider migrating to UID-based doc.`);

            if (docData.status !== 'active') {
                console.warn(`🚫 Inactive account (status: ${docData.status}) – signing out.`);
                await performLogout();
                return null;
            }

            return {
                name: docData.name || 'Unknown',
                email: docData.email || authUser.email,
                role: docData.role || 'staff',
                status: docData.status || 'active',
                firstLogin: docData.firstLogin || false,
                phone: docData.phone || '',
                depotId: docData.depotId || null       // ← FIX: include depotId
            };
        }

        // ---- No document found at all – force logout ----
        console.warn(`⚠️ No Firestore document for UID or email: ${authUser.uid}`);
        await performLogout();
        return null;

    } catch (error) {
        console.error('❌ Firestore error in getCurrentUserData:', error);
        // We do NOT sign out on a temporary Firestore error – the Auth session is still valid.
        return null;
    }
}


/* ============================================================
   CREATE AUTH USER (USES SECONDARY AUTH)
   ============================================================
   • Creates a real Firebase Authentication account using the
     secondary app instance so the admin remains logged in.
   • Immediately signs out the secondary auth to keep it clean.
   • Returns the full userCredential object (including user.uid).
   ============================================================ */
export async function createAuthUser(email, password) {
    try {
        // Use the secondary auth instance to create the account
        const userCredential = await createUserWithEmailAndPassword(
            secondaryAuth,
            email,
            password
        );
        console.log(`✅ Auth account created (secondary): ${userCredential.user.uid}`);

        // Sign out the secondary auth instance immediately – cleanup
        await signOut(secondaryAuth);
        console.log('🔓 Secondary auth instance signed out – admin session preserved.');

        return userCredential;
    } catch (error) {
        console.error('❌ createAuthUser failed:', error);
        // Attempt to sign out the secondary auth even on error to prevent a lingering session
        try {
            await signOut(secondaryAuth);
        } catch (signOutError) {
            console.error('❌ Secondary sign‑out error:', signOutError);
        }
        throw error;   // re-throw to let the caller handle it
    }
}


/* ============================================================
   LOGOUT
   ============================================================
   • Signs the user out of Firebase Authentication (primary instance).
   • Clears any session persistence (handled automatically by Firebase).
   • Redirects to the login page.
   • Logs success / failure for debugging.
   ============================================================ */
export async function logout() {
    try {
        await signOut(auth);
        console.log('👋 User signed out successfully.');
        window.location.href = '../pages/login.html';;
    } catch (error) {
        console.error('❌ Logout failed:', error);
        // Even if the Firebase call fails, attempt to redirect to a clean login state.
        window.location.href = '../pages/login.html';;
    }
}


/* ============================================================
   PRIVATE HELPER — performLogout (internal)
   ============================================================
   Used when an account is missing or inactive.
   Does the same as logout() but without the try/catch on redirect.
   ============================================================ */
async function performLogout() {
    try {
        await signOut(auth);
    } catch (err) {
        console.error('❌ Force logout error:', err);
    }
    // Always redirect to login, regardless of signOut success.
    window.location.href = '../pages/login.html';;
}



/* ============================================================
   INITIALIZE PROTECTED PAGE
   ============================================================ */
export async function initializeProtectedPage() {
    try {

        // Step 1 — Check Firebase Authentication
        const authUser = await checkAuth();

        if (!authUser) {
            return null;
        }

        // Step 2 — Get Firestore user data
        const userData = await getCurrentUserData(authUser);

        if (!userData) {
            return null;
        }

        // Step 3 — Merge Auth + Firestore data
        return {
            uid: authUser.uid,
            email: authUser.email,
            ...userData
        };

    } catch (error) {
        console.error('❌ initializeProtectedPage error:', error);

        window.location.href = '../pages/login.html';;

        return null;
    }
}