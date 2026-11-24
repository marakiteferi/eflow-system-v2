/**
 * Who may do what, on the client. The server checks every request again; this only
 * decides which pages and buttons to show.
 */
export const ACCOUNT_TYPES = { 1: 'Student', 2: 'Staff', 3: 'Administrator' };

export const PERMISSIONS = {
  design_workflows: { label: 'Design workflows', description: 'Create, edit and publish workflows in the builder.' },
  manage_offices: { label: 'Manage offices', description: "Create offices, appoint heads and manage every office's officers and positions." },
  manage_people: { label: 'Manage people', description: 'Add, import, edit and deactivate accounts, and manage departments.' },
  view_audit_log: { label: 'View audit log', description: 'See and export the full audit trail.' },
};

export const isAdministrator = (user) => user?.role_id === 3;

export const can = (user, permission) => isAdministrator(user) || (user?.permissions || []).includes(permission);

export const hasAnyAdminPower = (user) => Object.keys(PERMISSIONS).some((p) => can(user, p));

export const accountType = (user) => user?.account_type || ACCOUNT_TYPES[user?.role_id] || 'Staff';
