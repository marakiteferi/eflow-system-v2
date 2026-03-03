const express = require('express');
const router = express.Router();
const multer = require('multer');
const { Pool } = require('pg');
const authenticateToken = require('../middleware/authMiddleware');
const Tesseract = require('tesseract.js');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

router.post('/upload', authenticateToken, upload.single('document'), async (req, res) => {
    try {
        const { title, workflow_id } = req.body;
        const submitter_id = req.user.id;

        if (!title || !req.file) return res.status(400).json({ message: 'Title and document are required.' });

        let initialNodeId = null;
        let initialAssigneeId = null; 

        if (workflow_id) {
            const wfQuery = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [workflow_id]);
            if (wfQuery.rows.length > 0) {
                const flowData = typeof wfQuery.rows[0].flow_structure === 'string' ? JSON.parse(wfQuery.rows[0].flow_structure) : wfQuery.rows[0].flow_structure;
                const nodes = flowData.nodes || [];
                const edges = flowData.edges || [];

                const startNode = nodes.find(node => !edges.some(edge => edge.target === node.id)) || nodes[0];
                
                if (startNode) {
                    initialNodeId = startNode.id;
                    initialAssigneeId = startNode.data?.assignee || null; 
                }
            }
        }

        const { data: { text } } = await Tesseract.recognize(req.file.path, 'eng');

        const newDoc = await pool.query(
            "INSERT INTO documents (title, file_path, extracted_text, submitter_id, workflow_id, current_node_id, current_assignee_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending') RETURNING *",
            [title, req.file.path, text, submitter_id, workflow_id || null, initialNodeId, initialAssigneeId]
        );

        res.status(201).json({ message: 'Document submitted', document: newDoc.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error uploading' });
    }
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        let query; let values;

        if (req.user.role_id === 1) {
            query = "SELECT d.*, (SELECT comments FROM approvals a WHERE a.document_id = d.id ORDER BY id DESC LIMIT 1) as latest_comment FROM documents d WHERE d.submitter_id = $1 ORDER BY d.created_at DESC";
            values = [req.user.id];
        } else if (req.user.role_id === 2) {
            // This filters the queue so a Staff member only sees what is assigned to them!
            query = "SELECT * FROM documents WHERE status = 'Pending' AND (current_assignee_id = $1 OR current_assignee_id IS NULL) ORDER BY created_at ASC";
            values = [req.user.id];
        } else {
            query = "SELECT * FROM documents ORDER BY created_at DESC";
            values = [];
        }

        const result = await pool.query(query, values);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching' });
    }
});

module.exports = router;