const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const authenticateToken = require('../middleware/authMiddleware');
const { detectCircularSupervisor } = require('../utils/graphHelpers');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

// ==========================================
// MIDDLEWARE
// ==========================================

// Pitfall 2 FIX: Now explicitly checks is_active = TRUE on dynamic roles
const verifyAdmin = async (req, res, next) => {
    try {
        if (req.user.role_id === 3) return next();
        // is_active = TRUE check prevents sealed roles from granting access
        const roleQuery = await pool.query(
            'SELECT can_manage_users FROM dynamic_roles WHERE id = $1 AND is_active = TRUE',
            [req.user.role_id]
        );
        if (roleQuery.rows.length > 0 && roleQuery.rows[0].can_manage_users) {
            return next();
        }
        return res.status(403).json({ message: 'Access Denied: You do not have permission to manage users or roles.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error verifying permissions.' });
    }
};

// ==========================================
// DEPARTMENTS API
// ==========================================
router.get('/departments', authenticateToken, verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM departments ORDER BY name ASC');
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching departments' });
    }
});

router.post('/departments', authenticateToken, verifyAdmin, async (req, res) => {
    const { name } = req.body;
    try {
        const result = await pool.query('INSERT INTO departments (name) VALUES ($1) RETURNING *', [name]);
        await pool.query(
            'INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)',
            [req.user.id, `Created department: ${name}`]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Error creating department. Name might already exist.' });
    }
});

// ==========================================
// DYNAMIC ROLES API
// ==========================================
router.get('/roles', authenticateToken, verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.*, d.name as department_name 
            FROM dynamic_roles r 
            LEFT JOIN departments d ON r.department_id = d.id 
            ORDER BY r.id ASC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching roles' });
    }
});

router.post('/roles', authenticateToken, verifyAdmin, async (req, res) => {
    const { name, department_id, can_create_workflows, requires_workflow_approval, can_manage_users } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO dynamic_roles (name, department_id, can_create_workflows, requires_workflow_approval, can_manage_users) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, department_id || null, can_create_workflows || false, requires_workflow_approval || false, can_manage_users || false]
        );
        // Pitfall 6 FIX: Store role_id in audit log, not the name string
        await pool.query(
            'INSERT INTO audit_logs (user_id, role_id, action) VALUES ($1, $2, $3)',
            [req.user.id, result.rows[0].id, 'Role Created']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Error creating dynamic role' });
    }
});

// Pitfall 1 FIX: Role Impact Report — must be called before deletion
router.get('/roles/:id/impact', authenticateToken, verifyAdmin, async (req, res) => {
    const roleId = parseInt(req.params.id, 10);
    try {
        // 1. Users currently assigned this role
        const usersResult = await pool.query(
            'SELECT COUNT(*) as count FROM users WHERE role_id = $1', [roleId]
        );

        // 2. Active in-flight documents whose current assignee has this role
        const inFlightResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM documents d
            JOIN users u ON d.current_assignee_id = u.id
            WHERE d.status = 'Pending' AND u.role_id = $1
        `, [roleId]);

        // 3. Audit log entries that reference this role_id
        const auditResult = await pool.query(
            'SELECT COUNT(*) as count FROM audit_logs WHERE role_id = $1', [roleId]
        );

        // 4. Workflows where any node's assignee belongs to this role
        const workflowsResult = await pool.query(`
            SELECT w.id, w.name, w.flow_structure
            FROM workflows w
        `);
        let affectedWorkflows = [];
        for (const wf of workflowsResult.rows) {
            const flowData = typeof wf.flow_structure === 'string'
                ? JSON.parse(wf.flow_structure)
                : wf.flow_structure;
            if (!flowData) continue;
            const nodes = flowData.nodes || [];
            // Check if any node's assignee is a user with this role
            const assigneeIds = nodes
                .map(n => n.data?.assignee ? parseInt(n.data.assignee, 10) : null)
                .filter(Boolean);

            if (assigneeIds.length > 0) {
                const matching = await pool.query(
                    `SELECT COUNT(*) as count FROM users WHERE id = ANY($1::int[]) AND role_id = $2`,
                    [assigneeIds, roleId]
                );
                if (parseInt(matching.rows[0].count, 10) > 0) {
                    affectedWorkflows.push({ id: wf.id, name: wf.name });
                }
            }
        }

        res.status(200).json({
            role_id: roleId,
            users: parseInt(usersResult.rows[0].count, 10),
            in_flight_documents: parseInt(inFlightResult.rows[0].count, 10),
            audit_log_entries: parseInt(auditResult.rows[0].count, 10),
            affected_workflows: affectedWorkflows,
        });
    } catch (err) {
        console.error('Impact report error:', err);
        res.status(500).json({ message: 'Error generating role impact report' });
    }
});

// Pitfall 2 FIX: Role Sealing — replaces hard-delete with a defense-in-depth seal
router.delete('/roles/:id', authenticateToken, verifyAdmin, async (req, res) => {
    const roleId = parseInt(req.params.id, 10);
    try {
        // Pre-check: refuse if any documents are currently in-flight at this role
        const inFlightResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM documents d
            JOIN users u ON d.current_assignee_id = u.id
            WHERE d.status = 'Pending' AND u.role_id = $1
        `, [roleId]);

        const inFlightCount = parseInt(inFlightResult.rows[0].count, 10);
        if (inFlightCount > 0) {
            return res.status(400).json({
                message: `Cannot seal role: ${inFlightCount} document(s) are currently in-flight at this role's step. Reassign or complete them first.`,
                in_flight_documents: inFlightCount,
            });
        }

        await pool.query('BEGIN');
        // Seal: zero out all permissions + timestamp who sealed it
        await pool.query(`
            UPDATE dynamic_roles SET
                is_active = FALSE,
                sealed_at = NOW(),
                sealed_by = $1,
                can_create_workflows = FALSE,
                requires_workflow_approval = FALSE,
                can_manage_users = FALSE,
                is_escalation_fallback = FALSE
            WHERE id = $2
        `, [req.user.id, roleId]);

        // Pitfall 6 FIX: log the role_id, not the name string
        await pool.query(
            'INSERT INTO audit_logs (user_id, role_id, action) VALUES ($1, $2, $3)',
            [req.user.id, roleId, 'Role Sealed']
        );
        await pool.query('COMMIT');

        res.status(200).json({ message: 'Role successfully sealed. All permissions have been revoked.' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Role seal error:', err);
        res.status(500).json({ message: 'Error sealing role' });
    }
});

// Pitfall 5 FIX: Get the current designated fallback role
router.get('/roles/fallback', authenticateToken, verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name FROM dynamic_roles WHERE is_escalation_fallback = TRUE AND is_active = TRUE LIMIT 1'
        );
        res.status(200).json(result.rows[0] || null);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching fallback role' });
    }
});

// Pitfall 5 FIX: Designate a role as the escalation fallback
router.put('/roles/:id/fallback', authenticateToken, verifyAdmin, async (req, res) => {
    const roleId = parseInt(req.params.id, 10);
    try {
        await pool.query('BEGIN');
        // Clear any existing fallback designation (only one at a time)
        await pool.query('UPDATE dynamic_roles SET is_escalation_fallback = FALSE WHERE is_escalation_fallback = TRUE');
        await pool.query('UPDATE dynamic_roles SET is_escalation_fallback = TRUE WHERE id = $1', [roleId]);
        await pool.query(
            'INSERT INTO audit_logs (user_id, role_id, action) VALUES ($1, $2, $3)',
            [req.user.id, roleId, 'Role set as Escalation Fallback']
        );
        await pool.query('COMMIT');
        res.status(200).json({ message: 'Escalation fallback role updated successfully.' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Fallback role update error:', err);
        res.status(500).json({ message: 'Error updating fallback role' });
    }
});

// ==========================================
// USERS API
// ==========================================
router.get('/users', authenticateToken, verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.email, u.role_id, u.supervisor_id,
                   d.name as department_name, s.name as supervisor_name
            FROM users u 
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN users s ON u.supervisor_id = s.id
            ORDER BY u.created_at DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// Pitfall 4 FIX: Circular supervisor detection at save time
router.put('/users/:id/role', authenticateToken, verifyAdmin, async (req, res) => {
    const { role_id, department_id, supervisor_id } = req.body;
    const userId = parseInt(req.params.id, 10);

    // If a supervisor is being set, validate there's no cycle BEFORE writing
    if (supervisor_id) {
        const { isCycle, chain } = await detectCircularSupervisor(userId, parseInt(supervisor_id, 10), pool);
        if (isCycle) {
            return res.status(400).json({
                message: `Circular supervisor chain detected. Save blocked.`,
                chain: chain,
            });
        }
    }

    try {
        await pool.query(
            'UPDATE users SET role_id = $1, department_id = $2, supervisor_id = $3 WHERE id = $4',
            [role_id, department_id || null, supervisor_id || null, userId]
        );
        await pool.query(
            'INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)',
            [req.user.id, `Updated role/department/supervisor for user ID: ${userId}`]
        );
        res.status(200).json({ message: 'User updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error updating user' });
    }
});

// ==========================================
// LEGACY ROUTES (Stats, Audit Logs)
// ==========================================
router.get('/audit-logs', authenticateToken, verifyAdmin, async (req, res) => {
    try {
        // Pitfall 6 FIX: Join dynamic_roles to resolve role name live at query time
        const result = await pool.query(`
            SELECT a.id, a.action, a.timestamp, a.role_id,
                   u.name as user_name,
                   d.title as document_title,
                   r.name as role_name
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN documents d ON a.document_id = d.id
            LEFT JOIN dynamic_roles r ON a.role_id = r.id
            ORDER BY a.timestamp DESC LIMIT 100
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching audit logs' });
    }
});

router.get('/stats', authenticateToken, verifyAdmin, async (req, res) => {
    try {
        const totalDocs = await pool.query('SELECT COUNT(*) FROM documents');
        const approvedDocs = await pool.query("SELECT COUNT(*) FROM documents WHERE status = 'Approved'");
        const pendingDocs = await pool.query("SELECT COUNT(*) FROM documents WHERE status = 'Pending'");
        const rejectedDocs = await pool.query("SELECT COUNT(*) FROM documents WHERE status = 'Rejected'");
        const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
        const totalWorkflows = await pool.query('SELECT COUNT(*) FROM workflows');

        res.status(200).json({
            documents: {
                total: parseInt(totalDocs.rows[0].count), approved: parseInt(approvedDocs.rows[0].count),
                pending: parseInt(pendingDocs.rows[0].count), rejected: parseInt(rejectedDocs.rows[0].count)
            },
            users: parseInt(totalUsers.rows[0].count), workflows: parseInt(totalWorkflows.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ message: 'Error fetching stats' });
    }
});

module.exports = router;