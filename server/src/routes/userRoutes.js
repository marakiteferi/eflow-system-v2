const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authMiddleware');

const pool = require('../db');

// GET: Current OOO settings
router.get('/ooo', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT is_out_of_office, delegate_id FROM users WHERE id = $1', [req.user.id]);
        res.status(200).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching OOO status' });
    }
});

// POST: Update OOO settings
router.post('/ooo', authenticateToken, async (req, res) => {
    const { is_out_of_office, delegate_id } = req.body;
    try {
        await pool.query(
            'UPDATE users SET is_out_of_office = $1, delegate_id = $2 WHERE id = $3',
            [is_out_of_office, delegate_id || null, req.user.id]
        );
        await pool.query("INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)", [req.user.id, `Set Out of Office to ${is_out_of_office}`]);
        res.status(200).json({ message: 'OOO updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error updating OOO status' });
    }
});

// GET: List of possible delegates (Any Staff/Admin except the current user)
router.get('/delegates', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, email FROM users WHERE role_id <> 1 AND COALESCE(is_active, TRUE) AND id != $1',
            [req.user.id]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching delegates' });
    }
});

module.exports = router;