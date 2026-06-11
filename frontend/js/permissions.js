/* ============================================================
   ROUTEX TRANSIT — CENTRALISED PERMISSIONS
   ============================================================ */

const PERMISSION_MATRIX = {
    superadmin: {
        view: true,
        add: true,
        edit: true,
        delete: true,
        viewMap: true,
        markRoute: true,
        startTrip: true,
        completeTrip: true
    },

    admin: {
        view: true,
        add: true,
        edit: true,
        delete: true,
        viewMap: true,
        markRoute: true
    },

    supervisor: {
        view: true,
        add: true,
        edit: true,
        delete: false,
        viewMap: true,
        markRoute: true
    },

    staff: {
        view: true,
        add: false,
        edit: false,
        delete: false,
        viewMap: true,
        markRoute: false
    },

    driver: {
        view: true,
        add: false,
        edit: false,
        delete: false,
        viewMap: true,
        startTrip: true,
        completeTrip: true
    }
};

export function hasPermission(role, action) {
    return !!(
        PERMISSION_MATRIX[role] &&
        PERMISSION_MATRIX[role][action]
    );
}

