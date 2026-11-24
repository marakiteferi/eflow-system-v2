/**
 * Administration: departments, account types, the admin verification code,
 * the audit log and system statistics. People are managed in peopleRoutes.js.
 */
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authMiddleware');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_PORT == 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { ciphers: 'SSLv3' }
});

const pool = require('../db');
const codes = require('../services/oneTimeCodes');
const { codeRequestLimiter } = require('../middleware/rateLimits');
const { ACCOUNT_TYPES, PERMISSIONS, requirePermission } = require('../services/access');


// Anyone holding at least one administrative permission
const anyAdminPower = requirePermission(...Object.keys(PERMISSIONS));

// Staff who build or run things need the reference lists (departments, account types, people)
const staffOnly = (req, res, next) => (req.user.role_id === 1
    ? res.status(403).json({ message: 'Not available.' })
    : next());

// ==========================================
// DEPARTMENTS (students' academic departments)
// ==========================================
router.get('/departments', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d.*, (SELECT COUNT(*)::int FROM users u WHERE u.department_id = d.id) AS people
             FROM departments d ORDER BY name ASC`);
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching departments' });
    }
});

router.post('/departments', authenticateToken, requirePermission('manage_people'), async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'A department needs a name.' });
    try {
        const result = await pool.query('INSERT INTO departments (name) VALUES ($1) RETURNING *', [name]);
        await pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)', [req.user.id, `Created department: ${name}`]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: `A department called "${name}" already exists.` });
        res.status(500).json({ message: 'Error creating department.' });
    }
});

router.delete('/departments/:id', authenticateToken, requirePermission('manage_people'), async (req, res) => {
    try {
        const used = (await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE department_id = $1', [req.params.id])).rows[0].n;
        if (used) return res.status(409).json({ message: `${used} ${used === 1 ? 'person is' : 'people are'} still in this department. Move them first.` });
        const r = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING name', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ message: 'Department not found.' });
        await pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)', [req.user.id, `Removed department: ${r.rows[0].name}`]);
        res.json({ message: `Department "${r.rows[0].name}" removed.` });
    } catch (err) {
        res.status(500).json({ message: 'Error removing department.' });
    }
});

// ==========================================
// ACCOUNT TYPES
// ==========================================
// The fixed account types, used by role-based steps and service restrictions
router.get('/roles', authenticateToken, staffOnly, (req, res) => {
    res.json(Object.entries(ACCOUNT_TYPES).map(([id, name]) => ({ id: Number(id), name })));
});

// ==========================================
// ADMIN OTP API
// ==========================================

router.post('/request-otp', authenticateToken, codeRequestLimiter, anyAdminPower, async (req, res) => {
    try {
        const issued = await codes.issueCode(req.user.id, 'admin', { cooldownMs: 2 * 60 * 1000 });
        if (issued.tooSoon) {
            return res.status(429).json({ message: 'Please wait 2 minutes before requesting a new code.' });
        }
        const otp = issued.code;

        const userQuery = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
        const { email, name } = userQuery.rows[0];

        if (process.env.NODE_ENV !== 'production') console.log(`\n🔑 DEV MODE - ADMIN OTP GENERATED: ${otp}\n`);

        try {
            await transporter.sendMail({
                from: `"E-flow System" <${process.env.FROM_EMAIL}>`,
                to: email,
                subject: 'Your E-flow Admin Verification Code',
                html: `<p>Hello ${name},</p>
                       <p>Your one-time verification code for an administrative action is: <b style="font-size:24px">${otp}</b></p>
                       <p>This code expires in 5 minutes.</p>`
            });
            res.status(200).json({ message: 'OTP sent to your email' });
        } catch (emailErr) {
            console.error('Email failed:', emailErr.message);
            if (process.env.NODE_ENV !== 'production') {
                return res.status(200).json({ message: 'Email failed (dev mode) — OTP: ' + otp });
            }
            throw emailErr;
        }
    } catch (err) {
        console.error('OTP error:', err);
        res.status(500).json({ message: 'Error generating OTP' });
    }
});

// ==========================================
// PEOPLE LISTS FOR THE WORKFLOW BUILDER
// ==========================================
router.get('/users', authenticateToken, staffOnly, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.email, u.role_id, u.department_id, d.name as department_name
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            WHERE COALESCE(u.is_active, TRUE)
            ORDER BY u.name ASC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// Preview: which users match a given role + optional department?
// Used by WorkflowBuilder to show a live "matching users" preview
router.get('/users/by-role', authenticateToken, staffOnly, async (req, res) => {
    const { roleId, departmentId } = req.query;
    if (!roleId) return res.status(400).json({ message: 'roleId is required' });
    try {
        let query = `
            SELECT u.id, u.name, u.email, d.name as department_name
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            WHERE u.role_id = $1 AND COALESCE(u.is_active, TRUE)
        `;
        const params = [parseInt(roleId, 10)];
        if (departmentId) {
            query += ' AND u.department_id = $2';
            params.push(parseInt(departmentId, 10));
        }
        query += ' ORDER BY u.name ASC';
        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('by-role error:', err);
        res.status(500).json({ message: 'Error fetching users by role' });
    }
});

// ==========================================
// AUDIT LOG AND STATISTICS
// ==========================================
router.get('/audit-logs', authenticateToken, requirePermission('view_audit_log'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.id, a.action, a.timestamp, a.role_id,
                   u.name as user_name,
                   d.title as document_title,
                   CASE a.role_id WHEN 1 THEN 'Student' WHEN 2 THEN 'Staff' WHEN 3 THEN 'Administrator' END as role_name
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN documents d ON a.document_id = d.id
            ORDER BY a.timestamp DESC LIMIT 100
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching audit logs' });
    }
});

router.get('/audit-logs/export', authenticateToken, requirePermission('view_audit_log'), async (req, res) => {
    const { startDate, endDate, search } = req.query;
    try {
        let query = `
            SELECT a.id, a.action, a.timestamp, a.role_id,
                   u.name as user_name,
                   d.title as document_title,
                   CASE a.role_id WHEN 1 THEN 'Student' WHEN 2 THEN 'Staff' WHEN 3 THEN 'Administrator' END as role_name
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN documents d ON a.document_id = d.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (startDate) {
            query += ` AND a.timestamp >= $${paramIndex++}`;
            params.push(startDate);
        }
        if (endDate) {
            // Include the entire end date by appending time if not provided
            const end = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;
            query += ` AND a.timestamp <= $${paramIndex++}`;
            params.push(end);
        }
        if (search) {
            query += ` AND (
                a.action ILIKE $${paramIndex} OR 
                u.name ILIKE $${paramIndex} OR 
                d.title ILIKE $${paramIndex}
            )`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        query += ` ORDER BY a.timestamp DESC`;

        const result = await pool.query(query, params);

        let csvContent = "Timestamp,Action,Document,User\n";
        result.rows.forEach(log => {
            const d = new Date(log.timestamp);
            const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

            const action = log.action ? log.action.replace(/"/g, '""') : '';
            const doc = log.document_title ? log.document_title.replace(/"/g, '""') : 'System';
            const user = log.user_name ? log.user_name.replace(/"/g, '""') : 'System';
            csvContent += `"${date}","${action}","${doc}","${user}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=Eflow_Audit_Logs_Export.csv');
        res.status(200).send(csvContent);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ message: 'Error exporting audit logs' });
    }
});

router.get('/stats', authenticateToken, anyAdminPower, async (req, res) => {
    try {
        const totalDocs = await pool.query('SELECT COUNT(*) FROM documents');
        const approvedDocs = await pool.query("SELECT COUNT(*) FROM documents WHERE status = 'Approved'");
        const pendingDocs = await pool.query("SELECT COUNT(*) FROM documents WHERE status = 'Pending'");
        const rejectedDocs = await pool.query("SELECT COUNT(*) FROM documents WHERE status = 'Rejected'");
        const totalUsers = await pool.query('SELECT COUNT(*) FROM users WHERE COALESCE(is_active, TRUE)');
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