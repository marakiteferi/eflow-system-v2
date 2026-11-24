const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const authenticateToken = require('../middleware/authMiddleware');
const engine = require('../services/workflowEngine');
const { parseFlow } = require('../services/workflowGraph');
const { signApproval, hashFile } = require('../services/signing');
const { notifyUser, sendMail } = require('../services/notifier');

// The Stamping Libraries
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const sharp = require('sharp');
const fs = require('fs');



const otpStore = new Map();

// ── Helper: Append Signature Certificate page to approved PDFs ──────────────
// PDF-only since all uploads are now PDF.
const appendSignatureCertificate = async (filePath, documentId, documentTitle, pool) => {
    try {
        if (!filePath) return false;
        const lowerPath = filePath.toLowerCase();

        // Only handle PDFs — file uploads are PDF-only
        if (!lowerPath.endsWith('.pdf')) return false;

        console.log(`\n📄 APPENDING SIGNATURE CERTIFICATE to: ${filePath}`);

        // Fetch all approvals for this document
        const approvalsQuery = await pool.query(
            `SELECT a.*, u.name as approver_name 
             FROM approvals a 
             JOIN users u ON a.approver_id = u.id 
             WHERE a.document_id = $1 AND a.status = 'Approved'
             ORDER BY a.id ASC`,
            [documentId]
        );
        const approvals = approvalsQuery.rows;

        const existingPdfBytes = fs.readFileSync(filePath);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);

        // ── Add the Certificate Page ──────────────────────────────────────────
        const certPage = pdfDoc.addPage([595.28, 841.89]); // A4
        const { width: cw, height: ch } = certPage.getSize();
        const margin = 50;
        let y = ch - margin;

        // Header background strip
        certPage.drawRectangle({ x: 0, y: ch - 90, width: cw, height: 90, color: rgb(0.31, 0.27, 0.9), opacity: 0.9 });

        // Title
        certPage.drawText('APPROVAL CERTIFICATE', {
            x: margin, y: ch - 58, size: 22, color: rgb(1, 1, 1),
        });
        certPage.drawText('E-Flow Document Management System', {
            x: margin, y: ch - 78, size: 11, color: rgb(0.85, 0.85, 1),
        });

        y = ch - 120;

        // Document info block
        certPage.drawText('Document:', { x: margin, y, size: 10, color: rgb(0.45, 0.45, 0.45) });
        certPage.drawText(documentTitle || 'Untitled', { x: margin + 80, y, size: 10, color: rgb(0.1, 0.1, 0.1) });
        y -= 18;
        certPage.drawText('Generated:', { x: margin, y, size: 10, color: rgb(0.45, 0.45, 0.45) });
        certPage.drawText(new Date().toLocaleString(), { x: margin + 80, y, size: 10, color: rgb(0.1, 0.1, 0.1) });
        y -= 18;
        certPage.drawText('Document ID:', { x: margin, y, size: 10, color: rgb(0.45, 0.45, 0.45) });
        certPage.drawText(String(documentId), { x: margin + 80, y, size: 10, color: rgb(0.1, 0.1, 0.1) });
        y -= 30;

        // Divider line
        certPage.drawLine({ start: { x: margin, y }, end: { x: cw - margin, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
        y -= 25;

        certPage.drawText('APPROVAL CHAIN', { x: margin, y, size: 12, color: rgb(0.31, 0.27, 0.9) });
        y -= 20;

        // Per-approver blocks
        for (let i = 0; i < approvals.length; i++) {
            const app = approvals[i];
            const blockHeight = app.signature_drawing ? 140 : 85;

            if (y - blockHeight < margin) {
                // Not enough space — add another page
                const extraPage = pdfDoc.addPage([595.28, 841.89]);
                y = extraPage.getSize().height - margin;
                // Draw on extraPage instead — for simplicity we'll just break
                break;
            }

            // Approver card background
            certPage.drawRectangle({
                x: margin, y: y - blockHeight + 10, width: cw - 2 * margin, height: blockHeight,
                color: rgb(0.97, 0.97, 1), borderColor: rgb(0.8, 0.8, 0.9), borderWidth: 1,
            });

            // Step number badge
            certPage.drawRectangle({ x: margin + 10, y: y - 5, width: 24, height: 18, color: rgb(0.31, 0.27, 0.9) });
            certPage.drawText(String(i + 1), { x: margin + 17, y: y - 2, size: 11, color: rgb(1, 1, 1) });

            // Approver name + timestamp
            certPage.drawText(app.approver_name, { x: margin + 44, y: y - 2, size: 12, color: rgb(0.1, 0.1, 0.1) });
            certPage.drawText(`Approved: ${new Date(app.created_at).toLocaleString()}`, {
                x: margin + 44, y: y - 18, size: 9, color: rgb(0.45, 0.45, 0.45),
            });

            // HMAC signature hash (truncated)
            if (app.approval_signature) {
                const shortHash = app.approval_signature.substring(0, 40) + '...';
                certPage.drawText(`HMAC: ${shortHash}`, {
                    x: margin + 44, y: y - 32, size: 7.5, color: rgb(0.55, 0.55, 0.55),
                });
            }

            // Drawn signature image (if captured)
            if (app.signature_drawing) {
                try {
                    // Strip data URL prefix: "data:image/png;base64,..."
                    const base64Data = app.signature_drawing.replace(/^data:image\/png;base64,/, '');
                    const sigBuffer = Buffer.from(base64Data, 'base64');
                    const sigImage = await pdfDoc.embedPng(sigBuffer);
                    const sigDims = sigImage.scale(0.35);
                    certPage.drawImage(sigImage, {
                        x: margin + 44,
                        y: y - 50 - sigDims.height,
                        width: sigDims.width,
                        height: sigDims.height,
                        opacity: 0.9,
                    });
                    certPage.drawText('Drawn Signature:', {
                        x: margin + 44, y: y - 48, size: 8, color: rgb(0.45, 0.45, 0.45),
                    });
                } catch (sigErr) {
                    console.error('Failed to embed signature image:', sigErr.message);
                }
            }

            y -= blockHeight + 12;
        }

        // Footer
        const footerY = margin;
        certPage.drawLine({ start: { x: margin, y: footerY + 18 }, end: { x: cw - margin, y: footerY + 18 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
        certPage.drawText('This certificate was generated automatically by E-Flow. The cryptographic HMAC signatures above provide tamper-evident proof of each approval.', {
            x: margin, y: footerY + 6, size: 7, color: rgb(0.6, 0.6, 0.6),
        });

        fs.writeFileSync(filePath, await pdfDoc.save());
        console.log('✅ Approval Certificate page appended successfully!');
        return true;

    } catch (err) {
        console.error('Failed to append certificate:', err);
        return false;
    }
};

// POST: Request OTP
router.post('/request-otp', authenticateToken, async (req, res) => {
    try {
        const { documentId } = req.body;
        
        // Re-use a still-valid code for the same document, so a failed approval attempt
        // (for example a missing clearance) doesn't lock the approver out.
        const existing = otpStore.get(req.user.id);
        const reuse = existing && String(existing.documentId) === String(documentId) && Date.now() < existing.expires;
        if (reuse && Date.now() - existing.generatedAt < 30 * 1000) {
            return res.status(429).json({ message: 'A code was just sent. Please wait 30 seconds before requesting another.' });
        }
        const otp = reuse ? existing.otp : crypto.randomInt(100000, 1000000).toString();
        otpStore.set(req.user.id, { otp, documentId, expires: reuse ? existing.expires : Date.now() + 5 * 60000, generatedAt: Date.now() });

        const userQuery = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
        const { email, name } = userQuery.rows[0];


        const sent = await sendMail({
            to: email,
            subject: 'Your E-flow Approval OTP',
            html: `<p>Hello ${name},</p>
                   <p>Your one-time approval code is: <b style="font-size:24px">${otp}</b></p>
                   <p>This code expires in 5 minutes.</p>`,
        });
        if (sent) return res.status(200).json({ message: 'OTP sent to your email' });
        if (process.env.NODE_ENV !== 'production') {
            // Local development without email: show the code so the flow can still be tested
            return res.status(200).json({ message: 'Email not configured (dev mode) — OTP: ' + otp });
        }
        return res.status(502).json({ message: 'Could not send the OTP email. Please try again later.' });
    } catch (err) {
        console.error('OTP error:', err);
        res.status(500).json({ message: 'Error generating OTP' });
    }
});

// Load the acting user's current role and department from the database
// (the JWT can be hours old, and older tokens don't carry the department).
const loadActor = async (db, userId) => {
    const r = await db.query('SELECT id, role_id, department_id FROM users WHERE id = $1', [userId]);
    return r.rows[0] || null;
};

const loadDocumentForUpdate = async (db, documentId) => {
    const r = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [documentId]);
    return r.rows[0] || null;
};

// POST: Approve the current step and route the document onward
router.post('/approve', authenticateToken, async (req, res) => {
    const { documentId, otp, comments, signatureDrawing } = req.body;
    const storedData = otpStore.get(req.user.id);

    if (!storedData || String(storedData.documentId) !== String(documentId)) {
        return res.status(400).json({ message: 'Invalid or incorrect OTP' });
    }
    if (storedData.otp !== String(otp)) {
        // Limit guesses: after 5 wrong codes the user must request a new one
        storedData.attempts = (storedData.attempts || 0) + 1;
        if (storedData.attempts >= 5) otpStore.delete(req.user.id);
        return res.status(400).json({ message: 'Invalid or incorrect OTP' });
    }
    if (Date.now() > storedData.expires) {
        otpStore.delete(req.user.id);
        return res.status(400).json({ message: 'OTP has expired' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const doc = await loadDocumentForUpdate(client, documentId);
        if (!doc) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Document not found.' });
        }
        const actor = await loadActor(client, req.user.id);

        if (!engine.canActOn(doc, actor)) {
            await client.query('ROLLBACK');
            const reason = doc.status !== 'Pending'
                ? `This document is already ${doc.status.toLowerCase()}.`
                : 'You are not authorized to approve this document at this stage.';
            return res.status(403).json({ message: reason });
        }

        const openPrereqs = await client.query(
            'SELECT id FROM document_prerequisites WHERE parent_document_id = $1 AND fulfilled_by_document_id IS NULL',
            [documentId]
        );
        if (openPrereqs.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Cannot approve. Waiting for ${openPrereqs.rows.length} clearance document(s).` });
        }

        // Sign before routing so the signature covers the file as it was approved
        const sig = await signApproval(client, { documentId: doc.id, approverId: req.user.id, filePath: doc.file_path });

        const flowRow = doc.workflow_id
            ? (await client.query('SELECT flow_structure FROM workflows WHERE id = $1', [doc.workflow_id])).rows[0]
            : null;
        const flow = parseFlow(flowRow?.flow_structure);
        const result = await engine.advanceAfterApproval(client, doc, flow, actor);

        await client.query(
            `INSERT INTO approvals (document_id, approver_id, node_id, status, comments, document_hash, approval_signature,
                                    previous_approval_id, previous_approval_hash, created_at, signature_drawing)
             VALUES ($1, $2, $3, 'Approved', $4, $5, $6, $7, $8, $9, $10)`,
            [doc.id, req.user.id, result.nodeId || 'System', comments || 'Verified by 2FA', sig.documentHash,
             sig.approvalSignature, sig.previousApprovalId, sig.previousApprovalHash, sig.createdAt, signatureDrawing || null]
        );

        let auditMessage = 'Document Approved - Routed automatically to next step';
        if (result.waitingOnBranches) auditMessage = 'Parallel Branch Approved — Awaiting Other Reviewers';
        if (result.completed) auditMessage = 'Document fully Approved via 2FA';
        await client.query('INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)', [doc.id, req.user.id, auditMessage]);

        if (result.completed) {
            // Satisfy clearances on other documents that were waiting for this workflow
            await client.query(
                `UPDATE document_prerequisites dp
                 SET fulfilled_by_document_id = $1, fulfilled_at = CURRENT_TIMESTAMP
                 FROM documents d
                 WHERE dp.required_workflow_id = $2
                   AND dp.fulfilled_by_document_id IS NULL
                   AND dp.parent_document_id = d.id
                   AND d.submitter_id = $3`,
                [doc.id, doc.workflow_id, doc.submitter_id]
            );
            await notifyUser(client, doc.submitter_id, {
                title: `✅ Approved: "${doc.title}"`,
                body: `Great news! Your document "${doc.title}" has passed all review stages.`,
                type: 'success',
                documentId: doc.id,
                emailSubject: 'Document Fully Approved!',
            });
        }

        await client.query('COMMIT');
        otpStore.delete(req.user.id);

        if (result.completed) {
            const stamped = await appendSignatureCertificate(doc.file_path, doc.id, doc.title, pool);
            if (stamped) {
                await pool.query('UPDATE documents SET final_file_hash = $1 WHERE id = $2', [hashFile(doc.file_path), doc.id]);
            }
        }

        let message = 'Document dynamically routed to next reviewer';
        if (result.waitingOnBranches) message = 'Your branch approved — waiting for other reviewers to complete their branches.';
        if (result.completed) message = 'Document securely approved';
        res.status(200).json({ message });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Error approving document' });
    } finally {
        if (client) client.release();
    }
});

// POST: Reject a document (only the current approver, or a Super Admin)
router.post('/reject', authenticateToken, async (req, res) => {
    const { documentId, comments } = req.body;
    if (!comments || comments.trim() === '') return res.status(400).json({ message: 'A rejection reason is required' });

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const doc = await loadDocumentForUpdate(client, documentId);
        if (!doc) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Document not found.' });
        }
        const actor = await loadActor(client, req.user.id);
        if (!engine.canActOn(doc, actor)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'You are not authorized to reject this document at this stage.' });
        }

        const nodeId = Array.isArray(doc.parallel_branch_data)
            ? doc.parallel_branch_data[engine.findBranchForUser(doc.parallel_branch_data, actor)]?.nodeId
            : doc.current_node_id;

        await client.query(
            `UPDATE documents SET status = 'Rejected', current_assignee_id = NULL, current_role_id = NULL,
             current_department_id = NULL, parallel_branch_data = NULL, resume_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [documentId]
        );
        await client.query(
            "INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Rejected', $4)",
            [documentId, req.user.id, nodeId || doc.current_node_id || 'System', comments]
        );
        await client.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Document Rejected - Revision Required')", [documentId, req.user.id]);
        await notifyUser(client, doc.submitter_id, {
            title: `❌ Rejected: "${doc.title}"`,
            body: `Your document "${doc.title}" was rejected. Reason: ${comments}. Please fix and resubmit it from your dashboard.`,
            type: 'danger',
            documentId: doc.id,
            emailSubject: 'Action Required: Document Rejected',
        });

        await client.query('COMMIT');
        res.status(200).json({ message: 'Document rejected successfully' });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Database error during rejection' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;