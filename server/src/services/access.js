/**
 * Who may do what.
 *
 * Every account has a fixed type: Student, Staff or Administrator. Administrators can do
 * everything. Staff can be given individual permissions on top, so not every admin power
 * has to go to everyone who needs one of them.
 */
const pool = require('../db');

const ACCOUNT_TYPES = { 1: 'Student', 2: 'Staff', 3: 'Administrator' };
const STUDENT = 1;
const STAFF = 2;
const ADMINISTRATOR = 3;

const PERMISSIONS = {
    design_workflows: { label: 'Design workflows', description: 'Create, edit and publish workflows in the builder.' },
    manage_offices: { label: 'Manage offices', description: 'Create offices, appoint heads and manage every office\'s officers and positions.' },
    manage_people: { label: 'Manage people', description: 'Add, import, edit and deactivate accounts, and manage departments.' },
    view_audit_log: { label: 'View audit log', description: 'See and export the full audit trail.' },
};

/** Current account type, active flag and permissions, read fresh from the database. */
const loadAccess = async (userId, db = pool) => {
    const u = (await db.query('SELECT id, role_id, COALESCE(is_active, TRUE) AS is_active FROM users WHERE id = $1', [userId])).rows[0];
    if (!u) return null;
    const permissions = u.role_id === ADMINISTRATOR
        ? Object.keys(PERMISSIONS)
        : (await db.query('SELECT permission FROM user_permissions WHERE user_id = $1', [userId])).rows.map((r) => r.permission);
    return { id: u.id, role_id: u.role_id, is_active: u.is_active, permissions };
};

const hasPermission = async (user, permission) => {
    const access = await loadAccess(user.id);
    return Boolean(access && access.is_active && access.permissions.includes(permission));
};

/** Express middleware: the signed-in user needs at least one of the given permissions. */
const requirePermission = (...wanted) => async (req, res, next) => {
    try {
        const access = await loadAccess(req.user.id);
        if (access && access.is_active && wanted.some((p) => access.permissions.includes(p))) {
            req.access = access;
            return next();
        }
        const label = wanted.map((p) => PERMISSIONS[p]?.label || p).join(' or ');
        return res.status(403).json({ message: `You need the "${label}" permission to do this.` });
    } catch (err) {
        console.error('Permission check failed:', err);
        return res.status(500).json({ message: 'Server error verifying permissions.' });
    }
};

module.exports = { ACCOUNT_TYPES, PERMISSIONS, STUDENT, STAFF, ADMINISTRATOR, loadAccess, hasPermission, requirePermission };
