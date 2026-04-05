const express = require('express');
const router = express.Router();
const multer = require('multer');
const { Pool } = require('pg');
const authenticateToken = require('../middleware/authMiddleware');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const pdfParse = require('pdf-parse');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const extractText = async (filePath, mimetype) => {
    try {
        if (mimetype === 'application/pdf') {
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = await pdfParse(dataBuffer);
            if (!pdfData || !pdfData.text || pdfData.text.trim() === '') {
                return '[System Note: No digital text found. If this is a scanned PDF, please upload it as an Image (PNG/JPG) so the OCR system can read it.]';
            }
            return pdfData.text;
        } else {
            const { data: { text } } = await Tesseract.recognize(filePath, 'eng');
            return text;
        }
    } catch (error) {
        console.error('Extraction error details:', error);
        return `Text extraction failed: ${error.message}`;
    }
};

// ====================================================
// NEW: The Smart Delegation Resolver
// Automatically reroutes documents if the assignee is OOO
// ====================================================
const resolveAssignee = async (dbPool, initialId) => {
    if (!initialId) return null;
    let currentId = initialId;
    let visited = new Set(); // Prevents infinite loops if User A delegates to B, and B delegates to A!

    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const res = await dbPool.query('SELECT is_out_of_office, delegate_id FROM users WHERE id = $1', [currentId]);
        if (res.rows.length === 0) break;

        const { is_out_of_office, delegate_id } = res.rows[0];
        if (is_out_of_office && delegate_id) {
            console.log(`\n🔄 DELEGATION TRIGGERED: User ${currentId} is OOO. Forwarding to Delegate ${delegate_id}`);
            currentId = delegate_id;
        } else {
            break; // User is active, or no delegate assigned. Stop searching.
        }
    }
    return currentId;
};

// 1. POST: Upload document
router.post('/upload', authenticateToken, upload.single('document'), async (req, res) => {
    try {
        const { title, workflow_id, metadata_tag } = req.body;
        const submitter_id = req.user.id;

        if (!title || !req.file) return res.status(400).json({ message: 'Title and document are required.' });

        let initialNodeId = null;
        let initialAssigneeId = null;
        let initialRoleId = null;
        let initialDepartmentId = null;
        // Pitfall 3 FIX: originalSlaDeadline is set once at upload time and NEVER changed again.
        let originalSlaDeadline = null;
        let uploadedFlowData = null;

        if (workflow_id) {
            const wfQuery = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [workflow_id]);
            if (wfQuery.rows.length > 0) {
                const flowData = typeof wfQuery.rows[0].flow_structure === 'string' ? JSON.parse(wfQuery.rows[0].flow_structure) : wfQuery.rows[0].flow_structure;
                uploadedFlowData = flowData;
                const nodes = flowData.nodes || [];
                const edges = flowData.edges || [];

                // Prerequisite Workflow Check
                const prereqWfId = flowData.metadata?.prerequisiteWorkflowId;
                if (prereqWfId) {
                    const prereqCheck = await pool.query(
                        'SELECT id FROM documents WHERE workflow_id = $1 AND submitter_id = $2 AND status = $3 LIMIT 1',
                        [prereqWfId, submitter_id, 'Approved']
                    );
                    if (prereqCheck.rows.length === 0) {
                        return res.status(400).json({ message: 'You must complete the prerequisite workflow before submitting this request.' });
                    }
                }

                const startNode = nodes.find(node => !edges.some(edge => edge.target === node.id)) || nodes[0];
                if (startNode) {
                    initialNodeId = startNode.id;

                    if (startNode.data?.assignmentStrategy === 'role_based') {
                        initialRoleId = startNode.data.roleId ? parseInt(startNode.data.roleId, 10) : null;
                        if (startNode.data.routingType === 'SPECIFIC') {
                            initialDepartmentId = startNode.data.targetDepartmentId ? parseInt(startNode.data.targetDepartmentId, 10) : null;
                        } else if (startNode.data.routingType === 'INITIATOR_DEPT') {
                            const submitterDeptQuery = await pool.query('SELECT department_id FROM users WHERE id = $1', [submitter_id]);
                            initialDepartmentId = submitterDeptQuery.rows[0]?.department_id || null;
                        }
                    } else {
                        let rawAssigneeId = startNode.data?.assignee ? parseInt(startNode.data.assignee, 10) : null;
                        // PASS THE ASSIGNEE THROUGH THE DELEGATION ENGINE!
                        initialAssigneeId = await resolveAssignee(pool, rawAssigneeId);
                    }

                    // Pitfall 3: Stamp the original SLA deadline from the first node's slaHours
                    const slaHours = startNode.data?.slaHours ? parseFloat(startNode.data.slaHours) : null;
                    if (slaHours) {
                        originalSlaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
                    }
                }
            }
        }

        const extracted_text = await extractText(req.file.path, req.file.mimetype);

        const newDoc = await pool.query(
            `INSERT INTO documents (title, file_path, extracted_text, submitter_id, workflow_id, current_node_id, current_assignee_id, current_role_id, current_department_id, metadata_tag, status, original_sla_deadline) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Pending', $11) RETURNING *`,
            [title, req.file.path, extracted_text, submitter_id, workflow_id || null, initialNodeId, initialAssigneeId, initialRoleId, initialDepartmentId, metadata_tag || null, originalSlaDeadline]
        );

        if (uploadedFlowData?.metadata?.clearanceWorkflowIds) {
            for (const cId of uploadedFlowData.metadata.clearanceWorkflowIds) {
                await pool.query('INSERT INTO document_prerequisites (parent_document_id, required_workflow_id) VALUES ($1, $2)', [newDoc.rows[0].id, cId]);
            }
        }

        res.status(201).json({ message: 'Document submitted', document: newDoc.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error uploading' });
    }
});

// 2. PUT: Resubmit a rejected document
router.put('/resubmit/:id', authenticateToken, upload.single('document'), async (req, res) => {
    try {
        const documentId = req.params.id;
        if (!req.file) return res.status(400).json({ message: 'New document file is required.' });

        const docQuery = await pool.query('SELECT workflow_id FROM documents WHERE id = $1 AND submitter_id = $2 AND status = $3', [documentId, req.user.id, 'Rejected']);
        if (docQuery.rows.length === 0) return res.status(403).json({ message: 'Document not eligible for resubmission.' });

        const workflow_id = docQuery.rows[0].workflow_id;
        let initialNodeId = null;
        let initialAssigneeId = null;
        let initialRoleId = null;
        let initialDepartmentId = null;
        let originalSlaDeadline = null;

        if (workflow_id) {
            const wfQuery = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [workflow_id]);
            if (wfQuery.rows.length > 0) {
                const flowData = typeof wfQuery.rows[0].flow_structure === 'string' ? JSON.parse(wfQuery.rows[0].flow_structure) : wfQuery.rows[0].flow_structure;
                const nodes = flowData.nodes || [];
                const edges = flowData.edges || [];

                // Prerequisite Workflow Check
                const prereqWfId = flowData.metadata?.prerequisiteWorkflowId;
                if (prereqWfId) {
                    const prereqCheck = await pool.query(
                        'SELECT id FROM documents WHERE workflow_id = $1 AND submitter_id = $2 AND status = $3 LIMIT 1',
                        [prereqWfId, req.user.id, 'Approved']
                    );
                    if (prereqCheck.rows.length === 0) {
                        return res.status(400).json({ message: 'You must complete the prerequisite workflow before resubmitting this request.' });
                    }
                }

                const startNode = nodes.find(node => !edges.some(edge => edge.target === node.id)) || nodes[0];
                if (startNode) {
                    initialNodeId = startNode.id;

                    if (startNode.data?.assignmentStrategy === 'role_based') {
                        initialRoleId = startNode.data.roleId ? parseInt(startNode.data.roleId, 10) : null;
                        if (startNode.data.routingType === 'SPECIFIC') {
                            initialDepartmentId = startNode.data.targetDepartmentId ? parseInt(startNode.data.targetDepartmentId, 10) : null;
                        } else if (startNode.data.routingType === 'INITIATOR_DEPT') {
                            const submitterDeptQuery = await pool.query('SELECT department_id FROM users WHERE id = $1', [req.user.id]);
                            initialDepartmentId = submitterDeptQuery.rows[0]?.department_id || null;
                        }
                    } else {
                        let rawAssigneeId = startNode.data?.assignee ? parseInt(startNode.data.assignee, 10) : null;
                        // PASS THE ASSIGNEE THROUGH THE DELEGATION ENGINE!
                        initialAssigneeId = await resolveAssignee(pool, rawAssigneeId);
                    }

                    // Pitfall 3: Reset original SLA deadline on resubmit (fresh document lifecycle)
                    const slaHours = startNode.data?.slaHours ? parseFloat(startNode.data.slaHours) : null;
                    if (slaHours) {
                        originalSlaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
                    }
                }
            }
        }

        const extracted_text = await extractText(req.file.path, req.file.mimetype);

        await pool.query(
            `UPDATE documents SET file_path = $1, extracted_text = $2, status = 'Pending',
             current_node_id = $3, current_assignee_id = $4, current_role_id = $5, current_department_id = $6,
             original_sla_deadline = $7, delegation_sla_deadline = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE id = $8`,
            [req.file.path, extracted_text, initialNodeId, initialAssigneeId, initialRoleId, initialDepartmentId, originalSlaDeadline, documentId]
        );

        await pool.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Document Resubmitted by User')", [documentId, req.user.id]);
        res.status(200).json({ message: 'Document resubmitted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error during resubmission' });
    }
});

// 3. GET: Fetch history timeline
router.get('/:id/history', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT a.status, a.comments, a.created_at, u.name as approver_name, a.node_id
            FROM approvals a JOIN users u ON a.approver_id = u.id
            WHERE a.document_id = $1 ORDER BY a.created_at ASC
        `;
        const result = await pool.query(query, [req.params.id]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching document history:', err);
        res.status(500).json({ message: 'Server error fetching history' });
    }
});

// 3b. GET: Fetch clearances for a document
router.get('/:id/clearances', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT 
                dp.id as prereq_id,
                dp.required_workflow_id,
                w.name as required_workflow_name,
                dp.fulfilled_by_document_id,
                dp.fulfilled_at,
                d.title as fulfilling_document_title,
                d.file_path as fulfilling_file_path,
                d.status as fulfilling_status
            FROM document_prerequisites dp
            JOIN workflows w ON dp.required_workflow_id = w.id
            LEFT JOIN documents d ON dp.fulfilled_by_document_id = d.id
            WHERE dp.parent_document_id = $1
            ORDER BY w.name ASC
        `;
        const result = await pool.query(query, [req.params.id]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching document clearances:', err);
        res.status(500).json({ message: 'Server error fetching clearances' });
    }
});

// 4. GET: Fetch documents based on role
router.get('/', authenticateToken, async (req, res) => {
    try {
        let query; let values;
        if (req.user.role_id === 1) {
            query = `
                SELECT d.*, 
                (SELECT comments FROM approvals a WHERE a.document_id = d.id ORDER BY id DESC LIMIT 1) as latest_comment,
                (SELECT COUNT(*) FROM document_prerequisites dp WHERE dp.parent_document_id = d.id) as total_prereqs,
                (SELECT COUNT(*) FROM document_prerequisites dp WHERE dp.parent_document_id = d.id AND dp.fulfilled_by_document_id IS NOT NULL) as fulfilled_prereqs
                FROM documents d WHERE d.submitter_id = $1 ORDER BY d.created_at DESC`;
            values = [req.user.id];
        } else if (req.user.role_id === 2 || req.user.role_id > 3) {
            query = `
                SELECT DISTINCT d.*,
                (SELECT COUNT(*) FROM document_prerequisites dp WHERE dp.parent_document_id = d.id) as total_prereqs,
                (SELECT COUNT(*) FROM document_prerequisites dp WHERE dp.parent_document_id = d.id AND dp.fulfilled_by_document_id IS NOT NULL) as fulfilled_prereqs
                FROM documents d 
                LEFT JOIN approvals a ON a.document_id = d.id AND a.approver_id = $1
                WHERE 
                    (d.status = 'Pending' AND (
                        d.current_assignee_id = $1 
                        OR (
                            d.current_assignee_id IS NULL 
                            AND d.current_role_id = $2
                            AND (d.current_department_id IS NULL OR d.current_department_id = $3)
                        )
                    ))
                   OR a.approver_id = $1
                ORDER BY d.created_at DESC
            `;
            values = [req.user.id, req.user.role_id, req.user.department_id];
        } else {
            query = `
                SELECT d.*,
                (SELECT COUNT(*) FROM document_prerequisites dp WHERE dp.parent_document_id = d.id) as total_prereqs,
                (SELECT COUNT(*) FROM document_prerequisites dp WHERE dp.parent_document_id = d.id AND dp.fulfilled_by_document_id IS NOT NULL) as fulfilled_prereqs
                FROM documents d ORDER BY created_at DESC`;
            values = [];
        }
        const result = await pool.query(query, values);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching' });
    }
});

// 5. PATCH: Set metadata tag on a document (for staff to trigger condition nodes)
router.patch('/:id/tag', authenticateToken, async (req, res) => {
    const { tag } = req.body;
    const documentId = req.params.id;

    if (tag === undefined || tag === null) {
        return res.status(400).json({ message: 'A tag value is required.' });
    }

    try {
        // Only the current assignee or a Super Admin can set the tag
        const docQuery = await pool.query('SELECT current_assignee_id FROM documents WHERE id = $1', [documentId]);
        if (docQuery.rows.length === 0) {
            return res.status(404).json({ message: 'Document not found.' });
        }

        const doc = docQuery.rows[0];
        const isSuperAdmin = req.user.role_id === 3;
        const isCurrentAssignee = doc.current_assignee_id === req.user.id;

        if (!isSuperAdmin && !isCurrentAssignee) {
            return res.status(403).json({ message: 'You are not authorized to tag this document.' });
        }

        await pool.query(
            'UPDATE documents SET metadata_tag = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [tag.trim(), documentId]
        );

        await pool.query(
            "INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)",
            [documentId, req.user.id, `Document tagged as: "${tag.trim()}"`]
        );

        res.status(200).json({ message: `Document tagged as "${tag.trim()}" successfully.` });
    } catch (err) {
        console.error('Error setting document tag:', err);
        res.status(500).json({ message: 'Server error setting tag.' });
    }
});

module.exports = router;
