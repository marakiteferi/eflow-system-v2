-- Account types are fixed: 1 = Student, 2 = Staff, 3 = Administrator.
-- Extra powers are granted per person as named permissions, instead of custom user types.
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission  VARCHAR(40) NOT NULL,
    granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, permission)
);

-- Move people on the old custom roles to Staff, keeping what their role allowed
INSERT INTO user_permissions (user_id, permission)
SELECT u.id, 'design_workflows' FROM users u JOIN dynamic_roles r ON r.id = u.role_id
WHERE u.role_id > 3 AND r.can_create_workflows
ON CONFLICT DO NOTHING;
INSERT INTO user_permissions (user_id, permission)
SELECT u.id, p.permission FROM users u JOIN dynamic_roles r ON r.id = u.role_id
CROSS JOIN (VALUES ('manage_people'), ('manage_offices'), ('view_audit_log')) AS p(permission)
WHERE u.role_id > 3 AND r.can_manage_users
ON CONFLICT DO NOTHING;
UPDATE users SET role_id = 2 WHERE role_id > 3;

-- Positions inside an office (Deputy, Records Officer, Cashier...), set up by the head
CREATE TABLE IF NOT EXISTS office_positions (
    id             SERIAL PRIMARY KEY,
    office_id      INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    name           VARCHAR(100) NOT NULL,
    -- Late work escalates to whoever holds this position; empty means the head of the office
    reports_to_id  INTEGER REFERENCES office_positions(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (office_id, name)
);

ALTER TABLE office_members ADD COLUMN IF NOT EXISTS position_id INTEGER REFERENCES office_positions(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS current_position_id INTEGER REFERENCES office_positions(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
