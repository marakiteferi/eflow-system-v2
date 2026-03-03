const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const authenticateToken = require('../middleware/authMiddleware');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

const otpStore = new Map();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_PORT == 465, 
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

router.post('/request-otp', authenticateToken, async (req, res) => {
    try {
        const { documentId } = req.body;
        const otp = crypto.randomInt(100000, 999999).toString();
        otpStore.set(req.user.id, { otp, documentId, expires: Date.now() + 5 * 60000 });

        const userQuery = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
        
        console.log(`\n======================================================`);
        console.log(`🔑 DEVELOPMENT OTP FOR ${userQuery.rows[0].email}: ${otp}`);
        console.log(`======================================================\n`);

        res.status(200).json({ message: 'OTP generated successfully (Check Terminal)' });
    } catch (err) {
        console.error('OTP error:', err);
        res.status(500).json({ message: 'Error generating OTP' });
    }
});

router.post('/approve', authenticateToken, async (req, res) => {
    const { documentId, otp, comments } = req.body;
    const storedData = otpStore.get(req.user.id);

    if (!storedData || storedData.otp !== otp || storedData.documentId !== documentId) {
        return res.status(400).json({ message: 'Invalid or incorrect OTP' });
    }
    if (Date.now() > storedData.expires) {
        otpStore.delete(req.user.id);
        return res.status(400).json({ message: 'OTP has expired' });
    }

    try {
        await pool.query('BEGIN');

        const docQuery = await pool.query('SELECT workflow_id, current_node_id FROM documents WHERE id = $1', [documentId]);
        const doc = docQuery.rows[0];

        let nextNodeId = null;
        let nextAssigneeId = null; 
        let isFinalStep = true;

        if (doc.workflow_id && doc.current_node_id) {
            const wfQuery = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [doc.workflow_id]);
            const flowData = typeof wfQuery.rows[0].flow_structure === 'string' ? JSON.parse(wfQuery.rows[0].flow_structure) : wfQuery.rows[0].flow_structure;
            
            const nodes = flowData.nodes || [];
            const edges = flowData.edges || [];
            
            // Find the arrow leaving the current node
            const nextEdge = edges.find(edge => edge.source === doc.current_node_id);
            
            if (nextEdge) {
                nextNodeId = nextEdge.target;
                const nextNode = nodes.find(n => n.id === nextNodeId);
                
                if (nextNode) {
                    // FIX: Ensure the ID is properly converted to an integer, or set to null if it's "-- Any Staff --"
                    nextAssigneeId = nextNode.data?.assignee ? parseInt(nextNode.data.assignee, 10) : null;
                }
                isFinalStep = false;
            }
        }

        console.log(`\n🚀 ROUTING ENGINE:`);
        console.log(`Current Node: ${doc.current_node_id}`);
        console.log(`Next Node: ${nextNodeId || 'NONE - Final Step'}`);
        console.log(`Assigned To Staff ID: ${nextAssigneeId || 'Unassigned (Global Queue)'}\n`);

        if (isFinalStep) {
            await pool.query("UPDATE documents SET status = 'Approved', current_node_id = NULL, current_assignee_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [documentId]);
        } else {
            await pool.query("UPDATE documents SET current_node_id = $1, current_assignee_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3", [nextNodeId, nextAssigneeId, documentId]);
        }

        const nodeLogLabel = doc.current_node_id || 'System';
        await pool.query("INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Approved', $4)", [documentId, req.user.id, nodeLogLabel, comments || 'Verified by 2FA']);

        const auditMessage = isFinalStep ? 'Document fully Approved via 2FA' : `Document Approved at Node ${doc.current_node_id} - Moved to Node ${nextNodeId}`;
        await pool.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)", [documentId, req.user.id, auditMessage]);

        await pool.query('COMMIT');
        otpStore.delete(req.user.id);
        
        res.status(200).json({ message: isFinalStep ? 'Document securely approved' : 'Document moved to next reviewer' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Database error' });
    }
});

router.post('/reject', authenticateToken, async (req, res) => {
    // ... (Keep your exact existing reject route code here) ...
    const { documentId, comments } = req.body;
    if (!comments || comments.trim() === '') return res.status(400).json({ message: 'A rejection reason is required' });
    try {
        await pool.query('BEGIN');
        await pool.query("UPDATE documents SET status = 'Rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [documentId]);
        const docQuery = await pool.query('SELECT current_node_id FROM documents WHERE id = $1', [documentId]);
        await pool.query("INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Rejected', $4)", [documentId, req.user.id, docQuery.rows[0]?.current_node_id || 'System', comments]);
        await pool.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Document Rejected - Revision Required')", [documentId, req.user.id]);
        await pool.query('COMMIT');
        res.status(200).json({ message: 'Document rejected successfully' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Database error during rejection' });
    }
});

module.exports = router;