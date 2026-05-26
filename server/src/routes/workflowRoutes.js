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

// Helper for circular path validation
const hasCycle = (flow_structure) => {
    let flowData;
    try {
        flowData = typeof flow_structure === 'string' ? JSON.parse(flow_structure) : flow_structure;
    } catch(e) { return false; }
    
    // Only validate if published
    if (flowData.metadata && flowData.metadata.isPublished === false) {
        return false; 
    }

    const nodes = flowData.nodes || [];
    const edges = flowData.edges || [];

    const adj = {};
    nodes.forEach(n => { adj[n.id] = []; });
    edges.forEach(e => {
        if (adj[e.source]) adj[e.source].push(e.target);
    });

    const visited = {};
    const recStack = {};

    const dfs = (nodeId) => {
        if (!visited[nodeId]) {
            visited[nodeId] = true;
            recStack[nodeId] = true;

            const neighbors = adj[nodeId] || [];
            for (let i = 0; i < neighbors.length; i++) {
                const nextNode = neighbors[i];
                if (!visited[nextNode] && dfs(nextNode)) return true;
                else if (recStack[nextNode]) return true;
            }
        }
        recStack[nodeId] = false;
        return false;
    };

    for (let i = 0; i < nodes.length; i++) {
        if (!visited[nodes[i].id]) {
            if (dfs(nodes[i].id)) return true;
        }
    }
    return false;
};


// POST: Save a new workflow
router.post('/', authenticateToken, async (req, res) => {
    const { name, flow_structure } = req.body;
    if (!name) return res.status(400).json({ message: 'Workflow name is required' });

    if (hasCycle(flow_structure)) {
        return res.status(400).json({ message: 'Cannot publish workflow: Contains circular paths (deadlocks / infinite loops).' });
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

// PUT: Update an existing workflow
router.put('/:id', authenticateToken, async (req, res) => {
    const { name, flow_structure } = req.body;
    const workflowId = req.params.id;

    if (!name) return res.status(400).json({ message: 'Workflow name is required' });

    if (hasCycle(flow_structure)) {
        return res.status(400).json({ message: 'Cannot publish workflow: Contains circular paths (deadlocks / infinite loops).' });
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
router.delete('/:id', authenticateToken, async (req, res) => {
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