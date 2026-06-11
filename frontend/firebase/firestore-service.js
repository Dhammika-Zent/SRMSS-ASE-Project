/* ============================================================
   ROUTEX TRANSIT — FIRESTORE SERVICE (PHASE 2)
   Centralised Firestore data access layer.
   v10 Modular SDK · Enterprise‑grade · Viva‑friendly
   Depot‑aware fuel log & maintenance updates
   + Analytics Module depot‑aware helpers (appended)
   ============================================================ */

// ---------- IMPORTS ----------
import { db } from './firebase-config.js';

import {
    collection,
    getDocs,
    addDoc,
    doc,
    updateDoc,
    getDoc,
    query,
    where,
    orderBy,
    limit,
    setDoc,
    deleteDoc,
    serverTimestamp,
    arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ============================================================
//  USERS COLLECTION
// ============================================================

/**
 * Fetch user documents, optionally filtered by role/depot/uid.
 * @param {Object} [filters] - { role, depotId, uid }
 * @returns {Promise<Array>} Array of user objects { id, ...data }
 */
export async function getAllUsers(filters = {}) {
    try {
        const usersCol = collection(db, 'users');
        let q;
        const { role, depotId, uid } = filters;

        if (!role || role === 'superadmin') {
            q = usersCol;
        } else if (role === 'driver') {
            q = query(usersCol, where('__name__', '==', uid));
        } else {
            if (!depotId) {
                console.warn('⚠️ No depotId provided for non-superadmin/non-driver role. Returning empty set.');
                return [];
            }
            q = query(usersCol, where('depotId', '==', depotId));
        }

        const snapshot = await getDocs(q);
        const users = [];
        snapshot.forEach(doc => {
            users.push({
                id: doc.id,
                ...doc.data()
            });
        });
        console.log(`📋 Fetched ${users.length} users from Firestore.`);
        return users;
    } catch (error) {
        console.error('❌ getAllUsers failed:', error);
        throw new Error('Failed to load users. Please try again.');
    }
}

/**
 * Retrieve the depotId of a user by their UID.
 * @param {string} uid - Firestore document ID (Auth UID)
 * @returns {Promise<string|null>}
 */
export async function getUserDepotId(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        const snap = await getDoc(userRef);
        return snap.exists() ? snap.data().depotId || null : null;
    } catch (error) {
        console.error('❌ getUserDepotId failed:', error);
        return null;
    }
}

/**
 * Create a new user document.
 * If `userId` is provided, it becomes the document ID (future‑ready for Auth UID).
 * Otherwise Firestore auto‑generates the ID.
 * @param {Object} userData - { name, email, phone, role, status, firstLogin, createdAt }
 * @param {string|null} [userId=null]
 * @returns {Promise<{id: string}>} The ID of the created document.
 */
export async function createUserInFirestore(userData, userId = null) {
    try {
        let docRef;
        if (userId) {
            docRef = doc(db, 'users', userId);
            await setDoc(docRef, userData);
            console.log(`✅ User created with UID: ${userId}`);
        } else {
            docRef = await addDoc(collection(db, 'users'), userData);
            console.log(`✅ User created with auto-ID: ${docRef.id}`);
        }
        return { id: docRef.id };
    } catch (error) {
        console.error('❌ createUserInFirestore failed:', error);
        throw new Error('Failed to create user. Please try again.');
    }
}

/**
 * Update an existing user document.
 * @param {string} userId - Firestore document ID.
 * @param {Object} updatedData - Key‑value pairs to update.
 */
export async function updateUserInFirestore(userId, updatedData) {
    try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, updatedData);
        console.log(`✅ User ${userId} updated successfully.`);
    } catch (error) {
        console.error('❌ updateUserInFirestore failed:', error);
        throw new Error('Failed to update user. Please try again.');
    }
}

/**
 * Toggle the `status` field between 'active' and 'inactive'.
 * @param {string} userId - Firestore document ID.
 * @param {string} currentStatus - The current status value.
 * @returns {Promise<string>} The new status.
 */
export async function toggleUserStatus(userId, currentStatus) {
    try {
        const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
        await updateUserInFirestore(userId, { status: newStatus });
        console.log(`🔄 User ${userId} status toggled to ${newStatus}.`);
        return newStatus;
    } catch (error) {
        console.error('❌ toggleUserStatus failed:', error);
        throw new Error('Failed to toggle user status.');
    }
}

// ============================================================
//  DRIVERS COLLECTION
// ============================================================

/**
 * Generate the next business driver ID (e.g., DR001, DR002…).
 * @returns {Promise<string>} The next available driver ID.
 */
export async function getNextDriverId() {
    try {
        const driversCol = collection(db, 'drivers');
        const q = query(driversCol, orderBy('driverId', 'desc'), limit(1));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return 'DR001';
        }

        const lastDoc = snapshot.docs[0];
        const lastId = lastDoc.data().driverId;
        if (!lastId) {
            return 'DR001';
        }

        const num = parseInt(lastId.replace('DR', ''), 10);
        if (isNaN(num)) {
            return 'DR001';
        }
        const nextNum = num + 1;
        return `DR${String(nextNum).padStart(3, '0')}`;
    } catch (error) {
        console.error('❌ getNextDriverId failed:', error);
        throw new Error('Failed to generate next driver ID.');
    }
}

/**
 * Create a driver record in the `drivers` collection.
 * If the driverData does not contain a `driverId`, one is auto-generated.
 *
 * @param {Object} driverData - { userId, licenseNo, address, assignedRouteId, workingHours, createdAt, [driverId] }
 * @returns {Promise<string>} The auto‑generated document ID.
 */
export async function createDriverRecord(driverData) {
    try {
        if (!driverData.driverId) {
            driverData.driverId = await getNextDriverId();
        }
        const driversCol = collection(db, 'drivers');
        const docRef = await addDoc(driversCol, driverData);
        console.log(`🚛 Driver record created with ID: ${docRef.id} (driverId: ${driverData.driverId})`);
        return docRef.id;
    } catch (error) {
        console.error('❌ createDriverRecord failed:', error);
        throw new Error('Failed to create driver record.');
    }
}

/**
 * Fetch the driver record linked to a specific user.
 * @param {string} userId - The user's Firestore document ID.
 * @returns {Promise<Object|null>} Driver data (including `id`) or `null` if not found.
 */
export async function getDriverData(userId) {
    try {
        const driversCol = collection(db, 'drivers');
        const q = query(driversCol, where('userId', '==', userId));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            console.warn(`⚠️ No driver record found for userId: ${userId}`);
            return null;
        }
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error('❌ getDriverData failed:', error);
        throw new Error('Failed to fetch driver data.');
    }
}

/**
 * Update an existing driver document.
 * @param {string} driverDocId - The driver document ID.
 * @param {Object} driverData - Fields to update.
 */
export async function updateDriverRecord(driverDocId, driverData) {
    try {
        const driverRef = doc(db, 'drivers', driverDocId);
        await updateDoc(driverRef, driverData);
        console.log(`🚛 Driver record ${driverDocId} updated.`);
    } catch (error) {
        console.error('❌ updateDriverRecord failed:', error);
        throw new Error('Failed to update driver record.');
    }
}

// ============================================================
//  ACTIVITY LOGS COLLECTION
// ============================================================

/**
 * Log an important action to the `activityLogs` collection.
 * @param {Object} logEntry – { action, performedBy, performedByName, targetId, targetType }
 * @returns {Promise<string>} The auto-generated document ID.
 */
export async function createActivityLog(logEntry) {
    try {
        const logsCol = collection(db, 'activityLogs');
        const docRef = await addDoc(logsCol, {
            ...logEntry,
            timestamp: serverTimestamp()
        });
        console.log(`📜 Activity logged: ${logEntry.action} → ${docRef.id}`);
        return docRef.id;
    } catch (error) {
        console.error('❌ createActivityLog failed:', error);
        // Do not throw – logging should never block the UI.
    }
}

/**
 * Fetch the most recent activity logs, ordered by timestamp descending.
 * @param {number} maxResults - Maximum number of logs to return (default 20).
 * @returns {Promise<Array>} Array of log objects { id, ...data }
 */
export async function getRecentActivityLogs(maxResults = 20) {
    try {
        const logsCol = collection(db, 'activityLogs');
        const q = query(logsCol, orderBy('timestamp', 'desc'), limit(maxResults));
        const snapshot = await getDocs(q);
        const logs = [];
        snapshot.forEach(doc => {
            logs.push({
                id: doc.id,
                ...doc.data()
            });
        });
        console.log(`📜 Fetched ${logs.length} recent activity logs.`);
        return logs;
    } catch (error) {
        console.error('❌ getRecentActivityLogs failed:', error);
        throw new Error('Failed to load activity logs.');
    }
}

// ============================================================
//  ROUTES COLLECTION (DEPOT-AWARE)
// ============================================================

/**
 * Fetch route documents, optionally filtered by role/depot.
 * Superadmin → all routes.
 * Other roles → only routes where depotId equals current user's depotId.
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Array>} Array of route objects { id (docID), routeId, ... }
 */
export async function getAllRoutes(filters = {}) {
    try {
        const routesCol = collection(db, 'routes');
        let q;
        const { role, depotId } = filters;

        if (!role || role === 'superadmin') {
            q = routesCol;
        } else {
            if (!depotId) {
                console.warn('⚠️ No depotId provided for non-superadmin role. Returning empty set.');
                return [];
            }
            q = query(routesCol, where('depotId', '==', depotId));
        }

        const snapshot = await getDocs(q);
        const routes = [];
        snapshot.forEach(docSnap => {
            routes.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });
        console.log(`🗺️  Fetched ${routes.length} routes (role: ${role || 'none'}, depotId: ${depotId || 'none'}).`);
        return routes;
    } catch (error) {
        console.error('❌ getAllRoutes failed:', error);
        throw new Error('Failed to load routes. Please try again.');
    }
}

/**
 * Fetch a single route document by its routeId.
 * @param {string} routeId - The route identifier (document ID, e.g., "RT001")
 * @returns {Promise<Object|null>} The route document data or null if not found.
 */
export async function getRouteById(routeId) {
    try {
        const routeRef = doc(db, 'routes', routeId);
        const routeSnap = await getDoc(routeRef);
        if (!routeSnap.exists()) {
            console.warn(`⚠️ Route ${routeId} not found.`);
            return null;
        }
        console.log(`🗺️  Route ${routeId} fetched successfully.`);
        return {
            id: routeSnap.id,
            ...routeSnap.data()
        };
    } catch (error) {
        console.error('❌ getRouteById failed:', error);
        throw new Error('Failed to load route data. Please try again.');
    }
}

/**
 * Create a new route document with a specific routeId as the document ID.
 * Now includes depotId from routeData.
 * @param {string} routeId - The route identifier (e.g., "RT004")
 * @param {Object} routeData - { startPoint, endPoint, distance, stops, status, depotId }
 * @returns {Promise<string>} The route ID (same as doc ID)
 */
export async function createRouteInFirestore(routeId, routeData) {
    try {
        const routeRef = doc(db, 'routes', routeId);
        await setDoc(routeRef, {
            routeId: routeId,
            startPoint: routeData.startPoint,
            endPoint: routeData.endPoint,
            distance: routeData.distance,
            stops: routeData.stops,
            status: routeData.status,
            depotId: routeData.depotId || null,
            estimatedTravelTime: '',
            coordinates: [],
            mapGenerated: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Route ${routeId} created in Firestore.`);
        return routeId;
    } catch (error) {
        console.error('❌ createRouteInFirestore failed:', error);
        throw new Error('Failed to create route. Please try again.');
    }
}

/**
 * Update an existing route document (document ID = routeId).
 * Now enforces depot ownership and forbids depot changes for non‑superadmin.
 * @param {string} routeId
 * @param {Object} routeData - Fields to update (may include depotId for superadmin)
 * @param {Object} [callerInfo] - { role, depotId } of the user performing the update
 */
export async function updateRouteInFirestore(routeId, routeData, callerInfo = {}) {
    try {
        const routeRef = doc(db, 'routes', routeId);

        const currentSnap = await getDoc(routeRef);
        if (!currentSnap.exists()) {
            throw new Error(`Route ${routeId} does not exist.`);
        }
        const currentData = currentSnap.data();

        if (callerInfo.role && callerInfo.role !== 'superadmin') {
            if (currentData.depotId !== callerInfo.depotId) {
                throw new Error('You do not have permission to modify this route.');
            }
            if (routeData.depotId && routeData.depotId !== currentData.depotId) {
                throw new Error('You are not allowed to move a route to another depot.');
            }
            delete routeData.depotId;
        }

        await updateDoc(routeRef, {
            ...routeData,
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Route ${routeId} updated.`);
    } catch (error) {
        console.error('❌ updateRouteInFirestore failed:', error);
        throw new Error(error.message || 'Failed to update route.');
    }
}

/**
 * Delete a route document by its ID.
 * @param {string} routeId - The route ID (document ID)
 */
export async function deleteRouteFromFirestore(routeId) {
    try {
        const routeRef = doc(db, 'routes', routeId);
        await deleteDoc(routeRef);
        console.log(`🗑️  Route ${routeId} deleted.`);
    } catch (error) {
        console.error('❌ deleteRouteFromFirestore failed:', error);
        throw new Error('Failed to delete route. Please try again.');
    }
}

/**
 * Update map-related fields of a route.
 * @param {string} routeId - The route document ID
 * @param {Object} data - { coordinates, estimatedTravelTime, mapGenerated }
 */
export async function updateRouteMapData(routeId, data) {
    try {
        const routeRef = doc(db, 'routes', routeId);
        await updateDoc(routeRef, {
            coordinates: data.coordinates,
            estimatedTravelTime: data.estimatedTravelTime,
            mapGenerated: data.mapGenerated,
            updatedAt: serverTimestamp()
        });
        console.log(`🗺️  Route ${routeId} map data updated.`);
    } catch (error) {
        console.error('❌ updateRouteMapData failed:', error);
        throw new Error('Failed to update route map data.');
    }
}

// ============================================================
//  VEHICLES COLLECTION (DEPOT-AWARE)
// ============================================================

/**
 * Fetch vehicle documents, optionally filtered by role/depot.
 * Superadmin or no role → all vehicles.
 * Other roles → only vehicles belonging to the user's depot.
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Array>} Array of vehicle objects { id (docID = vehicleId), ...data }
 */
export async function getAllVehicles(filters = {}) {
    try {
        const vehiclesCol = collection(db, 'vehicles');
        let q;
        const { role, depotId } = filters;

        if (!role || role === 'superadmin') {
            q = vehiclesCol;
        } else {
            if (!depotId) {
                console.warn('⚠️ No depotId provided for non-superadmin role. Returning empty set.');
                return [];
            }
            q = query(vehiclesCol, where('depotId', '==', depotId));
        }

        const snapshot = await getDocs(q);
        const vehicles = [];
        snapshot.forEach(docSnap => {
            vehicles.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });
        console.log(`🚌 Fetched ${vehicles.length} vehicles (role: ${role || 'none'}, depotId: ${depotId || 'none'}).`);
        return vehicles;
    } catch (error) {
        console.error('❌ getAllVehicles failed:', error);
        throw new Error('Failed to load vehicles. Please try again.');
    }
}

/**
 * Create a new vehicle document. Includes depotId automatically.
 * @param {string} vehicleId - The vehicle identifier (e.g., "VH005")
 * @param {Object} vehicleData - { registrationNo, capacity, mileage, status, depotId }
 * @returns {Promise<string>} The vehicle ID (same as doc ID)
 */
export async function createVehicleInFirestore(vehicleId, vehicleData) {
    try {
        const vehicleRef = doc(db, 'vehicles', vehicleId);
        await setDoc(vehicleRef, {
            vehicleId: vehicleId,
            ...vehicleData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Vehicle ${vehicleId} created in Firestore.`);
        return vehicleId;
    } catch (error) {
        console.error('❌ createVehicleInFirestore failed:', error);
        throw new Error('Failed to create vehicle. Please try again.');
    }
}

/**
 * Update an existing vehicle document.
 * @param {string} vehicleId
 * @param {Object} vehicleData – Fields to update (may include depotId)
 */
export async function updateVehicleInFirestore(vehicleId, vehicleData) {
    try {
        const vehicleRef = doc(db, 'vehicles', vehicleId);
        await updateDoc(vehicleRef, {
            ...vehicleData,
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Vehicle ${vehicleId} updated.`);
    } catch (error) {
        console.error('❌ updateVehicleInFirestore failed:', error);
        throw new Error('Failed to update vehicle. Please try again.');
    }
}

/**
 * Delete a vehicle document by its ID.
 * @param {string} vehicleId
 */
export async function deleteVehicleFromFirestore(vehicleId) {
    try {
        const vehicleRef = doc(db, 'vehicles', vehicleId);
        await deleteDoc(vehicleRef);
        console.log(`🗑️  Vehicle ${vehicleId} deleted.`);
    } catch (error) {
        console.error('❌ deleteVehicleFromFirestore failed:', error);
        throw new Error('Failed to delete vehicle. Please try again.');
    }
}

// ============================================================
//  DRIVERS – GET ALL (with user names) — DEPOT-AWARE
// ============================================================

/**
 * Fetch all driver records, resolving each driver's name from the linked user.
 * Optionally filters drivers by the depot of the linked user.
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Array>} Drivers with { id (docID), driverId, name, assignedRouteId, depotId, ... }
 */
export async function getAllDrivers(filters = {}) {
    try {
        const usersCol = collection(db, 'users');
        const userSnap = await getDocs(usersCol);
        const userMap = {};
        userSnap.forEach(doc => {
            userMap[doc.id] = {
                name: doc.data().name || 'Unknown',
                depotId: doc.data().depotId || null
            };
        });

        const driversCol = collection(db, 'drivers');
        const driverSnap = await getDocs(driversCol);
        let drivers = [];

        driverSnap.forEach(doc => {
            const data = doc.data();
            const userInfo = userMap[data.userId] || {};
            drivers.push({
                id: doc.id,
                driverId: data.driverId,
                name: userInfo.name || 'Unknown',
                assignedRouteId: data.assignedRouteId || null,
                depotId: userInfo.depotId || null,
                ...data
            });
        });

        const { role, depotId } = filters;
        if (role && role !== 'superadmin' && depotId) {
            drivers = drivers.filter(d => d.depotId === depotId);
        }

        console.log(`🚛 Fetched ${drivers.length} drivers (role: ${role || 'none'}, depotId: ${depotId || 'none'}).`);
        return drivers;
    } catch (error) {
        console.error('❌ getAllDrivers failed:', error);
        throw new Error('Failed to load drivers.');
    }
}

// ============================================================
//  SCHEDULES COLLECTION – CRUD (DEPOT-AWARE)
// ============================================================

/**
 * Fetch all schedule documents, optionally filtered by role/depot.
 * Superadmin → all schedules.
 * Other roles → only schedules from the user's depot.
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Array>} Array of schedule objects (doc ID = scheduleId)
 */
export async function getAllSchedules(filters = {}) {
    try {
        const schedulesCol = collection(db, 'schedules');
        let q;
        const { role, depotId } = filters;

        if (!role || role === 'superadmin') {
            q = schedulesCol;
        } else {
            if (!depotId) {
                console.warn('⚠️ No depotId provided for non-superadmin role. Returning empty set.');
                return [];
            }
            q = query(schedulesCol, where('depotId', '==', depotId));
        }

        const snapshot = await getDocs(q);
        const schedules = [];
        snapshot.forEach(doc => {
            schedules.push({
                id: doc.id,
                ...doc.data()
            });
        });

        console.log(`📅 Fetched ${schedules.length} schedules (role: ${role || 'none'}, depotId: ${depotId || 'none'}).`);
        return schedules;
    } catch (error) {
        console.error('❌ getAllSchedules failed:', error);
        throw new Error('Failed to load schedules.');
    }
}

/**
 * Create a new schedule document. The provided scheduleId becomes the document ID.
 * Stores depotId for depot‑aware access.
 * @param {string} scheduleId - e.g. "SCH001"
 * @param {Object} scheduleData - { driverId, routeId, vehicleId, scheduleDate, departureTime, arrivalTime, status, depotId }
 */
export async function createScheduleInFirestore(scheduleId, scheduleData) {
    try {
        const scheduleRef = doc(db, 'schedules', scheduleId);

        const existing = await getDoc(scheduleRef);
        if (existing.exists()) {
            throw new Error(`Schedule ID ${scheduleId} already exists.`);
        }

        await setDoc(scheduleRef, {
            scheduleId,
            driverId: scheduleData.driverId,
            routeId: scheduleData.routeId,
            vehicleId: scheduleData.vehicleId,
            scheduleDate: scheduleData.scheduleDate,
            departureTime: scheduleData.departureTime,
            arrivalTime: scheduleData.arrivalTime,
            status: scheduleData.status,
            depotId: scheduleData.depotId,
            actualDepartureTime: null,
            actualArrivalTime: null,
            delayMinutes: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Schedule ${scheduleId} created with depotId ${scheduleData.depotId}.`);
    } catch (error) {
        console.error('❌ createScheduleInFirestore failed:', error);
        throw error;
    }
}

/**
 * Update an existing schedule document (document ID = scheduleId).
 * depotId can be updated only if the caller explicitly provides it (superadmin).
 * @param {string} scheduleId
 * @param {Object} scheduleData - Fields to update (may include depotId)
 */
export async function updateScheduleInFirestore(scheduleId, scheduleData) {
    try {
        const scheduleRef = doc(db, 'schedules', scheduleId);
        await updateDoc(scheduleRef, {
            ...scheduleData,
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Schedule ${scheduleId} updated.`);
    } catch (error) {
        console.error('❌ updateScheduleInFirestore failed:', error);
        throw error;
    }
}

/**
 * Delete a schedule document by its ID.
 * @param {string} scheduleId
 */
export async function deleteScheduleFromFirestore(scheduleId) {
    try {
        const scheduleRef = doc(db, 'schedules', scheduleId);
        await deleteDoc(scheduleRef);
        console.log(`🗑️  Schedule ${scheduleId} deleted.`);
    } catch (error) {
        console.error('❌ deleteScheduleFromFirestore failed:', error);
        throw error;
    }
}

// ============================================================
//  NOTIFICATIONS COLLECTION – includes conflictId
// ============================================================

/**
 * Create a notification document in the `notifications` collection.
 * Automatically adds `createdAt` server timestamp.
 *
 * @param {Object} notificationData
 * @param {string} notificationData.title
 * @param {string} notificationData.message
 * @param {string} notificationData.type
 * @param {string} [notificationData.createdBy='system']
 * @param {string[]} [notificationData.targetRoles=[]]
 * @param {string[]} [notificationData.targetUserIds=[]]
 * @param {string} [notificationData.conflictId]
 * @returns {Promise<string>} The ID of the created document.
 */
export async function createNotification(notificationData) {
    try {
        const notifCol = collection(db, 'notifications');
        const payload = {
            title: notificationData.title,
            message: notificationData.message,
            type: notificationData.type,
            createdBy: notificationData.createdBy || 'system',
            targetRoles: notificationData.targetRoles || [],
            targetUserIds: notificationData.targetUserIds || [],
            readBy: [],
            createdAt: serverTimestamp()
        };
        if (notificationData.conflictId) {
            payload.conflictId = notificationData.conflictId;
        }
        const docRef = await addDoc(notifCol, payload);
        console.log(`🔔 Notification created: ${docRef.id} (${payload.type})`);
        return docRef.id;
    } catch (error) {
        console.error('❌ createNotification failed:', error);
        throw error;
    }
}

/**
 * Get all notifications visible to a specific user based on their userId and role.
 * Results are sorted newest first.
 *
 * @param {string} userId - The user's Firestore document ID.
 * @param {string} role - The user's role (e.g., 'superadmin', 'admin', 'driver').
 * @returns {Promise<Array>} Array of notification objects (including doc ID).
 */
export async function getNotificationsForUser(userId, role) {
    try {
        const notifCol = collection(db, 'notifications');

        const qByUser = query(notifCol, where('targetUserIds', 'array-contains', userId));
        const qByRole = query(notifCol, where('targetRoles', 'array-contains', role));

        const [userSnap, roleSnap] = await Promise.all([
            getDocs(qByUser),
            getDocs(qByRole)
        ]);

        const notificationMap = new Map();
        userSnap.forEach(docSnap => {
            notificationMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
        });
        roleSnap.forEach(docSnap => {
            if (!notificationMap.has(docSnap.id)) {
                notificationMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
            }
        });

        const notifications = Array.from(notificationMap.values());

        notifications.sort((a, b) => {
            const tA = a.createdAt ? a.createdAt.toMillis() : 0;
            const tB = b.createdAt ? b.createdAt.toMillis() : 0;
            return tB - tA;
        });

        console.log(`📬 Fetched ${notifications.length} notifications for ${userId} (${role})`);
        return notifications;
    } catch (error) {
        console.error('❌ getNotificationsForUser failed:', error);
        throw error;
    }
}

/**
 * Mark a notification as read by a given user.
 * Uses `arrayUnion` to add the userId to the `readBy` array, preventing duplicates.
 *
 * @param {string} notificationId - The Firestore document ID of the notification.
 * @param {string} userId - The user's Firestore document ID.
 */
export async function markNotificationRead(notificationId, userId) {
    try {
        const notifRef = doc(db, 'notifications', notificationId);
        await updateDoc(notifRef, {
            readBy: arrayUnion(userId)
        });
        console.log(`✅ Notification ${notificationId} marked read by ${userId}`);
    } catch (error) {
        console.error('❌ markNotificationRead failed:', error);
        throw error;
    }
}

/**
 * Get the number of unread notifications for a user.
 *
 * @param {string} userId
 * @param {string} role
 * @returns {Promise<number>} Unread count.
 */
export async function getUnreadCount(userId, role) {
    try {
        const notifications = await getNotificationsForUser(userId, role);
        const unread = notifications.filter(n => !n.readBy || !n.readBy.includes(userId));
        console.log(`🔢 Unread notifications for ${userId}: ${unread.length}`);
        return unread.length;
    } catch (error) {
        console.error('❌ getUnreadCount failed:', error);
        throw error;
    }
}

// ============================================================
//  HELPER – DRIVER LOOKUP BY BUSINESS DRIVER ID
// ============================================================

/**
 * Get the Firestore userId and human‑readable name for a driver
 * using their business driver ID (e.g., "DR001").
 *
 * @param {string} driverId - The business driver ID.
 * @returns {Promise<{userId: string, name: string} | null>}
 */
export async function getDriverByDriverId(driverId) {
    try {
        const driversCol = collection(db, 'drivers');
        const q = query(driversCol, where('driverId', '==', driverId));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            console.warn(`⚠️ No driver found with driverId: ${driverId}`);
            return null;
        }

        const driverDoc = snapshot.docs[0];
        const driverData = driverDoc.data();
        const userId = driverData.userId || null;

        let name = 'Unknown Driver';
        if (userId) {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                name = userSnap.data().name || 'Unknown Driver';
            }
        }

        return { userId, name };
    } catch (error) {
        console.error('❌ getDriverByDriverId failed:', error);
        return null;
    }
}

// ============================================================
//  FUEL LOGS COLLECTION (DEPOT-AWARE)
// ============================================================

/**
 * Create a new fuel log document, automatically determining depotId from the selected vehicle.
 * Also updates the associated vehicle's mileage.
 * @param {Object} fuelData - Fields: fuelId, vehicleId, fuelDate, fuelAmount, fuelCost,
 *                            vehicleMileageBefore, odometerReading, fuelType, remarks, createdBy
 * @returns {Promise<string>} Auto-generated document ID of the fuel log.
 */
export async function addFuelLog(fuelData) {
    try {
        // ----- Determine depotId from vehicle -----
        let depotId = null;
        if (fuelData.vehicleId) {
            const vehicleRef = doc(db, 'vehicles', fuelData.vehicleId);
            const vehicleSnap = await getDoc(vehicleRef);
            if (vehicleSnap.exists()) {
                depotId = vehicleSnap.data().depotId || null;
            }
        }

        const fuelLogsCol = collection(db, 'fuelLogs');
        const docRef = await addDoc(fuelLogsCol, {
            ...fuelData,
            depotId: depotId,
            createdAt: serverTimestamp()
        });
        console.log(`⛽ Fuel log created: ${docRef.id} (depotId: ${depotId})`);

        if (fuelData.vehicleId && fuelData.odometerReading !== undefined) {
            const vehicleRef = doc(db, 'vehicles', fuelData.vehicleId);
            await updateDoc(vehicleRef, { mileage: fuelData.odometerReading });
            console.log(`🚌 Vehicle ${fuelData.vehicleId} mileage updated to ${fuelData.odometerReading}`);
        }

        return docRef.id;
    } catch (error) {
        console.error('❌ addFuelLog failed:', error);
        throw new Error('Failed to create fuel log. Please try again.');
    }
}

/**
 * Retrieve all fuel logs, optionally filtered by depot.
 * Superadmin → returns all logs.
 * Other roles → only logs belonging to the given depotId.
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Array>} Array of fuel log objects { id, ...data }
 */
export async function getAllFuelLogs(filters = {}) {
    try {
        const fuelLogsCol = collection(db, 'fuelLogs');
        let q;

        const { role, depotId } = filters;
        if (!role || role === 'superadmin') {
            q = query(fuelLogsCol, orderBy('createdAt', 'desc'));
        } else {
            if (!depotId) {
                console.warn('⚠️ No depotId provided for non-superadmin role. Returning empty fuel logs.');
                return [];
            }
            q = query(fuelLogsCol, where('depotId', '==', depotId), orderBy('createdAt', 'desc'));
        }

        const snapshot = await getDocs(q);
        const logs = [];
        snapshot.forEach(doc => {
            logs.push({ id: doc.id, ...doc.data() });
        });
        console.log(`⛽ Fetched ${logs.length} fuel logs (role: ${role || 'none'}, depotId: ${depotId || 'none'}).`);
        return logs;
    } catch (error) {
        console.error('❌ getAllFuelLogs failed:', error);
        throw new Error('Failed to load fuel logs. Please try again.');
    }
}

/**
 * Get a single fuel log by its business `fuelId` field.
 * @param {string} fuelId - The fuel log identifier (e.g., "FL001")
 * @returns {Promise<Object|null>} Fuel log document or null if not found.
 */
export async function getFuelLogById(fuelId) {
    try {
        const fuelLogsCol = collection(db, 'fuelLogs');
        const q = query(fuelLogsCol, where('fuelId', '==', fuelId), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            console.warn(`⚠️ No fuel log found with fuelId: ${fuelId}`);
            return null;
        }
        const docSnap = snapshot.docs[0];
        return { id: docSnap.id, ...docSnap.data() };
    } catch (error) {
        console.error('❌ getFuelLogById failed:', error);
        throw new Error('Failed to fetch fuel log. Please try again.');
    }
}

/**
 * Update an existing fuel log document.
 * If the vehicle changes, depotId is automatically re‑determined.
 * If odometerReading changes, the corresponding vehicle's mileage is updated.
 * @param {string} docId - Firestore document ID of the fuel log.
 * @param {Object} fuelData - Fields to update (any subset of fuel log fields).
 */
export async function updateFuelLog(docId, fuelData) {
    try {
        const fuelRef = doc(db, 'fuelLogs', docId);
        const currentSnap = await getDoc(fuelRef);
        if (!currentSnap.exists()) {
            throw new Error(`Fuel log ${docId} does not exist.`);
        }
        const currentData = currentSnap.data();

        // ----- Re-determine depotId if vehicleId is changed -----
        if (fuelData.vehicleId && fuelData.vehicleId !== currentData.vehicleId) {
            const vehicleRef = doc(db, 'vehicles', fuelData.vehicleId);
            const vehicleSnap = await getDoc(vehicleRef);
            if (vehicleSnap.exists()) {
                fuelData.depotId = vehicleSnap.data().depotId || null;
            } else {
                fuelData.depotId = null;
            }
        }

        await updateDoc(fuelRef, fuelData);
        console.log(`✅ Fuel log ${docId} updated.`);

        if (
            fuelData.odometerReading !== undefined &&
            fuelData.odometerReading !== currentData.odometerReading &&
            (fuelData.vehicleId || currentData.vehicleId)
        ) {
            const vehicleIdToUpdate = fuelData.vehicleId || currentData.vehicleId;
            const vehicleRef = doc(db, 'vehicles', vehicleIdToUpdate);
            await updateDoc(vehicleRef, { mileage: fuelData.odometerReading });
            console.log(`🚌 Vehicle ${vehicleIdToUpdate} mileage updated to ${fuelData.odometerReading}`);
        }
    } catch (error) {
        console.error('❌ updateFuelLog failed:', error);
        throw new Error('Failed to update fuel log. Please try again.');
    }
}

/**
 * Delete a fuel log document by its Firestore document ID.
 * @param {string} docId - Firestore document ID of the fuel log to delete.
 */
export async function deleteFuelLog(docId) {
    try {
        const fuelRef = doc(db, 'fuelLogs', docId);
        await deleteDoc(fuelRef);
        console.log(`🗑️  Fuel log ${docId} deleted.`);
    } catch (error) {
        console.error('❌ deleteFuelLog failed:', error);
        throw new Error('Failed to delete fuel log. Please try again.');
    }
}

/**
 * Retrieve all fuel logs for a specific vehicle, newest first.
 * @param {string} vehicleId - The vehicle ID (e.g., "VH001")
 * @returns {Promise<Array>} Array of fuel log objects.
 */
export async function getFuelLogsByVehicle(vehicleId) {
    try {
        const fuelLogsCol = collection(db, 'fuelLogs');
        const q = query(
            fuelLogsCol,
            where('vehicleId', '==', vehicleId),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        const logs = [];
        snapshot.forEach(doc => {
            logs.push({ id: doc.id, ...doc.data() });
        });
        console.log(`⛽ Fetched ${logs.length} fuel logs for vehicle ${vehicleId}.`);
        return logs;
    } catch (error) {
        console.error('❌ getFuelLogsByVehicle failed:', error);
        throw new Error('Failed to load fuel logs for vehicle. Please try again.');
    }
}

// ============================================================
//  MAINTENANCE LOGS COLLECTION (DEPOT-AWARE)
// ============================================================

/**
 * Create a new maintenance log in the `maintenance` collection.
 * Automatically derives depotId from the selected vehicle and adds timestamps.
 * @param {Object} data - Maintenance record fields (vehicleId required)
 * @returns {Promise<string>} The auto-generated document ID.
 */
export async function createMaintenanceLog(data) {
    try {
        // ----- Automatically determine depotId from vehicle if not present -----
        if (!data.depotId && data.vehicleId) {
            const vehicleRef = doc(db, 'vehicles', data.vehicleId);
            const vehicleSnap = await getDoc(vehicleRef);
            if (vehicleSnap.exists()) {
                data.depotId = vehicleSnap.data().depotId || null;
            }
        }

        const maintenanceCol = collection(db, 'maintenance');
        const docRef = await addDoc(maintenanceCol, {
            ...data,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log(`🔧 Maintenance log created: ${docRef.id} (depotId: ${data.depotId || 'none'})`);
        return docRef.id;
    } catch (error) {
        console.error('❌ createMaintenanceLog failed:', error);
        throw new Error('Failed to create maintenance log. Please try again.');
    }
}

/**
 * Retrieve all maintenance logs, optionally filtered by depot.
 * Superadmin (or empty filters) → returns all logs.
 * Other roles → only logs belonging to the given depotId.
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Array>} Array of maintenance log objects { id, ...data }
 */
export async function getAllMaintenanceLogs(filters = {}) {
    try {
        const maintenanceCol = collection(db, 'maintenance');
        let q;

        const { role, depotId } = filters;
        if (!role || role === 'superadmin') {
            q = query(maintenanceCol, orderBy('createdAt', 'desc'));
        } else {
            if (!depotId) {
                console.warn('⚠️ No depotId provided for non-superadmin role. Returning empty maintenance logs.');
                return [];
            }
            q = query(maintenanceCol, where('depotId', '==', depotId), orderBy('createdAt', 'desc'));
        }

        const snapshot = await getDocs(q);
        const logs = [];
        snapshot.forEach(doc => {
            logs.push({ id: doc.id, ...doc.data() });
        });
        console.log(`🔧 Fetched ${logs.length} maintenance logs (role: ${role || 'none'}, depotId: ${depotId || 'none'}).`);
        return logs;
    } catch (error) {
        console.error('❌ getAllMaintenanceLogs failed:', error);
        throw new Error('Failed to load maintenance logs. Please try again.');
    }
}

/**
 * Get a single maintenance log by its business `maintenanceId` field.
 * @param {string} maintenanceId - The maintenance identifier (e.g., "MT001")
 * @returns {Promise<Object|null>} Maintenance log document or null if not found.
 */
export async function getMaintenanceLogById(maintenanceId) {
    try {
        const maintenanceCol = collection(db, 'maintenance');
        const q = query(maintenanceCol, where('maintenanceId', '==', maintenanceId), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            console.warn(`⚠️ No maintenance log found with maintenanceId: ${maintenanceId}`);
            return null;
        }
        const docSnap = snapshot.docs[0];
        return { id: docSnap.id, ...docSnap.data() };
    } catch (error) {
        console.error('❌ getMaintenanceLogById failed:', error);
        throw new Error('Failed to fetch maintenance log. Please try again.');
    }
}

/**
 * Update an existing maintenance log document.
 * If the vehicle changes, depotId is automatically re‑determined.
 * @param {string} docId - Firestore document ID of the maintenance log.
 * @param {Object} data - Fields to update.
 */
export async function updateMaintenanceLog(docId, data) {
    try {
        const maintenanceRef = doc(db, 'maintenance', docId);
        const currentSnap = await getDoc(maintenanceRef);
        if (!currentSnap.exists()) {
            throw new Error(`Maintenance log ${docId} does not exist.`);
        }
        const currentData = currentSnap.data();

        // ----- Re-determine depotId if vehicleId is changed -----
        if (data.vehicleId && data.vehicleId !== currentData.vehicleId) {
            const vehicleRef = doc(db, 'vehicles', data.vehicleId);
            const vehicleSnap = await getDoc(vehicleRef);
            if (vehicleSnap.exists()) {
                data.depotId = vehicleSnap.data().depotId || null;
            } else {
                data.depotId = null;
            }
        }

        await updateDoc(maintenanceRef, {
            ...data,
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Maintenance log ${docId} updated.`);
    } catch (error) {
        console.error('❌ updateMaintenanceLog failed:', error);
        throw new Error('Failed to update maintenance log. Please try again.');
    }
}

/**
 * Delete a maintenance log document by its Firestore document ID.
 * @param {string} docId - Firestore document ID of the log to delete.
 */
export async function deleteMaintenanceLog(docId) {
    try {
        const maintenanceRef = doc(db, 'maintenance', docId);
        await deleteDoc(maintenanceRef);
        console.log(`🗑️  Maintenance log ${docId} deleted.`);
    } catch (error) {
        console.error('❌ deleteMaintenanceLog failed:', error);
        throw new Error('Failed to delete maintenance log. Please try again.');
    }
}

/**
 * Retrieve all maintenance logs for a specific vehicle, newest first.
 * @param {string} vehicleId - The vehicle ID (e.g., "VH001")
 * @returns {Promise<Array>} Array of maintenance log objects.
 */
export async function getMaintenanceLogsByVehicle(vehicleId) {
    try {
        const maintenanceCol = collection(db, 'maintenance');
        const q = query(
            maintenanceCol,
            where('vehicleId', '==', vehicleId),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        const logs = [];
        snapshot.forEach(doc => {
            logs.push({ id: doc.id, ...doc.data() });
        });
        console.log(`🔧 Fetched ${logs.length} maintenance logs for vehicle ${vehicleId}.`);
        return logs;
    } catch (error) {
        console.error('❌ getMaintenanceLogsByVehicle failed:', error);
        throw new Error('Failed to load maintenance logs for vehicle. Please try again.');
    }
}

/**
 * Return all scheduled maintenance records (status === "Scheduled").
 * Used by dashboard alerts.
 * @returns {Promise<Array>} Array of upcoming maintenance log objects.
 */
export async function getUpcomingServices() {
    try {
        const maintenanceCol = collection(db, 'maintenance');
        const q = query(
            maintenanceCol,
            where('status', '==', 'Scheduled'),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        const services = [];
        snapshot.forEach(doc => {
            services.push({ id: doc.id, ...doc.data() });
        });
        console.log(`🔧 Fetched ${services.length} upcoming maintenance services.`);
        return services;
    } catch (error) {
        console.error('❌ getUpcomingServices failed:', error);
        throw new Error('Failed to load upcoming services. Please try again.');
    }
}

// ============================================================
//  REPORTS SERVICE LAYER (DEPOT-AWARE UPDATES)
// ============================================================

/**
 * Generate a fuel consumption report from all fuel logs.
 * @param {string} role - The user's role (e.g., 'superadmin', 'admin')
 * @param {string|null} depotId - The user's depotId (null for superadmin)
 * @returns {Promise<Object>} Report object.
 */
export async function generateFuelReport(role, depotId) {
    try {
        const logs = await getAllFuelLogs({ role, depotId });
        const totalFuelLogs = logs.length;
        let totalFuelAmount = 0;
        let totalFuelCost = 0;
        const vehicleFuelMap = new Map();

        logs.forEach(log => {
            const amount = Number(log.fuelAmount) || 0;
            const cost = Number(log.fuelCost) || 0;
            totalFuelAmount += amount;
            totalFuelCost += cost;

            if (log.vehicleId) {
                vehicleFuelMap.set(
                    log.vehicleId,
                    (vehicleFuelMap.get(log.vehicleId) || 0) + amount
                );
            }
        });

        const averageFuelCost = totalFuelAmount > 0 ? totalFuelCost / totalFuelAmount : 0;

        let mostFuelConsumedVehicle = null;
        let leastFuelConsumedVehicle = null;

        if (vehicleFuelMap.size > 0) {
            let maxFuel = -1;
            let minFuel = Infinity;

            for (const [vehicleId, fuel] of vehicleFuelMap.entries()) {
                if (fuel > maxFuel) {
                    maxFuel = fuel;
                    mostFuelConsumedVehicle = vehicleId;
                }
                if (fuel < minFuel) {
                    minFuel = fuel;
                    leastFuelConsumedVehicle = vehicleId;
                }
            }
            if (minFuel === maxFuel) {
                leastFuelConsumedVehicle = mostFuelConsumedVehicle;
            }
        }

        console.log('⛽ Fuel report generated.');
        return {
            totalFuelLogs,
            totalFuelAmount,
            totalFuelCost,
            averageFuelCost,
            mostFuelConsumedVehicle,
            leastFuelConsumedVehicle
        };
    } catch (error) {
        console.error('❌ generateFuelReport failed:', error);
        throw new Error('Failed to generate fuel report.');
    }
}

/**
 * Generate a maintenance report from all maintenance logs.
 * @param {string} role - The user's role
 * @param {string|null} depotId - The user's depotId
 * @returns {Promise<Object>} Report object.
 */
export async function generateMaintenanceReport(role, depotId) {
    try {
        const logs = await getAllMaintenanceLogs({ role, depotId });
        const totalMaintenanceRecords = logs.length;

        let scheduledMaintenance = 0;
        let inProgressMaintenance = 0;
        let completedMaintenance = 0;
        let cancelledMaintenance = 0;
        let totalMaintenanceCost = 0;
        const vehicleCostMap = new Map();

        logs.forEach(log => {
            const status = log.status || '';
            if (status === 'Scheduled') scheduledMaintenance++;
            else if (status === 'In Progress') inProgressMaintenance++;
            else if (status === 'Completed') completedMaintenance++;
            else if (status === 'Cancelled') cancelledMaintenance++;

            const cost = Number(log.cost) || 0;
            totalMaintenanceCost += cost;

            if (log.vehicleId) {
                vehicleCostMap.set(
                    log.vehicleId,
                    (vehicleCostMap.get(log.vehicleId) || 0) + cost
                );
            }
        });

        let highestCostVehicle = null;
        if (vehicleCostMap.size > 0) {
            let maxCost = -1;
            for (const [vehicleId, cost] of vehicleCostMap.entries()) {
                if (cost > maxCost) {
                    maxCost = cost;
                    highestCostVehicle = vehicleId;
                }
            }
        }

        console.log('🔧 Maintenance report generated.');
        return {
            totalMaintenanceRecords,
            scheduledMaintenance,
            inProgressMaintenance,
            completedMaintenance,
            cancelledMaintenance,
            totalMaintenanceCost,
            highestCostVehicle
        };
    } catch (error) {
        console.error('❌ generateMaintenanceReport failed:', error);
        throw new Error('Failed to generate maintenance report.');
    }
}

/**
 * Generate a vehicle utilization report using vehicles and schedules.
 * @param {string} role - The user's role
 * @param {string|null} depotId - The user's depotId
 * @returns {Promise<Object>} Report object.
 */
export async function generateVehicleUtilizationReport(role, depotId) {
    try {
        const [vehicles, schedules] = await Promise.all([
            getAllVehicles({ role, depotId }),
            getAllSchedules({ role, depotId })
        ]);

        const totalVehicles = vehicles.length;
        const tripCountMap = new Map();

        vehicles.forEach(v => tripCountMap.set(v.id, 0));

        schedules.forEach(s => {
            if (s.vehicleId && tripCountMap.has(s.vehicleId)) {
                tripCountMap.set(s.vehicleId, tripCountMap.get(s.vehicleId) + 1);
            }
        });

        const utilizationData = [];
        vehicles.forEach(v => {
            utilizationData.push({
                vehicleId: v.id,
                tripCount: tripCountMap.get(v.id) || 0
            });
        });

        let mostUsedVehicle = null;
        let leastUsedVehicle = null;

        let maxTrips = -1;
        let minTrips = Infinity;

        for (const [vehicleId, count] of tripCountMap.entries()) {
            if (count > maxTrips) {
                maxTrips = count;
                mostUsedVehicle = vehicleId;
            }
            if (count < minTrips) {
                minTrips = count;
                leastUsedVehicle = vehicleId;
            }
        }

        if (maxTrips === 0 && minTrips === 0) {
            mostUsedVehicle = null;
            leastUsedVehicle = null;
        }

        console.log('🚌 Vehicle utilization report generated.');
        return {
            totalVehicles,
            mostUsedVehicle,
            leastUsedVehicle,
            utilizationData
        };
    } catch (error) {
        console.error('❌ generateVehicleUtilizationReport failed:', error);
        throw new Error('Failed to generate vehicle utilization report.');
    }
}

/**
 * Generate a route performance report using routes and schedules.
 * @param {string} role - The user's role
 * @param {string|null} depotId - The user's depotId
 * @returns {Promise<Object>} Report object.
 */
export async function generateRoutePerformanceReport(role, depotId) {
    try {
        const [routes, schedules] = await Promise.all([
            getAllRoutes({ role, depotId }),
            getAllSchedules({ role, depotId })
        ]);

        const totalRoutes = routes.length;
        const totalSchedules = schedules.length;

        let completedTrips = 0;
        let cancelledTrips = 0;
        let scheduledTrips = 0;

        schedules.forEach(s => {
            if (s.status === 'Completed') completedTrips++;
            else if (s.status === 'Cancelled') cancelledTrips++;
            else if (s.status === 'Scheduled') scheduledTrips++;
        });

        const routeCountMap = new Map();
        routes.forEach(r => routeCountMap.set(r.id, 0));

        schedules.forEach(s => {
            if (s.routeId && routeCountMap.has(s.routeId)) {
                routeCountMap.set(s.routeId, routeCountMap.get(s.routeId) + 1);
            }
        });

        const routePerformanceData = [];
        routes.forEach(r => {
            routePerformanceData.push({
                routeId: r.id,
                tripCount: routeCountMap.get(r.id) || 0
            });
        });

        console.log('🗺️ Route performance report generated.');
        return {
            totalRoutes,
            totalSchedules,
            completedTrips,
            cancelledTrips,
            scheduledTrips,
            routePerformanceData
        };
    } catch (error) {
        console.error('❌ generateRoutePerformanceReport failed:', error);
        throw new Error('Failed to generate route performance report.');
    }
}

// ============================================================
//  ANALYTICS SERVICE LAYER (Phase 1) – READ-ONLY AGGREGATIONS
// ============================================================

/**
 * Fleet analytics: counts vehicles by status and availability rate.
 * @returns {Promise<Object>} { totalVehicles, activeVehicles, maintenanceVehicles, inactiveVehicles, fleetAvailabilityRate }
 */
export async function getFleetAnalytics() {
    try {
        const vehicles = await getAllVehicles();
        const totalVehicles = vehicles.length;
        let activeVehicles = 0;
        let maintenanceVehicles = 0;
        let inactiveVehicles = 0;

        vehicles.forEach(v => {
            const status = (v.status || '').toLowerCase();
            if (status === 'active') activeVehicles++;
            else if (status === 'maintenance') maintenanceVehicles++;
            else if (status === 'inactive') inactiveVehicles++;
        });

        const fleetAvailabilityRate = totalVehicles > 0
            ? (activeVehicles / totalVehicles) * 100
            : 0;

        console.log('📊 Fleet analytics calculated.');
        return {
            totalVehicles,
            activeVehicles,
            maintenanceVehicles,
            inactiveVehicles,
            fleetAvailabilityRate
        };
    } catch (error) {
        console.error('❌ getFleetAnalytics failed:', error);
        return {
            totalVehicles: 0,
            activeVehicles: 0,
            maintenanceVehicles: 0,
            inactiveVehicles: 0,
            fleetAvailabilityRate: 0
        };
    }
}

/**
 * Fuel analytics: aggregates fuel logs.
 * @returns {Promise<Object>} { totalFuelLogs, totalFuelAmount, totalFuelCost, averageFuelCost, averageFuelAmount }
 */
export async function getFuelAnalytics() {
    try {
        const logs = await getAllFuelLogs();
        const totalFuelLogs = logs.length;
        let totalFuelAmount = 0;
        let totalFuelCost = 0;

        logs.forEach(log => {
            totalFuelAmount += Number(log.fuelAmount) || 0;
            totalFuelCost += Number(log.fuelCost) || 0;
        });

        const averageFuelCost = totalFuelAmount > 0 ? totalFuelCost / totalFuelAmount : 0;
        const averageFuelAmount = totalFuelLogs > 0 ? totalFuelAmount / totalFuelLogs : 0;

        console.log('⛽ Fuel analytics calculated.');
        return {
            totalFuelLogs,
            totalFuelAmount,
            totalFuelCost,
            averageFuelCost,
            averageFuelAmount
        };
    } catch (error) {
        console.error('❌ getFuelAnalytics failed:', error);
        return {
            totalFuelLogs: 0,
            totalFuelAmount: 0,
            totalFuelCost: 0,
            averageFuelCost: 0,
            averageFuelAmount: 0
        };
    }
}

/**
 * Maintenance analytics: status breakdown and total cost.
 * @returns {Promise<Object>} { totalMaintenanceRecords, scheduledCount, inProgressCount, completedCount, cancelledCount, totalMaintenanceCost }
 */
export async function getMaintenanceAnalytics() {
    try {
        const records = await getAllMaintenanceLogs();
        const totalMaintenanceRecords = records.length;
        let scheduledCount = 0;
        let inProgressCount = 0;
        let completedCount = 0;
        let cancelledCount = 0;
        let totalMaintenanceCost = 0;

        records.forEach(rec => {
            const status = rec.status || '';
            if (status === 'Scheduled') scheduledCount++;
            else if (status === 'In Progress') inProgressCount++;
            else if (status === 'Completed') completedCount++;
            else if (status === 'Cancelled') cancelledCount++;
            totalMaintenanceCost += Number(rec.cost) || 0;
        });

        console.log('🔧 Maintenance analytics calculated.');
        return {
            totalMaintenanceRecords,
            scheduledCount,
            inProgressCount,
            completedCount,
            cancelledCount,
            totalMaintenanceCost
        };
    } catch (error) {
        console.error('❌ getMaintenanceAnalytics failed:', error);
        return {
            totalMaintenanceRecords: 0,
            scheduledCount: 0,
            inProgressCount: 0,
            completedCount: 0,
            cancelledCount: 0,
            totalMaintenanceCost: 0
        };
    }
}

/**
 * Schedule analytics: status breakdown and completion rate.
 * @returns {Promise<Object>} { totalSchedules, completedSchedules, cancelledSchedules, inProgressSchedules, scheduledSchedules, completionRate }
 */
export async function getScheduleAnalytics() {
    try {
        const schedules = await getAllSchedules();
        const totalSchedules = schedules.length;
        let completedSchedules = 0;
        let cancelledSchedules = 0;
        let inProgressSchedules = 0;
        let scheduledSchedules = 0;

        schedules.forEach(s => {
            const status = s.status || '';
            if (status === 'Completed') completedSchedules++;
            else if (status === 'Cancelled') cancelledSchedules++;
            else if (status === 'In Progress') inProgressSchedules++;
            else if (status === 'Scheduled') scheduledSchedules++;
        });

        const completionRate = totalSchedules > 0
            ? (completedSchedules / totalSchedules) * 100
            : 0;

        console.log('📅 Schedule analytics calculated.');
        return {
            totalSchedules,
            completedSchedules,
            cancelledSchedules,
            inProgressSchedules,
            scheduledSchedules,
            completionRate
        };
    } catch (error) {
        console.error('❌ getScheduleAnalytics failed:', error);
        return {
            totalSchedules: 0,
            completedSchedules: 0,
            cancelledSchedules: 0,
            inProgressSchedules: 0,
            scheduledSchedules: 0,
            completionRate: 0
        };
    }
}

// ============================================================
//  CONFLICTS COLLECTION (IDEMPOTENT DETECTION & LIFECYCLE)
// ============================================================

/**
 * Fetch all conflict documents, optionally filtered by depot.
 * For non‑superadmin roles, conflicts are scoped to schedules of the user's depot.
 *
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Array>} Array of conflict objects { id, ...data }
 */
export async function getAllConflicts(filters = {}) {
    try {
        const conflictsCol = collection(db, 'conflicts');
        const snapshot = await getDocs(conflictsCol);
        let conflicts = [];
        snapshot.forEach(docSnap => {
            conflicts.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });

        const { role, depotId } = filters;

        if (role && role !== 'superadmin' && depotId) {
            const schedulesCol = collection(db, 'schedules');
            const depotSchedulesQ = query(schedulesCol, where('depotId', '==', depotId));
            const depotSchedulesSnap = await getDocs(depotSchedulesQ);
            const allowedScheduleIds = new Set();
            depotSchedulesSnap.forEach(doc => allowedScheduleIds.add(doc.id));

            conflicts = conflicts.filter(c => allowedScheduleIds.has(c.relatedSchedule));
        }

        console.log(`⚠️  Fetched ${conflicts.length} conflicts (role: ${role || 'none'}, depotId: ${depotId || 'none'}).`);
        return conflicts;
    } catch (error) {
        console.error('❌ getAllConflicts failed:', error);
        throw new Error('Failed to load conflicts. Please try again.');
    }
}

/**
 * Create a new conflict document.
 * @param {Object} conflictData - Must contain at least: conflictId, type, severity,
 *                                affectedResource, relatedSchedule, status, description.
 * @returns {Promise<string>} The auto‑generated document ID.
 */
export async function createConflict(conflictData) {
    try {
        const conflictsCol = collection(db, 'conflicts');
        const docRef = await addDoc(conflictsCol, {
            ...conflictData,
            detectedDate: serverTimestamp(),
            resolvedBy: null,
            resolvedAt: null,
            dismissedBy: null,
            dismissedAt: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log(`⚠️  Conflict created: ${docRef.id} (${conflictData.conflictId})`);
        return docRef.id;
    } catch (error) {
        console.error('❌ createConflict failed:', error);
        throw new Error('Failed to create conflict. Please try again.');
    }
}

/**
 * Update an existing conflict document identified by its business conflictId.
 */
export async function updateConflict(conflictId, updatedData) {
    try {
        const conflictsCol = collection(db, 'conflicts');
        const q = query(conflictsCol, where('conflictId', '==', conflictId));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            throw new Error(`Conflict ${conflictId} not found.`);
        }

        const docRef = doc(db, 'conflicts', snapshot.docs[0].id);
        await updateDoc(docRef, {
            ...updatedData,
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Conflict ${conflictId} updated.`);
    } catch (error) {
        console.error('❌ updateConflict failed:', error);
        throw new Error('Failed to update conflict. Please try again.');
    }
}

/**
 * Dismiss a conflict using its Firestore document ID.
 * @param {string} docId - Firestore document ID of the conflict.
 * @param {string} dismissedByUser - Identifier of the user dismissing the conflict.
 */
export async function dismissConflict(docId, dismissedByUser) {
    try {
        const conflictRef = doc(db, 'conflicts', docId);
        await updateDoc(conflictRef, {
            status: 'dismissed',
            dismissedBy: dismissedByUser,
            dismissedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log(`❌ Conflict ${docId} dismissed by ${dismissedByUser}`);
    } catch (error) {
        console.error('❌ dismissConflict failed:', error);
        throw error;
    }
}

// ============================================================
//  INTERNAL – Generate a batch of unique conflict IDs
// ============================================================

async function getNextConflictIds(count) {
    if (count <= 0) return [];
    const conflictsCol = collection(db, 'conflicts');
    const q = query(conflictsCol, orderBy('conflictId', 'desc'), limit(1));
    const snapshot = await getDocs(q);

    let nextNum = 1;
    if (!snapshot.empty) {
        const lastId = snapshot.docs[0].data().conflictId;
        const num = parseInt(lastId.replace('CON', ''), 10);
        if (!isNaN(num)) nextNum = num + 1;
    }

    const ids = [];
    for (let i = 0; i < count; i++) {
        ids.push(`CON${String(nextNum + i).padStart(3, '0')}`);
    }
    return ids;
}

export async function migrateDuplicateConflictIds() {
    try {
        const conflictsCol = collection(db, 'conflicts');
        const q = query(conflictsCol, orderBy('createdAt', 'asc'));
        const snapshot = await getDocs(q);

        const conflicts = [];
        snapshot.forEach(docSnap => conflicts.push({ id: docSnap.id, ...docSnap.data() }));

        const idCounts = {};
        conflicts.forEach(c => {
            if (c.conflictId) {
                idCounts[c.conflictId] = (idCounts[c.conflictId] || 0) + 1;
            }
        });
        const hasDuplicates = Object.values(idCounts).some(count => count > 1);
        if (!hasDuplicates) {
            console.log('✅ No duplicate conflict IDs found. Migration skipped.');
            return;
        }

        console.warn('⚠️ Duplicate conflict IDs detected. Starting migration…');
        for (let i = 0; i < conflicts.length; i++) {
            const newId = `CON${String(i + 1).padStart(3, '0')}`;
            if (conflicts[i].conflictId !== newId) {
                await updateDoc(doc(db, 'conflicts', conflicts[i].id), {
                    conflictId: newId,
                    updatedAt: serverTimestamp()
                });
                console.log(`🔄 Migrated ${conflicts[i].id}: ${conflicts[i].conflictId} → ${newId}`);
            }
        }
        console.log('✅ Conflict ID migration complete.');
    } catch (error) {
        console.error('❌ migrateDuplicateConflictIds failed:', error);
    }
}

function timeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.split(':');
    if (parts.length !== 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

function isTimeOverlap(start1, end1, start2, end2) {
    const s1 = timeToMinutes(start1);
    const e1 = timeToMinutes(end1);
    const s2 = timeToMinutes(start2);
    const e2 = timeToMinutes(end2);
    if (s1 === null || e1 === null || s2 === null || e2 === null) return false;
    return s1 < e2 && s2 < e1;
}

function normalizeDate(dateVal) {
    if (!dateVal) return '';
    if (typeof dateVal === 'string') return dateVal.slice(0, 10);
    if (dateVal.toDate) {
        const d = dateVal.toDate();
        return d.toISOString().slice(0, 10);
    }
    return '';
}

function computeConflictKey(type, affectedResource, suffix) {
    return `${type}::${affectedResource}::${suffix}`;
}

async function getConflictByKey(conflictKey) {
    const conflictsCol = collection(db, 'conflicts');
    const q = query(conflictsCol, where('conflictKey', '==', conflictKey), limit(1));
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * Idempotent conflict detection and lifecycle management.
 * Creates, re‑opens, or auto‑resolves conflicts based on root‑cause conditions.
 * @returns {Promise<Object>} { created, reopened, autoResolved }
 */
export async function detectAndGenerateConflicts() {
    try {
        console.log('🔍 Starting conflict detection (idempotent)…');
        await migrateDuplicateConflictIds();

        const [schedules, vehicles, maintenance] = await Promise.all([
            getAllSchedules(),
            getAllVehicles(),
            getAllMaintenanceLogs()
        ]);

        const vehicleMap = {};
        vehicles.forEach(v => { vehicleMap[v.id] = v; });

        const maintenanceByVehicle = {};
        maintenance.forEach(m => {
            if (m.status !== 'Completed' && m.vehicleId && m.serviceDate) {
                const date = normalizeDate(m.serviceDate);
                if (date) {
                    if (!maintenanceByVehicle[m.vehicleId]) maintenanceByVehicle[m.vehicleId] = new Set();
                    maintenanceByVehicle[m.vehicleId].add(date);
                }
            }
        });

        const activeConflictKeys = new Set();
        const created = [];
        const reopened = [];

        // ─── 1. DRIVER OVERLAP ───
        const driverDateMap = {};
        schedules.forEach(s => {
            if (!s.driverId || !s.scheduleDate || !s.departureTime || !s.arrivalTime) return;
            const date = normalizeDate(s.scheduleDate);
            const key = `${s.driverId}|${date}`;
            if (!driverDateMap[key]) driverDateMap[key] = [];
            driverDateMap[key].push(s);
        });

        for (const [key, schList] of Object.entries(driverDateMap)) {
            const [driverId, date] = key.split('|');
            let hasOverlap = false;
            let representativeScheduleId = schList[0].id;
            for (let i = 0; i < schList.length; i++) {
                for (let j = i + 1; j < schList.length; j++) {
                    if (isTimeOverlap(schList[i].departureTime, schList[i].arrivalTime,
                        schList[j].departureTime, schList[j].arrivalTime)) {
                        hasOverlap = true;
                        break;
                    }
                }
                if (hasOverlap) break;
            }
            if (hasOverlap) {
                const conflictKey = computeConflictKey('driver_overlap', driverId, date);
                activeConflictKeys.add(conflictKey);
                const existing = await getConflictByKey(conflictKey);
                if (existing) {
                    if (existing.status !== 'open') {
                        await updateDoc(doc(db, 'conflicts', existing.id), {
                            status: 'open',
                            detectedDate: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                            resolvedBy: null,
                            resolvedAt: null
                        });
                        reopened.push({ id: existing.id, conflictId: existing.conflictId, type: 'Driver Conflict', ...existing });
                    }
                } else {
                    const conflictId = (await getNextConflictIds(1))[0];
                    const payload = {
                        conflictId,
                        conflictKey,
                        type: 'Driver Conflict',
                        severity: 'high',
                        status: 'open',
                        description: `Driver ${driverId} has overlapping schedules on ${date} (${representativeScheduleId} involved).`,
                        affectedResource: driverId,
                        relatedSchedule: representativeScheduleId,
                        detectedDate: serverTimestamp(),
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    };
                    const docRef = await addDoc(collection(db, 'conflicts'), payload);
                    created.push({ id: docRef.id, ...payload });
                }
            }
        }

        // ─── 2. VEHICLE OVERLAP ───
        const vehicleDateMap = {};
        schedules.forEach(s => {
            if (!s.vehicleId || !s.scheduleDate || !s.departureTime || !s.arrivalTime) return;
            const date = normalizeDate(s.scheduleDate);
            const key = `${s.vehicleId}|${date}`;
            if (!vehicleDateMap[key]) vehicleDateMap[key] = [];
            vehicleDateMap[key].push(s);
        });

        for (const [key, schList] of Object.entries(vehicleDateMap)) {
            const [vehicleId, date] = key.split('|');
            let hasOverlap = false;
            let representativeScheduleId = schList[0].id;
            for (let i = 0; i < schList.length; i++) {
                for (let j = i + 1; j < schList.length; j++) {
                    if (isTimeOverlap(schList[i].departureTime, schList[i].arrivalTime,
                        schList[j].departureTime, schList[j].arrivalTime)) {
                        hasOverlap = true;
                        break;
                    }
                }
                if (hasOverlap) break;
            }
            if (hasOverlap) {
                const conflictKey = computeConflictKey('vehicle_overlap', vehicleId, date);
                activeConflictKeys.add(conflictKey);
                const existing = await getConflictByKey(conflictKey);
                if (existing) {
                    if (existing.status !== 'open') {
                        await updateDoc(doc(db, 'conflicts', existing.id), {
                            status: 'open',
                            detectedDate: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                            resolvedBy: null,
                            resolvedAt: null
                        });
                        reopened.push({ id: existing.id, conflictId: existing.conflictId, type: 'Vehicle Conflict', ...existing });
                    }
                } else {
                    const conflictId = (await getNextConflictIds(1))[0];
                    const payload = {
                        conflictId,
                        conflictKey,
                        type: 'Vehicle Conflict',
                        severity: 'critical',
                        status: 'open',
                        description: `Vehicle ${vehicleId} has overlapping schedules on ${date} (${representativeScheduleId} involved).`,
                        affectedResource: vehicleId,
                        relatedSchedule: representativeScheduleId,
                        detectedDate: serverTimestamp(),
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    };
                    const docRef = await addDoc(collection(db, 'conflicts'), payload);
                    created.push({ id: docRef.id, ...payload });
                }
            }
        }

        // ─── 3. MAINTENANCE CONFLICT ───
        for (const s of schedules) {
            if (!s.vehicleId || !s.scheduleDate) continue;
            const date = normalizeDate(s.scheduleDate);
            if (maintenanceByVehicle[s.vehicleId]?.has(date)) {
                const conflictKey = computeConflictKey('maintenance', s.vehicleId, s.id);
                activeConflictKeys.add(conflictKey);
                const existing = await getConflictByKey(conflictKey);
                if (existing) {
                    if (existing.status !== 'open') {
                        await updateDoc(doc(db, 'conflicts', existing.id), {
                            status: 'open',
                            detectedDate: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                            resolvedBy: null,
                            resolvedAt: null
                        });
                        reopened.push({ id: existing.id, conflictId: existing.conflictId, type: 'Maintenance Conflict', ...existing });
                    }
                } else {
                    const conflictId = (await getNextConflictIds(1))[0];
                    const payload = {
                        conflictId,
                        conflictKey,
                        type: 'Maintenance Conflict',
                        severity: 'critical',
                        status: 'open',
                        description: `Vehicle ${s.vehicleId} has scheduled maintenance on ${date} and is assigned to schedule ${s.id}.`,
                        affectedResource: s.vehicleId,
                        relatedSchedule: s.id,
                        detectedDate: serverTimestamp(),
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    };
                    const docRef = await addDoc(collection(db, 'conflicts'), payload);
                    created.push({ id: docRef.id, ...payload });
                }
            }
        }

        // ─── 4. INACTIVE VEHICLE CONFLICT ───
        for (const s of schedules) {
            if (!s.vehicleId) continue;
            const vehicle = vehicleMap[s.vehicleId];
            if (vehicle && vehicle.status === 'inactive') {
                const conflictKey = computeConflictKey('inactive_vehicle', s.vehicleId, s.id);
                activeConflictKeys.add(conflictKey);
                const existing = await getConflictByKey(conflictKey);
                if (existing) {
                    if (existing.status !== 'open') {
                        await updateDoc(doc(db, 'conflicts', existing.id), {
                            status: 'open',
                            detectedDate: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                            resolvedBy: null,
                            resolvedAt: null
                        });
                        reopened.push({ id: existing.id, conflictId: existing.conflictId, type: 'Inactive Vehicle Conflict', ...existing });
                    }
                } else {
                    const conflictId = (await getNextConflictIds(1))[0];
                    const payload = {
                        conflictId,
                        conflictKey,
                        type: 'Inactive Vehicle Conflict',
                        severity: 'medium',
                        status: 'open',
                        description: `Vehicle ${s.vehicleId} is inactive but assigned to schedule ${s.id}.`,
                        affectedResource: s.vehicleId,
                        relatedSchedule: s.id,
                        detectedDate: serverTimestamp(),
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    };
                    const docRef = await addDoc(collection(db, 'conflicts'), payload);
                    created.push({ id: docRef.id, ...payload });
                }
            }
        }

        // ─── 5. AUTO‑RESOLVE CONFLICTS WHOSE KEYS ARE NO LONGER ACTIVE ───
        const autoResolved = [];
        const allOpenConflictsSnap = await getDocs(
            query(collection(db, 'conflicts'),
                where('status', '==', 'open'),
                where('conflictKey', '!=', null))
        );
        for (const docSnap of allOpenConflictsSnap.docs) {
            const data = docSnap.data();
            if (!activeConflictKeys.has(data.conflictKey)) {
                await updateDoc(doc(db, 'conflicts', docSnap.id), {
                    status: 'auto_resolved',
                    resolvedBy: 'system',
                    resolvedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
                autoResolved.push({ id: docSnap.id, conflictId: data.conflictId, conflictKey: data.conflictKey });
                await createActivityLog({
                    action: 'CONFLICT_AUTO_RESOLVED',
                    performedBy: null,
                    performedByName: 'System',
                    targetId: data.conflictId || docSnap.id,
                    targetType: 'conflict',
                    timestamp: new Date()
                });
            }
        }

        console.log(`✅ Conflict detection completed. Created: ${created.length}, Reopened: ${reopened.length}, Auto‑resolved: ${autoResolved.length}`);
        return { created, reopened, autoResolved };
    } catch (error) {
        console.error('❌ detectAndGenerateConflicts failed:', error);
        return { created: [], reopened: [], autoResolved: [] };
    }
}

// ============================================================
//  USERS COLLECTION – getUsersByRole
// ============================================================

/**
 * Fetch all user documents matching a specific role.
 * @param {string} role - e.g., "admin"
 * @returns {Promise<Array>} Array of user objects { id, name, ... }
 */
export async function getUsersByRole(role) {
    try {
        const usersCol = collection(db, 'users');
        const q = query(usersCol, where('role', '==', role));
        const snapshot = await getDocs(q);
        const users = [];
        snapshot.forEach(doc => {
            users.push({ id: doc.id, ...doc.data() });
        });
        console.log(`👥 Fetched ${users.length} users with role ${role}`);
        return users;
    } catch (error) {
        console.error('❌ getUsersByRole failed:', error);
        throw new Error('Failed to load users by role.');
    }
}

// ============================================================
//  DEPOTS COLLECTION
// ============================================================

/**
 * Generate the next business depot ID (e.g., DP001, DP002…).
 * @returns {Promise<string>} The next available depot ID.
 */
export async function getNextDepotId() {
    try {
        const depotsCol = collection(db, 'depots');
        const q = query(depotsCol, orderBy('depotId', 'desc'), limit(1));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return 'DP001';
        }

        const lastDoc = snapshot.docs[0];
        const lastId = lastDoc.data().depotId;
        if (!lastId) {
            return 'DP001';
        }

        const num = parseInt(lastId.replace('DP', ''), 10);
        if (isNaN(num)) {
            return 'DP001';
        }
        const nextNum = num + 1;
        return `DP${String(nextNum).padStart(3, '0')}`;
    } catch (error) {
        console.error('❌ getNextDepotId failed:', error);
        throw new Error('Failed to generate next depot ID.');
    }
}

/**
 * Fetch all depot documents from the `depots` collection.
 * @returns {Promise<Array>} Array of depot objects { id (docID = depotId), depotId, depotName, ... }
 */
export async function getAllDepots() {
    try {
        const depotsCol = collection(db, 'depots');
        const snapshot = await getDocs(depotsCol);
        const depots = [];
        snapshot.forEach(docSnap => {
            depots.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });
        console.log(`🏢 Fetched ${depots.length} depots from Firestore.`);
        return depots;
    } catch (error) {
        console.error('❌ getAllDepots failed:', error);
        throw new Error('Failed to load depots. Please try again.');
    }
}

/**
 * Fetch a single depot document by its business depotId.
 * @param {string} depotId - The depot identifier (e.g., "DP001")
 * @returns {Promise<Object|null>} Depot data object or null if not found.
 */
export async function getDepotById(depotId) {
    try {
        const depotRef = doc(db, 'depots', depotId);
        const depotSnap = await getDoc(depotRef);
        if (!depotSnap.exists()) {
            console.warn(`⚠️ Depot ${depotId} not found.`);
            return null;
        }
        console.log(`🏢 Depot ${depotId} fetched successfully.`);
        return {
            id: depotSnap.id,
            ...depotSnap.data()
        };
    } catch (error) {
        console.error('❌ getDepotById failed:', error);
        throw new Error('Failed to load depot data. Please try again.');
    }
}

/**
 * Create a new depot document. Auto-generates the depotId and uses it as the document ID.
 * @param {Object} depotData - { depotName, location, adminUserId, contactNo, capacity, status, currentVehicleCount }
 * @returns {Promise<string>} The generated depotId.
 */
export async function createDepotInFirestore(depotData) {
    try {
        const depotId = await getNextDepotId();
        const depotRef = doc(db, 'depots', depotId);
        await setDoc(depotRef, {
            depotId: depotId,
            depotName: depotData.depotName,
            location: depotData.location,
            adminUserId: depotData.adminUserId || null,
            contactNo: depotData.contactNo,
            capacity: depotData.capacity,
            status: depotData.status,
            currentVehicleCount: depotData.currentVehicleCount || 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Depot ${depotId} created with adminUserId: ${depotData.adminUserId || 'none'}`);
        return depotId;
    } catch (error) {
        console.error('❌ createDepotInFirestore failed:', error);
        throw new Error('Failed to create depot. Please try again.');
    }
}

/**
 * Update an existing depot document.
 * @param {string} depotId - The depot identifier (document ID)
 * @param {Object} depotData - Fields to update
 */
export async function updateDepotInFirestore(depotId, depotData) {
    try {
        const depotRef = doc(db, 'depots', depotId);
        await updateDoc(depotRef, {
            ...depotData,
            updatedAt: serverTimestamp()
        });
        console.log(`✅ Depot ${depotId} updated.`);
    } catch (error) {
        console.error('❌ updateDepotInFirestore failed:', error);
        throw new Error('Failed to update depot. Please try again.');
    }
}

/**
 * Delete a depot document by its ID.
 * @param {string} depotId - The depot identifier (document ID)
 */
export async function deleteDepotFromFirestore(depotId) {
    try {
        const depotRef = doc(db, 'depots', depotId);
        await deleteDoc(depotRef);
        console.log(`🗑️  Depot ${depotId} deleted.`);
    } catch (error) {
        console.error('❌ deleteDepotFromFirestore failed:', error);
        throw new Error('Failed to delete depot. Please try again.');
    }
}

/**
 * Fetch all depots with status 'active'.
 * @returns {Promise<Array>} Array of active depot objects.
 */
export async function getActiveDepots() {
    try {
        const depotsCol = collection(db, 'depots');
        const q = query(depotsCol, where('status', '==', 'active'));
        const snapshot = await getDocs(q);
        const depots = [];
        snapshot.forEach(docSnap => {
            depots.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });
        console.log(`🏢 Fetched ${depots.length} active depots.`);
        return depots;
    } catch (error) {
        console.error('❌ getActiveDepots failed:', error);
        throw new Error('Failed to load active depots. Please try again.');
    }
}

// ============================================================
//  ANALYTICS MODULE — DEPOT-AWARE AGGREGATION HELPERS  (NEW)
//  Added for the Analytics module (analytics.js / analytics.html)
//  These extend the existing analytics layer with depot-scoped
//  variants. analytics.js aggregates in-memory from raw arrays
//  fetched via getAllVehicles/getAllFuelLogs/etc. to avoid double
//  Firestore reads. These exports are for other modules that
//  need depot-scoped summaries without managing raw arrays.
// ============================================================

/**
 * Depot-aware fleet analytics.
 * Computes vehicle status counts and availability rate for a specific depot,
 * or all depots when called with no filters / superadmin role.
 *
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Object>} { totalVehicles, activeVehicles, maintenanceVehicles, inactiveVehicles, fleetAvailabilityRate }
 */
export async function getFleetAnalyticsByDepot(filters = {}) {
    try {
        const vehicles = await getAllVehicles(filters);
        const totalVehicles = vehicles.length;
        let activeVehicles = 0;
        let maintenanceVehicles = 0;
        let inactiveVehicles = 0;

        vehicles.forEach(v => {
            const status = (v.status || '').toLowerCase();
            if (status === 'active') activeVehicles++;
            else if (status === 'maintenance') maintenanceVehicles++;
            else if (status === 'inactive') inactiveVehicles++;
        });

        const fleetAvailabilityRate = totalVehicles > 0
            ? (activeVehicles / totalVehicles) * 100
            : 0;

        console.log(`📊 Fleet analytics (depot: ${filters.depotId || 'all'}) — ${totalVehicles} vehicles.`);
        return { totalVehicles, activeVehicles, maintenanceVehicles, inactiveVehicles, fleetAvailabilityRate };
    } catch (error) {
        console.error('❌ getFleetAnalyticsByDepot failed:', error);
        return { totalVehicles: 0, activeVehicles: 0, maintenanceVehicles: 0, inactiveVehicles: 0, fleetAvailabilityRate: 0 };
    }
}

/**
 * Depot-aware fuel analytics.
 * Aggregates fuel logs for a specific depot (or all depots for superadmin).
 *
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Object>} { totalFuelLogs, totalFuelAmount, totalFuelCost, averageFuelCost, averageFuelAmount }
 */
export async function getFuelAnalyticsByDepot(filters = {}) {
    try {
        const logs = await getAllFuelLogs(filters);
        const totalFuelLogs = logs.length;
        let totalFuelAmount = 0;
        let totalFuelCost = 0;

        logs.forEach(l => {
            totalFuelAmount += Number(l.fuelAmount) || 0;
            totalFuelCost += Number(l.fuelCost) || 0;
        });

        const averageFuelCost = totalFuelAmount > 0 ? totalFuelCost / totalFuelAmount : 0;
        const averageFuelAmount = totalFuelLogs > 0 ? totalFuelAmount / totalFuelLogs : 0;

        console.log(`⛽ Fuel analytics (depot: ${filters.depotId || 'all'}) — ${totalFuelLogs} logs.`);
        return { totalFuelLogs, totalFuelAmount, totalFuelCost, averageFuelCost, averageFuelAmount };
    } catch (error) {
        console.error('❌ getFuelAnalyticsByDepot failed:', error);
        return { totalFuelLogs: 0, totalFuelAmount: 0, totalFuelCost: 0, averageFuelCost: 0, averageFuelAmount: 0 };
    }
}

/**
 * Depot-aware maintenance analytics.
 * Computes maintenance status breakdown and total cost for a specific depot.
 *
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Object>} { totalMaintenanceRecords, scheduledCount, inProgressCount, completedCount, cancelledCount, totalMaintenanceCost }
 */
export async function getMaintenanceAnalyticsByDepot(filters = {}) {
    try {
        const records = await getAllMaintenanceLogs(filters);
        const totalMaintenanceRecords = records.length;
        let scheduledCount = 0;
        let inProgressCount = 0;
        let completedCount = 0;
        let cancelledCount = 0;
        let totalMaintenanceCost = 0;

        records.forEach(r => {
            const status = r.status || '';
            if (status === 'Scheduled') scheduledCount++;
            else if (status === 'In Progress') inProgressCount++;
            else if (status === 'Completed') completedCount++;
            else if (status === 'Cancelled') cancelledCount++;
            totalMaintenanceCost += Number(r.cost) || 0;
        });

        console.log(`🔧 Maintenance analytics (depot: ${filters.depotId || 'all'}) — ${totalMaintenanceRecords} records.`);
        return { totalMaintenanceRecords, scheduledCount, inProgressCount, completedCount, cancelledCount, totalMaintenanceCost };
    } catch (error) {
        console.error('❌ getMaintenanceAnalyticsByDepot failed:', error);
        return { totalMaintenanceRecords: 0, scheduledCount: 0, inProgressCount: 0, completedCount: 0, cancelledCount: 0, totalMaintenanceCost: 0 };
    }
}

/**
 * Depot-aware schedule analytics.
 * Computes schedule status breakdown and completion rate for a specific depot.
 *
 * @param {Object} [filters] - { role, depotId }
 * @returns {Promise<Object>} { totalSchedules, completedSchedules, cancelledSchedules, inProgressSchedules, scheduledSchedules, completionRate }
 */
export async function getScheduleAnalyticsByDepot(filters = {}) {
    try {
        const schedules = await getAllSchedules(filters);
        const totalSchedules = schedules.length;
        let completedSchedules = 0;
        let cancelledSchedules = 0;
        let inProgressSchedules = 0;
        let scheduledSchedules = 0;

        schedules.forEach(s => {
            const status = s.status || '';
            if (status === 'Completed') completedSchedules++;
            else if (status === 'Cancelled') cancelledSchedules++;
            else if (status === 'In Progress') inProgressSchedules++;
            else if (status === 'Scheduled') scheduledSchedules++;
        });

        const completionRate = totalSchedules > 0
            ? (completedSchedules / totalSchedules) * 100
            : 0;

        console.log(`📅 Schedule analytics (depot: ${filters.depotId || 'all'}) — ${totalSchedules} schedules.`);
        return { totalSchedules, completedSchedules, cancelledSchedules, inProgressSchedules, scheduledSchedules, completionRate };
    } catch (error) {
        console.error('❌ getScheduleAnalyticsByDepot failed:', error);
        return { totalSchedules: 0, completedSchedules: 0, cancelledSchedules: 0, inProgressSchedules: 0, scheduledSchedules: 0, completionRate: 0 };
    }
}