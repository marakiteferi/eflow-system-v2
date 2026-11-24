const express = require('express');
const router = express.Router();
const { parseFlow, validateFlow } = require('../services/workflowGraph');
const authenticateToken = require('../middleware/authMiddleware');
const { requireWorkflowManager } = require('../middleware/permissions');

const pool = require('../db');

// Published workflows must pass validation; drafts can be saved in any state.
const publishProblems = (flow_structure) => {
    const flow = parseFlow(flow_structure);
    if (flow.metadata?.isPublished === false) return [];
    return validateFlow(flow);
};

// POST: Save a new workflow
router.post('/', authenticateToken, requireWorkflowManager, async (req, res) => {
    const { name, flow_structure } = req.body;
    if (!name) return res.status(400).json({ message: 'Workflow name is required' });

    const problems = publishProblems(flow_structure);
    if (problems.length > 0) {
        return res.status(400).json({ message: `Cannot publish workflow: ${problems[0]}`, problems });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const result = await client.query('INSERT INTO workflows (name, flow_structure) VALUES ($1, $2) RETURNING *', [name, flow_structure]);
        await client.query("INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)", [req.user.id, `Created new workflow: '${name}'`]);
        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Error saving workflow' });
    } finally {
        if (client) client.release();
    }
});

// GET: Fetch all available workflows
router.get('/', authenticateToken, async (req, res) => {
    try {
        // We now fetch the flow_structure too, so the frontend can load it for editing
        const result = await pool.query('SELECT * FROM workflows ORDER BY id DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching workflows' });
    }
});

// GET: Fetch a single workflow by ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM workflows WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Workflow not found' });
        }
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching workflow' });
    }
});

// PUT: Update an existing workflow
router.put('/:id', authenticateToken, requireWorkflowManager, async (req, res) => {
    const { name, flow_structure } = req.body;
    const workflowId = req.params.id;

    if (!name) return res.status(400).json({ message: 'Workflow name is required' });

    const problems = publishProblems(flow_structure);
    if (problems.length > 0) {
        return res.status(400).json({ message: `Cannot publish workflow: ${problems[0]}`, problems });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query('UPDATE workflows SET name = $1, flow_structure = $2 WHERE id = $3', [name, flow_structure, workflowId]);
        await client.query("INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)", [req.user.id, `Updated workflow: '${name}'`]);
        await client.query('COMMIT');
        res.status(200).json({ message: 'Workflow updated successfully' });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Error updating workflow' });
    } finally {
        if (client) client.release();
    }
});

// DELETE: Remove a workflow (with safety check)
router.delete('/:id', authenticateToken, requireWorkflowManager, async (req, res) => {
    const workflowId = req.params.id;

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Safety Check: Are any documents currently using this workflow?
        const activeDocs = await client.query('SELECT id FROM documents WHERE workflow_id = $1 LIMIT 1', [workflowId]);
        if (activeDocs.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Cannot delete: Active documents are currently using this workflow.' });
        }

        const wfQuery = await client.query('SELECT name FROM workflows WHERE id = $1', [workflowId]);
        const wfName = wfQuery.rows[0]?.name || 'Unknown';

        await client.query('DELETE FROM workflows WHERE id = $1', [workflowId]);
        await client.query("INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)", [req.user.id, `Deleted workflow: '${wfName}'`]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'Workflow deleted successfully' });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Error deleting workflow' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;