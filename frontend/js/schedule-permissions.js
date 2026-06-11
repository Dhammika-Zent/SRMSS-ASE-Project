// ============================================================
// ROUTEX TRANSIT — SCHEDULE ACTIONS & PERMISSIONS (UPDATED)
// ============================================================

import { hasPermission } from './permissions.js';

export const canAddSchedule = (role) => hasPermission(role, 'add');
export const canEditSchedule = (role) => hasPermission(role, 'edit');
export const canDeleteSchedule = (role) => hasPermission(role, 'delete');
export const canViewMap = (role) => hasPermission(role, 'viewMap');
export const canMarkRoute = (role) => hasPermission(role, 'markRoute');
export const canStartTrip = (role) => hasPermission(role, 'startTrip');
export const canCompleteTrip = (role) => hasPermission(role, 'completeTrip');

export function getScheduleActions(schedule, user, driverId = null) {
    const actions = [];

    if (canEditSchedule(user.role)) {
        actions.push({
            id: 'edit', label: 'Edit',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
            handler: 'edit'
        });
    }
    if (canDeleteSchedule(user.role)) {
        actions.push({
            id: 'delete', label: 'Delete',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
            handler: 'delete'
        });
    }
    if (canViewMap(user.role)) {
        actions.push({
            id: 'view-map', label: 'View Map',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
            handler: 'view-map'
        });
    }
    if (user.role === 'driver' && driverId && schedule.driverId === driverId) {
        if (schedule.status === 'Scheduled' && canStartTrip(user.role)) {
            actions.push({
                id: 'start-trip', label: 'Start Trip',
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
                handler: 'start-trip'
            });
        }
        if (schedule.status === 'In Progress' && canCompleteTrip(user.role)) {
            actions.push({
                id: 'complete-trip', label: 'Complete Trip',
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
                handler: 'complete-trip'
            });
        }
    }

    return actions;
}