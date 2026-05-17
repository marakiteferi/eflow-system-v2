const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const authenticateToken = require('../middleware/authMiddleware');
const { detectCircularSupervisor } = require('../utils/graphHelpers');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const fs = require('fs');
const csv = require('csv-parser');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_PORT == 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { ciphers: 'SSLv3' }
});

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
// BULK USER IMPORT API
// ==========================================

router.post('/users/import-preview', authenticateToken, verifyAdmin, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'CSV file is required.' });

    const results = [];
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            try {
                // Delete the file after parsing
                fs.unlinkSync(req.file.path);
                
                const report = [];
                for (let i = 0; i < results.length; i++) {
                    const row = results[i];
                    // Handle potential BOM or whitespace in headers
                    const getVal = (key) => {
                        const matchedKey = Object.keys(row).find(k => k.trim().toLowerCase() === key.toLowerCase());
                        return matchedKey ? row[matchedKey].trim() : '';
                    };

                    const Name = getVal('name');
                    const Email = getVal('email');
                    const Role = getVal('role');
                    const Department = getVal('department');
                    
                    let error = null;
                    let roleId = null;
                    let departmentId = null;

                    if (!Name || !Email || !Role) {
                        error = 'Name, Email, and Role are required fields.';
                    } else {
                        // 1. Check if email exists
                        const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1', [Email]);
                        if (emailCheck.rows.length > 0) {
                            error = 'Email already exists in the system.';
                        } else {
                            // 2. Check if role exists
                            if (Role.toLowerCase() === 'super admin') {
                                roleId = 3;
                            } else {
                                const roleCheck = await pool.query('SELECT id FROM dynamic_roles WHERE name ILIKE $1', [Role]);
                                if (roleCheck.rows.length === 0) {
                                    error = `Role "${Role}" not found.`;
                                } else {
                                    roleId = roleCheck.rows[0].id;
                                }
                            }

                            // 3. Check department if provided
                            if (!error && Department) {
                                const deptCheck = await pool.query('SELECT id FROM departments WHERE name ILIKE $1', [Department]);
                                if (deptCheck.rows.length === 0) {
                                    error = `Department "${Department}" not found.`;
                                } else {
                                    departmentId = deptCheck.rows[0].id;
                                }
                            }
                        }
                    }

                    report.push({
                        rowNumber: i + 1,
                        name: Name,
                        email: Email,
                        role: Role,
                        role_id: roleId,
                        department: Department,
                        department_id: departmentId,
                        isValid: !error,
                        error: error
                    });
                }
                
                res.status(200).json(report);
            } catch (err) {
                console.error('Import preview error:', err);
                res.status(500).json({ message: 'Error processing CSV file.' });
            }
        });
});

router.post('/users/import-commit', authenticateToken, verifyAdmin, async (req, res) => {
    const { validUsers } = req.body;
    if (!validUsers || !Array.isArray(validUsers) || validUsers.length === 0) {
        return res.status(400).json({ message: 'No valid users provided to import.' });
    }

    const imported = [];
    const failed = [];

    for (const user of validUsers) {
        if (!user.isValid || !user.email) continue;
        
        try {
            await pool.query('BEGIN');
            
            // Generate a high-entropy dummy password
            const dummyPassword = crypto.randomBytes(32).toString('hex');
            const hashedPassword = await bcrypt.hash(dummyPassword, 10);
            
            const insertRes = await pool.query(
                'INSERT INTO users (name, email, password_hash, role_id, department_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [user.name, user.email, hashedPassword, user.role_id, user.department_id || null]
            );
            const newUserId = insertRes.rows[0].id;

            // Generate password reset token (Magic Link)
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

            await pool.query(
                'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
                [newUserId, token, expiresAt]
            );

            // Audit log
            await pool.query(
                "INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)",
                [req.user.id, `Imported user via CSV: ${user.email}`]
            );

            await pool.query('COMMIT');

            // Send Magic Link Email
            const resetLink = `http://localhost:3000/reset-password?token=${token}`;
            try {
                await transporter.sendMail({
                    from: `"E-flow Admin" <${process.env.FROM_EMAIL}>`,
                    to: user.email,
                    subject: 'Welcome to E-flow - Account Setup Required',
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px; max-width: 500px;">
                            <h2 style="color: #4f46e5;">Welcome to E-flow!</h2>
                            <p>Hello ${user.name},</p>
                            <p>An administrator has created an account for you in the E-flow document management system.</p>
                            <p>To activate your account, you must set a secure password. Please click the button below to complete your setup. This link will expire in <strong>24 hours</strong>.</p>
                            <a href="${resetLink}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;font-weight:bold;text-decoration:none;">Set My Password</a>
                            <p style="color:#6b7280;font-size:13px;margin-top:20px;">If you believe this was a mistake, please contact your administrator.</p>
                        </div>
                    `
                });
            } catch (emailErr) {
                console.error(`Failed to send magic link to ${user.email}:`, emailErr);
            }

            imported.push(user.email);
        } catch (err) {
            await pool.query('ROLLBACK');
            console.error(`Failed to import user ${user.email}:`, err);
            failed.push(user.email);
        }
    }

    res.status(200).json({ 
        message: `Successfully imported ${imported.length} users.`,
        imported,
        failed
    });
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