/**
 * RouteX Transit – Notification Service (PHASE 1)
 * Wraps Firestore notification creation for common events.
 * No UI work – pure service layer.
 */
import { createNotification, getDriverByDriverId } from '../firebase/firestore-service.js';

async function resolveDriverInfo(driverId) {
    try {
        const info = await getDriverByDriverId(driverId);
        if (info && info.userId) {
            return info;
        }
    } catch (err) {
        console.error('Notification: failed to resolve driver info', err);
    }
    return { userId: null, name: 'Unknown Driver' };
}

export async function notifyScheduleAssigned(schedule) {
    try {
        const { driverId } = schedule;
        const scheduleName = schedule.scheduleId || schedule.id;
        const driver = await resolveDriverInfo(driverId);
        const message = `You have been assigned to Schedule ${scheduleName}`;

        await createNotification({
            title: 'Schedule Assigned',
            message,
            type: 'schedule_assigned',
            targetUserIds: driver.userId ? [driver.userId] : [],
            targetRoles: []
        });
        console.log(`🔔 Notification sent: Schedule Assigned → ${scheduleName}`);
    } catch (error) {
        console.error('notifyScheduleAssigned failed:', error);
    }
}

export async function notifyScheduleUpdated(schedule) {
    try {
        const { driverId } = schedule;
        const scheduleName = schedule.scheduleId || schedule.id;
        const driver = await resolveDriverInfo(driverId);
        const driverName = driver.name;
        const message = `Schedule ${scheduleName} (Driver: ${driverName}) has been updated`;

        await createNotification({
            title: 'Schedule Updated',
            message,
            type: 'schedule_updated',
            targetRoles: ['superadmin', 'admin', 'supervisor'],
            targetUserIds: driver.userId ? [driver.userId] : []
        });
        console.log(`🔔 Notification sent: Schedule Updated → ${scheduleName}`);
    } catch (error) {
        console.error('notifyScheduleUpdated failed:', error);
    }
}

export async function notifyTripStarted(schedule) {
    try {
        const { driverId } = schedule;
        const scheduleName = schedule.scheduleId || schedule.id;
        const driver = await resolveDriverInfo(driverId);
        const message = `Driver ${driver.name} started Schedule ${scheduleName}`;

        await createNotification({
            title: 'Trip Started',
            message,
            type: 'trip_started',
            targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
            targetUserIds: []
        });
        console.log(`🔔 Notification sent: Trip Started → ${scheduleName}`);
    } catch (error) {
        console.error('notifyTripStarted failed:', error);
    }
}

export async function notifyTripCompleted(schedule) {
    try {
        const { driverId } = schedule;
        const scheduleName = schedule.scheduleId || schedule.id;
        const driver = await resolveDriverInfo(driverId);
        const message = `Driver ${driver.name} completed Schedule ${scheduleName}`;

        await createNotification({
            title: 'Trip Completed',
            message,
            type: 'trip_completed',
            targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
            targetUserIds: []
        });
        console.log(`🔔 Notification sent: Trip Completed → ${scheduleName}`);
    } catch (error) {
        console.error('notifyTripCompleted failed:', error);
    }
}

export async function notifyRouteCreated(route) {
    try {
        const routeId = route.routeId;
        const message = `Route ${routeId} ${route.startPoint} → ${route.endPoint} created`;

        await createNotification({
            title: 'Route Created',
            message,
            type: 'route_created',
            targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
            targetUserIds: []
        });
        console.log(`🔔 Notification sent: Route Created → ${routeId}`);
    } catch (error) {
        console.error('notifyRouteCreated failed:', error);
    }
}

export async function notifyRouteUpdated(route) {
    try {
        const routeId = route.routeId;
        const message = `Route ${routeId} ${route.startPoint} → ${route.endPoint} updated`;

        await createNotification({
            title: 'Route Updated',
            message,
            type: 'route_updated',
            targetRoles: ['superadmin', 'admin', 'supervisor', 'staff'],
            targetUserIds: []
        });
        console.log(`🔔 Notification sent: Route Updated → ${routeId}`);
    } catch (error) {
        console.error('notifyRouteUpdated failed:', error);
    }
}

export async function notifyVehicleCreated(vehicle) {
    try {
        const vehicleId = vehicle.vehicleId;
        const message = `Vehicle ${vehicleId} registered`;

        await createNotification({
            title: 'Vehicle Created',
            message,
            type: 'vehicle_created',
            targetRoles: ['superadmin', 'admin', 'supervisor'],
            targetUserIds: []
        });
        console.log(`🔔 Notification sent: Vehicle Created → ${vehicleId}`);
    } catch (error) {
        console.error('notifyVehicleCreated failed:', error);
    }
}

export async function notifyVehicleUpdated(vehicle) {
    try {
        const vehicleId = vehicle.vehicleId;
        const message = `Vehicle ${vehicleId} updated`;

        await createNotification({
            title: 'Vehicle Updated',
            message,
            type: 'vehicle_updated',
            targetRoles: ['superadmin', 'admin', 'supervisor'],
            targetUserIds: []
        });
        console.log(`🔔 Notification sent: Vehicle Updated → ${vehicleId}`);
    } catch (error) {
        console.error('notifyVehicleUpdated failed:', error);
    }
}

export async function notifyUserCreated(user) {
    try {
        const message = `User ${user.name} created as ${user.role}`;

        await createNotification({
            title: 'User Created',
            message,
            type: 'user_created',
            targetRoles: ['superadmin', 'admin'],
            targetUserIds: []
        });
        console.log(`🔔 Notification sent: User Created → ${user.name}`);
    } catch (error) {
        console.error('notifyUserCreated failed:', error);
    }
}

export async function notifyUserDeactivated(user) {
    try {
        const message = `User ${user.name} deactivated`;

        await createNotification({
            title: 'User Deactivated',
            message,
            type: 'user_deactivated',
            targetRoles: ['superadmin', 'admin'],
            targetUserIds: []
        });
        console.log(`🔔 Notification sent: User Deactivated → ${user.name}`);
    } catch (error) {
        console.error('notifyUserDeactivated failed:', error);
    }
}

export async function notifyFuelLogCreated(fuelLog) {
    try {
        const { fuelId, vehicleId, fuelAmount, fuelType, fuelCost } = fuelLog;
        await createNotification({
            title: 'Fuel Log Recorded',
            message: `Vehicle ${vehicleId} refueled successfully\nFuel Log: ${fuelId}\nFuel Added: ${fuelAmount}L ${fuelType}\nCost: රු. ${fuelCost}`,
            type: 'fuel_log_created',
            targetRoles: ['superadmin', 'admin', 'supervisor'],
            targetUserIds: []
        });
    } catch (error) {
        console.error('notifyFuelLogCreated failed:', error);
    }
}

export async function notifyFuelLogUpdated(fuelLog) {
    try {
        const { fuelId, vehicleId } = fuelLog;
        await createNotification({
            title: 'Fuel Log Updated',
            message: `Fuel record ${fuelId} has been updated\nVehicle: ${vehicleId}`,
            type: 'fuel_log_updated',
            targetRoles: ['superadmin', 'admin', 'supervisor'],
            targetUserIds: []
        });
    } catch (error) {
        console.error('notifyFuelLogUpdated failed:', error);
    }
}

/**
 * NEW – Conflict Detection Notifications (UPDATED: includes conflictId)
 */
export async function notifyConflictDetected(conflict) {
    try {
        const message = `${conflict.type || 'Conflict'} detected: ${conflict.affectedResource || 'resource'} ${conflict.description ? '- ' + conflict.description : ''}`.trim();
        await createNotification({
            title: 'Conflict Detected',
            message,
            type: 'conflict_detected',
            targetRoles: ['superadmin', 'admin', 'supervisor'],
            targetUserIds: [],
            conflictId: conflict.id   // <-- Firestore document ID for deep linking
        });
        console.log(`🔔 Notification sent: Conflict Detected → ${conflict.id}`);
    } catch (error) {
        console.error('notifyConflictDetected failed:', error);
    }
}