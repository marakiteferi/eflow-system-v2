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

// POST: Save a new workflow AND write to the Audit Log
router.post('/', authenticateToken, async (req, res) => {
    const { name, flow_structure } = req.body;
    
    if (!name) {
        return res.status(400).json({ message: 'Workflow name is required' });
    }

    try {
        await pool.query('BEGIN'); // Start secure transaction

        // 1. Save the actual workflow
        const result = await pool.query(
            'INSERT INTO workflows (name, flow_structure) VALUES ($1, $2) RETURNING *',
            [name, flow_structure]
        );
        
        // 2. Write to the Audit Log!
        await pool.query(
            "INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)",
            [req.user.id, `Created new workflow: '${name}'`]
        );

        await pool.query('COMMIT'); // Save transaction
        res.status(201).json(result.rows[0]);
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Error saving workflow:', err);
        res.status(500).json({ message: 'Error saving workflow' });
    }
});

// GET: Fetch all available workflows for the upload dropdown (CRASH-PROOF)
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Sorting by 'id' instead of 'created_at' ensures it won't crash if your table schema differs slightly
        const result = await pool.query('SELECT id, name FROM workflows ORDER BY id DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching workflows:', err);
        res.status(500).json({ message: 'Error fetching workflows' });
    }
});

module.exports = router;