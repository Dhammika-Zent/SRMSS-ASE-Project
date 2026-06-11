import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
    getAuth
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const firebaseConfig = {
    apiKey: "AIzaSyCEztO51ZgUX_U8FzEf8R8shWT65cvHfnk",
    authDomain: "routex-transit.firebaseapp.com",
    projectId: "routex-transit",
    storageBucket: "routex-transit.firebasestorage.app",
    messagingSenderId: "663031438715",
    appId: "1:663031438715:web:422875ae6e3483c929f1de",
    measurementId: "G-YC9JSC8VE9"
};

// Primary app (default) – used for all normal operations
const app = initializeApp(firebaseConfig);

// Secondary app – used exclusively for creating new users without
// overwriting the currently logged‑in admin’s session.
const secondaryApp = initializeApp(firebaseConfig, 'secondary');

const auth = getAuth(app);
const secondaryAuth = getAuth(secondaryApp);
const db = getFirestore(app);

export { auth, secondaryAuth, db };