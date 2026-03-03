const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const authenticateToken = require('../middleware/authMiddleware');

const pool = new Pool({
    user: process.env.DB_USER, 
    host: process.env.DB_HOST,
    database: process.env.DB_NAME, 
    password: process.env.DB_PASSWORD, 
    port: process.env.DB_PORT,
});

// Extra Security Middleware: Ensure the user is an Admin
const verifyAdmin = (req, res, next) => {
    if (req.user.role_id !== 3) {
        return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }
    next();
};

// GET: Fetch all Audit Logs
router.get('/audit-logs', authenticateToken, verifyAdmin, async (req, res) => {
    try {
        const query = `
            SELECT a.id, a.action, a.timestamp, d.title as document_title, u.name as user_name
            FROM audit_logs a
            LEFT JOIN documents d ON a.document_id = d.id
            LEFT JOIN users u ON a.user_id = u.id
            ORDER BY a.timestamp DESC
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching audit logs' });
    }
});

// GET: Fetch all Users
router.get('/users', authenticateToken, verifyAdmin, async (req, res) => {
    try {
        const query = `
            SELECT u.id, u.name, u.email, r.name as role_name 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            ORDER BY u.id ASC
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// PUT: Update a user's role
router.put('/users/:id/role', authenticateToken, verifyAdmin, async (req, res) => {
    const { id } = req.params; // The ID of the user being changed
    const { role_id } = req.body; // The new role (1=Student, 2=Staff, 3=Admin)

    try {
        await pool.query('BEGIN');

        // 1. Update the user's role
        await pool.query('UPDATE users SET role_id = $1 WHERE id = $2', [role_id, id]);

        // 2. Fetch the updated role name and user name for the audit log
        const userQuery = await pool.query('SELECT name FROM users WHERE id = $1', [id]);
        const roleQuery = await pool.query('SELECT name FROM roles WHERE id = $1', [role_id]);
        const targetUserName = userQuery.rows[0].name;
        const newRoleName = roleQuery.rows[0].name;

        // 3. Write to the Audit Log
        await pool.query(
            "INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)",
            [req.user.id, `Changed role of user '${targetUserName}' to '${newRoleName}'`]
        );

        await pool.query('COMMIT');
        res.status(200).json({ message: 'User role updated successfully' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Error updating user role' });
    }
});
module.exports = router;