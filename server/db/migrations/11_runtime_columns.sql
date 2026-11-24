-- Columns that were previously added by one-off scripts (apply_fixes.js, migrate-rbac.js,
-- fix_eflow_demo.js) and are required by the application code.

ALTER TABLE users     ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sla_reminder_sent   BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sla_warning_sent    BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS current_role_id       INTEGER REFERENCES dynamic_roles(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS current_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS allowed_submitters  INTEGER[] DEFAULT '{}'::INTEGER[];

-- Role IDs 1 (Student), 2 (Staff) and 3 (Super Admin) are built-in system roles.
-- Custom roles created by admins start at 100 so they never collide with them.
SELECT setval('dynamic_roles_id_seq', GREATEST(100, (SELECT COALESCE(MAX(id), 0) + 1 FROM dynamic_roles)), false);
