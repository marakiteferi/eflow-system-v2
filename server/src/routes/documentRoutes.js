const express = require('express');
const router = express.Router();
const multer = require('multer');
const authenticateToken = require('../middleware/authMiddleware');
const { requireDocumentAccess } = require('../middleware/permissions');
const engine = require('../services/workflowEngine');
const { parseFlow } = require('../services/workflowGraph');
const { hashFile, verifyChain } = require('../services/signing');
const Tesseract = require('tesseract.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const pool = require('../db');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    // Random, unguessable file names so stored documents can't be found by guessing URLs
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
});

const pdfOnlyFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('INVALID_FILE_TYPE'), false);
    }
};

const upload = multer({ storage, fileFilter: pdfOnlyFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// Error handler for multer
const handleMulterError = (err, req, res, next) => {
    if (err && err.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ message: 'Only PDF files are accepted.' });
    }
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File is too large. Maximum size is 10 MB.' });
    }
    next(err);
};

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

// Check that the user may start this workflow: it must be published, open to their role,
// and any prerequisite workflows must already be approved for them. Returns an error message or null.
const checkCanSubmit = async (db, flow, user) => {
    if (flow.metadata?.isPublished === false) return 'This workflow is not published yet.';
    const allowed = flow.metadata?.allowedSubmitters || [];
    if (allowed.length > 0 && user.role_id !== 3 && !allowed.map(Number).includes(Number(user.role_id))) {
        return 'This service is not available for your role.';
    }
    for (const pid of flow.metadata?.prerequisiteWorkflowIds || []) {
        const done = await db.query(
            'SELECT id FROM documents WHERE workflow_id = $1 AND submitter_id = $2 AND status = $3 LIMIT 1',
            [pid, user.id, 'Approved']
        );
        if (done.rows.length === 0) return 'You must complete all prerequisite workflows before submitting this request.';
    }
    return null;
};

// 1. POST: Upload document
router.post('/upload', authenticateToken, (req, res, next) => upload.single('document')(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
}), async (req, res) => {
    const { title, workflow_id, metadata_tag } = req.body;
    if (!title || !req.file) return res.status(400).json({ message: 'Title and document are required.' });

    let client;
    try {
        let flow = parseFlow(null);
        if (workflow_id) {
            const wf = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [workflow_id]);
            if (wf.rows.length === 0) return res.status(404).json({ message: 'Workflow not found.' });
            flow = parseFlow(wf.rows[0].flow_structure);
            const problem = await checkCanSubmit(pool, flow, req.user);
            if (problem) return res.status(400).json({ message: problem });
        }

        const extracted_text = await extractText(req.file.path, req.file.mimetype);

        client = await pool.connect();
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO documents (title, file_path, extracted_text, submitter_id, workflow_id, metadata_tag, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'Pending') RETURNING *`,
            [title, req.file.path, extracted_text, req.user.id, workflow_id || null, metadata_tag || null]
        );
        const doc = inserted.rows[0];

        if (workflow_id) {
            // Clearances: start each required sub-workflow now; this document can't be
            // fully approved until they are.
            for (const cId of flow.metadata?.clearanceWorkflowIds || []) {
                await client.query('INSERT INTO document_prerequisites (parent_document_id, required_workflow_id) VALUES ($1, $2)', [doc.id, cId]);
                await engine.spawnWorkflow(client, cId, doc);
            }
            await engine.startDocument(client, doc, flow);
        }
        await client.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Document Submitted')", [doc.id, req.user.id]);
        await client.query('COMMIT');

        const saved = await pool.query('SELECT * FROM documents WHERE id = $1', [doc.id]);
        res.status(201).json({ message: 'Document submitted', document: saved.rows[0] });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Error uploading' });
    } finally {
        if (client) client.release();
    }
});

// 2. PUT: Resubmit a rejected document
router.put('/resubmit/:id', authenticateToken, (req, res, next) => upload.single('document')(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
}), async (req, res) => {
    const documentId = req.params.id;
    if (!req.file) return res.status(400).json({ message: 'New document file is required.' });

    let client;
    try {
        const existing = await pool.query(
            'SELECT * FROM documents WHERE id = $1 AND submitter_id = $2 AND status = $3',
            [documentId, req.user.id, 'Rejected']
        );
        if (existing.rows.length === 0) return res.status(403).json({ message: 'Document not eligible for resubmission.' });
        const current = existing.rows[0];

        let flow = parseFlow(null);
        if (current.workflow_id) {
            const wf = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [current.workflow_id]);
            flow = parseFlow(wf.rows[0]?.flow_structure);
        }

        const extracted_text = await extractText(req.file.path, req.file.mimetype);

        client = await pool.connect();
        await client.query('BEGIN');

        // Archive the rejected version
        const versionCount = await client.query('SELECT COUNT(*) FROM document_versions WHERE document_id = $1', [documentId]);
        const rejection = await client.query(
            "SELECT comments FROM approvals WHERE document_id = $1 AND status = 'Rejected' ORDER BY id DESC LIMIT 1",
            [documentId]
        );
        await client.query(
            'INSERT INTO document_versions (document_id, version_number, file_path, extracted_text, rejection_reason, submitted_by) VALUES ($1, $2, $3, $4, $5, $6)',
            [documentId, parseInt(versionCount.rows[0].count, 10) + 1, current.file_path, current.extracted_text, rejection.rows[0]?.comments || null, req.user.id]
        );

        await client.query(
            "UPDATE documents SET file_path = $1, extracted_text = $2, status = 'Pending', final_file_hash = NULL WHERE id = $3",
            [req.file.path, extracted_text, documentId]
        );
        const doc = { ...current, file_path: req.file.path, extracted_text, status: 'Pending' };
        if (current.workflow_id) await engine.startDocument(client, doc, flow);

        await client.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Document Resubmitted by User')", [documentId, req.user.id]);
        await client.query('COMMIT');
        res.status(200).json({ message: 'Document resubmitted successfully' });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Server error during resubmission' });
    } finally {
        if (client) client.release();
    }
});

// 2b. GET: Fetch version history for a document
router.get('/:id/versions', authenticateToken, requireDocumentAccess, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT dv.*, u.name as submitted_by_name
             FROM document_versions dv
             LEFT JOIN users u ON dv.submitted_by = u.id
             WHERE dv.document_id = $1
             ORDER BY dv.version_number ASC`,
            [req.params.id]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching versions:', err);
        res.status(500).json({ message: 'Server error fetching version history.' });
    }
});

// 3. GET: Fetch history timeline
router.get('/:id/history', authenticateToken, requireDocumentAccess, async (req, res) => {
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
router.get('/:id/clearances', authenticateToken, requireDocumentAccess, async (req, res) => {
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
                        OR (
                            d.parallel_branch_data IS NOT NULL AND EXISTS (
                                SELECT 1 FROM jsonb_array_elements(d.parallel_branch_data::jsonb) AS b
                                WHERE b->>'status' = 'Pending'
                                AND (
                                    (b->>'assigneeId')::numeric = $1
                                    OR (
                                        (b->>'assigneeId') IS NULL
                                        AND (b->>'roleId')::numeric = $2
                                        AND ((b->>'departmentId') IS NULL OR (b->>'departmentId')::numeric = $3)
                                    )
                                )
                            )
                        )
                    ))
                   OR a.approver_id = $1
                   OR d.submitter_id = $1
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

// GET: Public Verification Endpoint
router.get('/verify-link/:token', async (req, res) => {
    const token = req.params.token;
    try {
        const linkQuery = await pool.query(
            'SELECT * FROM document_verification_links WHERE token = $1',
            [token]
        );
        if (linkQuery.rows.length === 0) return res.status(404).json({ message: 'Invalid or expired verification link.' });
        
        const link = linkQuery.rows[0];

        if (link.is_revoked) {
            return res.status(403).json({ message: 'This verification link has been revoked by the issuer.' });
        }
        if (link.expires_at && new Date() > new Date(link.expires_at)) {
            return res.status(403).json({ message: 'This verification link has expired.' });
        }
        if (link.max_uses && link.access_count >= link.max_uses) {
            return res.status(403).json({ message: 'This verification link has reached its maximum number of uses.' });
        }

        // Increment access count
        await pool.query('UPDATE document_verification_links SET access_count = access_count + 1 WHERE id = $1', [link.id]);
        await pool.query(
            "INSERT INTO audit_logs (document_id, action) VALUES ($1, 'Verification link accessed publicly')",
            [link.document_id]
        );

        // Fetch limited, non-PII data
        const docQuery = await pool.query(
            'SELECT title, status, created_at, updated_at, file_path, final_file_hash FROM documents WHERE id = $1',
            [link.document_id]
        );
        if (docQuery.rows.length === 0) return res.status(404).json({ message: 'Document not found.' });

        const doc = docQuery.rows[0];

        // Fetch approval chain metadata (anonymized roles)
        const approvalsQuery = await pool.query(
            `SELECT a.*, COALESCE(dr.name, CASE u.role_id WHEN 1 THEN 'Student' WHEN 2 THEN 'Staff' WHEN 3 THEN 'Administrator' END) as role_name
             FROM approvals a
             JOIN users u ON a.approver_id = u.id
             LEFT JOIN dynamic_roles dr ON u.role_id = dr.id
             WHERE a.document_id = $1 ORDER BY a.id ASC`,
            [link.document_id]
        );

        // Current file hash
        let currentHash = null;
        try {
            currentHash = crypto.createHash('sha256').update(fs.readFileSync(doc.file_path)).digest('hex');
        } catch (e) {
            console.error('File read error:', e);
        }

        const verification = verifyChain(approvalsQuery.rows, { currentFileHash: currentHash, finalFileHash: doc.final_file_hash });

        res.status(200).json({
            title: doc.title,
            status: doc.status,
            submission_date: doc.created_at,
            final_approval_date: doc.status === 'Approved' ? doc.updated_at : null,
            stages_count: approvalsQuery.rows.length,
            approvals: approvalsQuery.rows.map(a => ({
                role: a.role_name || 'System Role',
                status: a.status,
                timestamp: a.created_at
            })),
            document_hash: currentHash,
            chain_valid: verification.chainValid,
            file_intact: verification.fileIntact,
            purpose: link.purpose
        });
    } catch (err) {
        console.error('Error verifying link:', err);
        res.status(500).json({ message: 'Server error verifying link' });
    }
});

// GET: Securely download document via public verification link
router.get('/verify-link/:token/download', async (req, res) => {
    const token = req.params.token;
    try {
        const linkQuery = await pool.query('SELECT * FROM document_verification_links WHERE token = $1', [token]);
        if (linkQuery.rows.length === 0) return res.status(404).json({ message: 'Invalid verification link.' });
        
        const link = linkQuery.rows[0];
        if (link.is_revoked) return res.status(403).json({ message: 'Link revoked.' });
        if (link.expires_at && new Date() > new Date(link.expires_at)) return res.status(403).json({ message: 'Link expired.' });
        if (link.max_uses && link.access_count > link.max_uses) return res.status(403).json({ message: 'Max uses reached.' });

        const docQuery = await pool.query('SELECT file_path, title FROM documents WHERE id = $1', [link.document_id]);
        if (docQuery.rows.length === 0) return res.status(404).json({ message: 'Document not found.' });

        const doc = docQuery.rows[0];
        if (!fs.existsSync(doc.file_path)) return res.status(404).json({ message: 'File not found on server.' });

        res.download(doc.file_path, `${doc.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
    } catch (err) {
        console.error('Download error:', err);
        res.status(500).json({ message: 'Server error during download' });
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
            "INSERT INTO document_tags_history (document_id, tag_name, tag_value, applied_by_user_id, node_id) VALUES ($1, 'metadata_tag', $2, $3, $4)",
            [documentId, tag.trim(), req.user.id, doc.current_node_id || null]
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

// GET: Fetch document tag history
router.get('/:id/tag-history', authenticateToken, requireDocumentAccess, async (req, res) => {
    try {
        const historyQuery = await pool.query(`
            SELECT h.id, h.tag_value as tag, h.created_at, u.name as applied_by, h.node_id
            FROM document_tags_history h
            LEFT JOIN users u ON u.id = h.applied_by_user_id
            WHERE h.document_id = $1
            ORDER BY h.created_at DESC
        `, [req.params.id]);
        res.status(200).json(historyQuery.rows);
    } catch (err) {
        console.error('Error fetching tag history:', err);
        res.status(500).json({ message: 'Server error fetching tag history.' });
    }
});

// POST: Approver attaches a supporting file to a document
router.post('/:id/attachments', authenticateToken, (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
}), async (req, res) => {
    const documentId = req.params.id;
    const { description } = req.body;

    if (!req.file) return res.status(400).json({ message: 'File required.' });

    try {
        // Verify the requester is the current assignee or admin
        const doc = await pool.query('SELECT current_assignee_id FROM documents WHERE id = $1', [documentId]);
        if (!doc.rows[0]) return res.status(404).json({ message: 'Document not found.' });

        const isAdmin = req.user.role_id === 3;
        const isAssignee = doc.rows[0].current_assignee_id === req.user.id;

        if (!isAdmin && !isAssignee) {
            return res.status(403).json({ message: 'Only the current assignee can attach files.' });
        }

        // GENERATE HASH AND HMAC SIGNATURE
        const fileBuffer = fs.readFileSync(req.file.path);
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const SIGNING_SECRET = process.env.APPROVAL_SIGNING_SECRET;
        const signatureTimestamp = new Date().toISOString();
        const dataToSign = `${fileHash}|${req.user.id}|${signatureTimestamp}`;
        const attachmentSignature = crypto.createHmac('sha256', SIGNING_SECRET).update(dataToSign).digest('hex');

        await pool.query(
            'INSERT INTO document_attachments (document_id, uploaded_by, file_path, file_name, description, file_hash, attachment_signature) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [documentId, req.user.id, req.file.path, req.file.originalname, description || null, fileHash, attachmentSignature]
        );

        await pool.query(
            "INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1,$2,$3)",
            [documentId, req.user.id, `Attached file: ${req.file.originalname} (Secured via HMAC)`]
        );

        res.status(201).json({ message: 'File attached successfully.' });
    } catch (err) {
        console.error('Error attaching file:', err);
        res.status(500).json({ message: 'Server error attaching file.' });
    }
});

// GET: Fetch attachments for a document
router.get('/:id/attachments', authenticateToken, requireDocumentAccess, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT da.*, u.name as uploaded_by_name 
             FROM document_attachments da 
             JOIN users u ON da.uploaded_by = u.id 
             WHERE da.document_id = $1 
             ORDER BY da.created_at DESC`,
            [req.params.id]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching attachments:', err);
        res.status(500).json({ message: 'Server error fetching attachments.' });
    }
});

// GET: Verify the full approval chain for a document
router.get('/:id/verify-chain', authenticateToken, requireDocumentAccess, async (req, res) => {
    try {
        const doc = await pool.query('SELECT file_path, final_file_hash FROM documents WHERE id = $1', [req.params.id]);
        if (!doc.rows[0]) return res.status(404).json({ message: 'Document not found' });
        const approvals = await pool.query('SELECT * FROM approvals WHERE document_id = $1 ORDER BY id ASC', [req.params.id]);

        let currentFileHash = null;
        try { currentFileHash = hashFile(doc.rows[0].file_path); } catch (e) { console.error('File read error for hash:', e.message); }

        const result = verifyChain(approvals.rows, { currentFileHash, finalFileHash: doc.rows[0].final_file_hash });
        res.status(200).json({
            document_id: req.params.id,
            chain_valid: result.chainValid,
            file_intact: result.fileIntact,
            approvals: result.approvals,
        });
    } catch (err) {
        console.error('Error verifying chain:', err);
        res.status(500).json({ message: 'Server error verifying chain.' });
    }
});

// POST: Generate a new verification link
router.post('/:id/verification-link', authenticateToken, async (req, res) => {
    const documentId = req.params.id;
    const { purpose, expires_in_days, max_uses } = req.body;

    // Validation
    const parsedExpires = expires_in_days ? parseInt(expires_in_days) : null;
    const parsedMaxUses = max_uses ? parseInt(max_uses) : null;

    if (parsedExpires !== null && parsedExpires <= 0) {
        return res.status(400).json({ message: 'Expiration days must be a positive number.' });
    }
    if (parsedMaxUses !== null && (parsedMaxUses <= 0 || parsedMaxUses > 100)) {
        return res.status(400).json({ message: 'Max uses must be a positive number between 1 and 100.' });
    }

    try {
        // Verify submitter
        const docQuery = await pool.query('SELECT submitter_id FROM documents WHERE id = $1', [documentId]);
        if (docQuery.rows.length === 0) return res.status(404).json({ message: 'Document not found' });
        
        if (docQuery.rows[0].submitter_id !== req.user.id && req.user.role_id !== 3) {
            return res.status(403).json({ message: 'Only the submitter can generate verification links.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        let expiresAt = null;
        if (parsedExpires) {
            expiresAt = new Date(Date.now() + parsedExpires * 24 * 60 * 60 * 1000);
        }

        await pool.query(
            'INSERT INTO document_verification_links (document_id, token, purpose, expires_at, max_uses, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
            [documentId, token, purpose || null, expiresAt, parsedMaxUses, req.user.id]
        );

        await pool.query(
            "INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Generated verification link')",
            [documentId, req.user.id]
        );

        res.status(201).json({ 
            message: 'Verification link generated',
            link: `${process.env.CLIENT_URL || 'http://localhost:3000'}/verify/${token}`
        });
    } catch (err) {
        console.error('Error generating verification link:', err);
        res.status(500).json({ message: 'Server error generating link' });
    }
});

// GET: Fetch all verification links for a document
router.get('/:id/verification-links', authenticateToken, async (req, res) => {
    const documentId = req.params.id;
    try {
        const docQuery = await pool.query('SELECT submitter_id FROM documents WHERE id = $1', [documentId]);
        if (docQuery.rows.length === 0) return res.status(404).json({ message: 'Document not found' });
        
        if (docQuery.rows[0].submitter_id !== req.user.id && req.user.role_id !== 3) {
            return res.status(403).json({ message: 'Not authorized.' });
        }

        const links = await pool.query(
            'SELECT id, token, purpose, expires_at, max_uses, access_count, is_revoked, created_at FROM document_verification_links WHERE document_id = $1 ORDER BY created_at DESC',
            [documentId]
        );
        
        // Add full URL for convenience
        const mappedLinks = links.rows.map(l => ({
            ...l,
            url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/verify/${l.token}`
        }));

        res.status(200).json(mappedLinks);
    } catch (err) {
        console.error('Error fetching verification links:', err);
        res.status(500).json({ message: 'Server error fetching links' });
    }
});

// PATCH: Revoke a verification link
router.patch('/verification-links/:id/revoke', authenticateToken, async (req, res) => {
    const linkId = req.params.id;
    try {
        const linkQuery = await pool.query('SELECT document_id, created_by FROM document_verification_links WHERE id = $1', [linkId]);
        if (linkQuery.rows.length === 0) return res.status(404).json({ message: 'Link not found' });
        
        if (linkQuery.rows[0].created_by !== req.user.id && req.user.role_id !== 3) {
            return res.status(403).json({ message: 'Not authorized to revoke this link.' });
        }

        await pool.query('UPDATE document_verification_links SET is_revoked = TRUE WHERE id = $1', [linkId]);
        
        await pool.query(
            "INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Revoked verification link')",
            [linkQuery.rows[0].document_id, req.user.id]
        );

        res.status(200).json({ message: 'Link revoked successfully' });
    } catch (err) {
        console.error('Error revoking verification link:', err);
        res.status(500).json({ message: 'Server error revoking link' });
    }
});

module.exports = router;
