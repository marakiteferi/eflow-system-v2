const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// POST /api/workflows
router.post('/', async (req, res) => {
    try {
        const { name, flow_structure } = req.body;

        if (!name || !flow_structure) {
            return res.status(400).json({ message: 'Workflow name and structure are required' });
        }

        // Insert the JSON object directly into the JSONB column
        const newWorkflow = await pool.query(
            'INSERT INTO workflows (name, flow_structure) VALUES ($1, $2) RETURNING *',
            [name, flow_structure]
        );

        res.status(201).json({ 
            message: 'Workflow saved successfully', 
            workflow: newWorkflow.rows[0] 
        });
    } catch (err) {
        console.error('Error saving workflow:', err.message);
        res.status(500).json({ message: 'Server error saving workflow' });
    }
});

module.exports = router;