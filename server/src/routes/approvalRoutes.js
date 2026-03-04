const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const authenticateToken = require('../middleware/authMiddleware');

// The Stamping Libraries
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const sharp = require('sharp');
const fs = require('fs');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

const otpStore = new Map();

// Mailer Configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_PORT == 465, 
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// Universal Email Helper
const sendNotificationEmail = async (userId, subject, message) => {
    try {
        const userQuery = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
        if (userQuery.rows.length > 0) {
            const { email, name } = userQuery.rows[0];
            console.log(`\n📧 SENDING EMAIL TO: ${email} | SUBJECT: ${subject}`);
            await transporter.sendMail({
                from: `"E-flow System" <${process.env.FROM_EMAIL}>`,
                to: email,
                subject: subject,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px; max-width: 500px;">
                        <h2 style="color: #4f46e5;">E-flow Notification</h2>
                        <p>Hello ${name},</p>
                        <p style="font-size: 16px; color: #374151;">${message}</p>
                        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
                        <p style="font-size: 12px; color: #9ca3af;">Please log in to your dashboard to view the details.</p>
                    </div>
                `
            });
        }
    } catch (err) {
        console.error('Failed to send notification email:', err.message);
    }
};

// NEW: Universal PDF & Image Stamping Engine
// NEW: Universal PDF & Image Stamping Engine (Windows-Safe)
const stampApprovedDocument = async (filePath, approverName) => {
    try {
        if (!filePath) return false;
        
        console.log(`\n🖨️ STAMPING DOCUMENT: ${filePath}`);
        const lowerPath = filePath.toLowerCase();
        const dateStr = new Date().toISOString().split('T')[0];
        const stampText = `OFFICIALLY APPROVED - ${approverName} - ${dateStr}`;

        if (lowerPath.endsWith('.pdf')) {
            const existingPdfBytes = fs.readFileSync(filePath);
            const pdfDoc = await PDFDocument.load(existingPdfBytes);
            const pages = pdfDoc.getPages();
            
            for (const page of pages) {
                const { width, height } = page.getSize();
                page.drawText(stampText, {
                    x: 50, y: height / 2, size: 24, color: rgb(0, 0.5, 0), opacity: 0.4, rotate: degrees(45),
                });
            }
            fs.writeFileSync(filePath, await pdfDoc.save());
            console.log('✅ PDF Stamping Complete!');
            return true;

        } else if (lowerPath.match(/\.(jpg|jpeg|png)$/)) {
            // FIX: Read the image into memory FIRST to prevent Windows file-lock errors
            const imageBuffer = fs.readFileSync(filePath);
            const metadata = await sharp(imageBuffer).metadata();
            const width = metadata.width || 800;
            const height = metadata.height || 800;
            
            const svgWatermark = `
            <svg width="${width}" height="${height}">
              <style>
              .title { fill: rgba(0, 128, 0, 0.5); font-size: ${Math.max(width/20, 24)}px; font-weight: bold; font-family: sans-serif; }
              </style>
              <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="title" transform="rotate(-45, ${width/2}, ${height/2})">${stampText}</text>
            </svg>`;
            
            // Apply the overlay to the memory buffer, then overwrite the physical file
            const stampedBuffer = await sharp(imageBuffer)
                .composite([{ input: Buffer.from(svgWatermark), top: 0, left: 0 }])
                .toBuffer();
                
            fs.writeFileSync(filePath, stampedBuffer);
            console.log('✅ Image Stamping Complete!');
            return true;
        }
    } catch (err) {
        console.error('Failed to stamp document:', err);
        return false;
    }
};

// POST: Request OTP
router.post('/request-otp', authenticateToken, async (req, res) => {
    try {
        const { documentId } = req.body;
        const otp = crypto.randomInt(100000, 999999).toString();
        otpStore.set(req.user.id, { otp, documentId, expires: Date.now() + 5 * 60000 });

        const userQuery = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
        
        console.log(`\n======================================================`);
        console.log(`🔑 OTP FOR ${userQuery.rows[0].email}: ${otp}`);
        console.log(`======================================================\n`);

        res.status(200).json({ message: 'OTP generated successfully (Check Terminal)' });
    } catch (err) {
        console.error('OTP error:', err);
        res.status(500).json({ message: 'Error generating OTP' });
    }
});

// POST: Approve & Route Document (Advanced Engine)
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

        // Fetch doc details including file_path for stamping!
        const docQuery = await pool.query('SELECT title, submitter_id, workflow_id, current_node_id, metadata_tag, file_path FROM documents WHERE id = $1', [documentId]);
        const doc = docQuery.rows[0];

        let nextNodeId = null;
        let nextAssigneeId = null; 
        let isFinalStep = true;

        if (doc.workflow_id && doc.current_node_id) {
            const wfQuery = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [doc.workflow_id]);
            const flowData = typeof wfQuery.rows[0].flow_structure === 'string' ? JSON.parse(wfQuery.rows[0].flow_structure) : wfQuery.rows[0].flow_structure;
            
            const edges = flowData.edges || [];
            const nodes = flowData.nodes || [];
            
            let currentId = doc.current_node_id;

            while (true) {
                let outgoingEdges = edges.filter(e => e.source === currentId);
                if (outgoingEdges.length === 0) break;

                let edgeToFollow = outgoingEdges[0]; 

                const currentNodeObj = nodes.find(n => n.id === currentId);
                if (currentNodeObj && currentNodeObj.type === 'condition') {
                    const docTag = (doc.metadata_tag || '').toLowerCase().trim();
                    const condValue = (currentNodeObj.data?.conditionValue || '').toLowerCase().trim();
                    
                    const isMatch = docTag === condValue;
                    const expectedHandle = isMatch ? 'true' : 'false';

                    edgeToFollow = outgoingEdges.find(e => e.sourceHandle === expectedHandle);
                    if (!edgeToFollow) break; 
                }

                let targetNode = nodes.find(n => n.id === edgeToFollow.target);
                if (!targetNode) break;

                if (targetNode.type === 'condition') {
                    currentId = targetNode.id;
                } else {
                    nextNodeId = targetNode.id;
                    nextAssigneeId = targetNode.data?.assignee ? parseInt(targetNode.data.assignee, 10) : null;
                    isFinalStep = false;
                    break;
                }
            }
        }

        // Save Route State & Trigger Stamp
        if (isFinalStep) {
            await pool.query("UPDATE documents SET status = 'Approved', current_node_id = NULL, current_assignee_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [documentId]);
            await sendNotificationEmail(doc.submitter_id, 'Document Fully Approved!', `Great news! Your document <b>"${doc.title}"</b> has passed all review stages.`);
            
            // Apply the permanent watermark
            const userQuery = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
            await stampApprovedDocument(doc.file_path, userQuery.rows[0].name);
        } else {
            await pool.query("UPDATE documents SET current_node_id = $1, current_assignee_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3", [nextNodeId, nextAssigneeId, documentId]);
            if (nextAssigneeId) {
                await sendNotificationEmail(nextAssigneeId, 'New Document Ready for Review', `A new document <b>"${doc.title}"</b> has been routed to your queue.`);
            }
        }

        const nodeLogLabel = doc.current_node_id || 'System';
        await pool.query("INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Approved', $4)", [documentId, req.user.id, nodeLogLabel, comments || 'Verified by 2FA']);

        const auditMessage = isFinalStep ? 'Document fully Approved via 2FA' : `Document Approved - Routed automatically to next step`;
        await pool.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)", [documentId, req.user.id, auditMessage]);

        await pool.query('COMMIT');
        otpStore.delete(req.user.id);
        
        res.status(200).json({ message: isFinalStep ? 'Document securely approved' : 'Document dynamically routed to next reviewer' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Database error' });
    }
});

// POST: Reject a document
router.post('/reject', authenticateToken, async (req, res) => {
    const { documentId, comments } = req.body;
    if (!comments || comments.trim() === '') return res.status(400).json({ message: 'A rejection reason is required' });
    
    try {
        await pool.query('BEGIN');
        await pool.query("UPDATE documents SET status = 'Rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [documentId]);
        
        const docQuery = await pool.query('SELECT title, submitter_id, current_node_id FROM documents WHERE id = $1', [documentId]);
        const doc = docQuery.rows[0];

        await pool.query("INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Rejected', $4)", [documentId, req.user.id, doc.current_node_id || 'System', comments]);
        await pool.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Document Rejected - Revision Required')", [documentId, req.user.id]);
        
        await pool.query('COMMIT');

        await sendNotificationEmail(
            doc.submitter_id, 
            'Action Required: Document Rejected', 
            `Your document <b>"${doc.title}"</b> requires your attention.<br><br><b>Feedback:</b> ${comments}<br><br>Please use the "Fix & Resubmit" button on your dashboard to upload a corrected version.`
        );

        res.status(200).json({ message: 'Document rejected successfully' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Database error during rejection' });
    }
});

module.exports = router;