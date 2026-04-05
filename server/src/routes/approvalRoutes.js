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
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT == 465,
    requireTLS: true, // Enforce STARTTLS on port 587 (required by Brevo)
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// Verify SMTP connection on startup — surfaces auth/config errors immediately
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ SMTP CONNECTION FAILED:', error);
    } else {
        console.log('✅ SMTP Server ready — emails will be delivered');
    }
});

// Universal Email Helper
const sendNotificationEmail = async (userId, subject, message) => {
    try {
        const userQuery = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
        if (userQuery.rows.length > 0) {
            const { email, name } = userQuery.rows[0];
            console.log(`\n📧 SENDING EMAIL TO: ${email} | SUBJECT: ${subject}`);
            const info = await transporter.sendMail({
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
            console.log(`✅ EMAIL SENT SUCCESSFULLY — MessageId: ${info.messageId}`);
        }
    } catch (err) {
        console.error(`❌ EMAIL SEND FAILED — Subject: "${subject}" | Error: ${err.message}`);
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
              .title { fill: rgba(0, 128, 0, 0.5); font-size: ${Math.max(width / 20, 24)}px; font-weight: bold; font-family: sans-serif; }
              </style>
              <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="title" transform="rotate(-45, ${width / 2}, ${height / 2})">${stampText}</text>
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

        // Fetch doc details including file_path and extracted_text for inheritance!
        const docQuery = await pool.query(
            'SELECT title, submitter_id, workflow_id, current_node_id, metadata_tag, file_path, extracted_text, parallel_branch_data FROM documents WHERE id = $1',
            [documentId]
        );
        const doc = docQuery.rows[0];

        // FEATURE 2: Prerequisite check
        const prereqCheck = await pool.query(
            'SELECT id FROM document_prerequisites WHERE parent_document_id = $1 AND fulfilled_by_document_id IS NULL',
            [documentId]
        );
        if (prereqCheck.rows.length > 0) {
            return res.status(400).json({ message: `Cannot approve. Waiting for ${prereqCheck.rows.length} clearance document(s).` });
        }

        // Pre-fetch submitter info once — used by email nodes for template variables
        let submitterInfo = null;
        if (doc.submitter_id) {
            const submitterQuery = await pool.query('SELECT name, email FROM users WHERE id = $1', [doc.submitter_id]);
            if (submitterQuery.rows.length > 0) {
                submitterInfo = submitterQuery.rows[0];
            }
        }

        // Helper: resolve {{submitter_email}}, {{submitter_name}}, {{document_title}} in any string
        const resolveTemplate = (text) => {
            if (!text) return text;
            return text
                .replace(/\{\{submitter_email\}\}/gi, submitterInfo?.email || '')
                .replace(/\{\{submitter_name\}\}/gi, submitterInfo?.name || '')
                .replace(/\{\{document_title\}\}/gi, doc.title || '');
        };

        // Helper: Execute Email Node
        const executeEmailNode = async (tNode) => {
            const recipientRaw = tNode.data?.recipient || '';
            const resolvedRecipient = resolveTemplate(recipientRaw);
            const resolvedSubject = resolveTemplate(tNode.data?.subject || 'E-flow Notification');
            const resolvedBody = resolveTemplate(tNode.data?.body || '');
            console.log(`\n📧 WORKFLOW EMAIL NODE — Sending to: ${resolvedRecipient} | Subject: ${resolvedSubject}`);
            try {
                if (resolvedRecipient) {
                    const info = await transporter.sendMail({
                        from: `"E-flow System" <${process.env.FROM_EMAIL}>`,
                        to: resolvedRecipient,
                        subject: resolvedSubject,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px; max-width: 500px;">
                                <h2 style="color: #4f46e5;">E-flow Notification</h2>
                                <p style="font-size: 16px; color: #374151; white-space: pre-line;">${resolvedBody}</p>
                                <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
                                <p style="font-size: 12px; color: #9ca3af;">This is an automated message from the E-flow document system.</p>
                            </div>
                        `
                    });
                    console.log(`✅ WORKFLOW EMAIL SENT — MessageId: ${info.messageId}`);
                } else {
                    console.warn('⚠️ Workflow email node skipped — recipient address is empty');
                }
            } catch (emailErr) {
                console.error('❌ Workflow email node send FAILED:', emailErr);
            }
        };

        // Helper: Execute Spawn Node
        const executeSpawnNode = async (tNode) => {
            const spawnIds = tNode.data?.spawnIds;
            if (spawnIds) {
                const ids = spawnIds.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                for (const sId of ids) {
                    const wQuery = await pool.query('SELECT name, flow_structure FROM workflows WHERE id = $1', [sId]);
                    if (wQuery.rows.length > 0) {
                        const swf = typeof wQuery.rows[0].flow_structure === 'string' ? JSON.parse(wQuery.rows[0].flow_structure) : wQuery.rows[0].flow_structure;
                        const snodes = swf.nodes || [];
                        const sedges = swf.edges || [];
                        const start = snodes.find(n => !sedges.some(e => e.target === n.id)) || snodes[0];
                        
                        let initialAssigneeId = null;
                        let initialRoleId = null;
                        let initialDepartmentId = null;

                        if (start && start.type === 'task') {
                            if (start.data?.assignmentStrategy === 'role_based') {
                                initialRoleId = start.data.roleId ? parseInt(start.data.roleId, 10) : null;
                                if (start.data.routingType === 'SPECIFIC') {
                                    initialDepartmentId = start.data.targetDepartmentId ? parseInt(start.data.targetDepartmentId, 10) : null;
                                } else if (start.data.routingType === 'INITIATOR_DEPT') {
                                    const submitterDeptQuery = await pool.query('SELECT department_id FROM users WHERE id = $1', [doc.submitter_id]);
                                    initialDepartmentId = submitterDeptQuery.rows[0]?.department_id || null;
                                }
                            } else {
                                initialAssigneeId = start.data?.assignee ? parseInt(start.data.assignee, 10) : null;
                            }
                        }

                        await pool.query(
                            `INSERT INTO documents (title, submitter_id, workflow_id, current_node_id, current_assignee_id, current_role_id, current_department_id, status, file_path, extracted_text) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8, $9)`,
                            [`Spawned: ${wQuery.rows[0].name}`, doc.submitter_id, sId, start?.id, initialAssigneeId, initialRoleId, initialDepartmentId, doc.file_path, doc.extracted_text]
                        );
                    }
                }
            }
        };

        let nextNodeId = null;
        let nextAssigneeId = null;
        let nextRoleId = null;
        let nextDepartmentId = null;
        let isFinalStep = true;
        let parallelBranches = null; // array of {nodeId, assigneeId, status} when in parallel mode

        // ── PARALLEL BRANCH CHECK ──────────────────────────────────────────────
        // If this document is currently inside a parallel gate (has branch data),
        // mark the current approver's branch as done instead of advancing linearly.
        const existingBranches = doc.parallel_branch_data;
        if (existingBranches && Array.isArray(existingBranches)) {
            // Find the branch this approver belongs to (by exact match OR role/dept match)
            const myBranchIdx = existingBranches.findIndex(b => {
                if (b.status !== 'Pending') return false;
                if (b.assigneeId === req.user.id) return true; // Direct assignment match
                // Role-based match
                if (b.roleId === req.user.role_id) {
                    if (!b.departmentId) return true; // ANY routing
                    if (b.departmentId === req.user.department_id) return true; // SPECIFIC or INITIATOR match
                }
                return false;
            });

            if (myBranchIdx !== -1) {
                existingBranches[myBranchIdx].status = 'Approved';
                const allDone = existingBranches.every(b => b.status === 'Approved');

                if (!allDone) {
                    // Other branches still pending — just update the branch data and exit
                    await pool.query(
                        'UPDATE documents SET parallel_branch_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                        [JSON.stringify(existingBranches), documentId]
                    );
                    await pool.query(
                        "INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Approved', $4)",
                        [documentId, req.user.id, doc.current_node_id || 'parallel', comments || 'Verified by 2FA']
                    );
                    await pool.query(
                        "INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Parallel Branch Approved — Awaiting Other Reviewers')",
                        [documentId, req.user.id]
                    );
                    await pool.query('COMMIT');
                    otpStore.delete(req.user.id);
                    return res.status(200).json({ message: 'Your branch approved — waiting for other reviewers to complete their branches.' });
                }

                // All branches done — clear parallel data and proceed past the parallel gate
                await pool.query(
                    'UPDATE documents SET parallel_branch_data = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                    [documentId]
                );
                // Override current_node_id to the parallel node so the walker can advance past it
                doc.current_node_id = existingBranches[0].parallelNodeId;
                doc.parallel_branch_data = null;
            }
        }
        // ── END PARALLEL BRANCH CHECK ──────────────────────────────────────────

        if (doc.workflow_id && doc.current_node_id) {
            const wfQuery = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [doc.workflow_id]);
            const flowData = typeof wfQuery.rows[0].flow_structure === 'string'
                ? JSON.parse(wfQuery.rows[0].flow_structure)
                : wfQuery.rows[0].flow_structure;

            const edges = flowData.edges || [];
            const nodes = flowData.nodes || [];

            let currentId = doc.current_node_id;

            while (true) {
                let outgoingEdges = edges.filter(e => e.source === currentId);
                if (outgoingEdges.length === 0) break; // End of graph — fully approved

                let edgeToFollow = outgoingEdges[0];

                const currentNodeObj = nodes.find(n => n.id === currentId);

                // Handle condition node: pick TRUE or FALSE branch based on metadata_tag
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
                    // Condition nodes are transparent — continue looping from here
                    currentId = targetNode.id;

                } else if (targetNode.type === 'email') {
                    // ✅ EMAIL NODE: Execute inline — send an actual email, then continue walking
                    await executeEmailNode(targetNode);
                    // Continue walking from this email node to find the next real step
                    currentId = targetNode.id;

                } else if (targetNode.type === 'spawn') {
                    // FEATURE 3: Spawn on approval
                    await executeSpawnNode(targetNode);
                    currentId = targetNode.id;

                } else if (targetNode.type === 'delay') {
                    // Delay nodes: for now, treat as transparent (no actual scheduling yet)
                    currentId = targetNode.id;

                } else if (targetNode.type === 'parallel') {
                    // ✅ PARALLEL NODE: Fan out to ALL connected branches simultaneously
                    const parallelOutgoing = edges.filter(e => e.source === targetNode.id);
                    const branches = [];
                    for (const pe of parallelOutgoing) {
                        let branchNode = nodes.find(n => n.id === pe.target);
                        
                        // Trace through any transparent side-effect nodes on this single parallel branch
                        while (branchNode && branchNode.type !== 'task') {
                            if (branchNode.type === 'email') await executeEmailNode(branchNode);
                            else if (branchNode.type === 'spawn') await executeSpawnNode(branchNode);
                            
                            const nextEdge = edges.find(e => e.source === branchNode.id);
                            if (nextEdge) branchNode = nodes.find(n => n.id === nextEdge.target);
                            else { branchNode = null; break; }
                        }

                        if (branchNode && branchNode.type === 'task') {
                            let bAssigneeId = null;
                            let bRoleId = null;
                            let bDepartmentId = null;

                            if (branchNode.data?.assignmentStrategy === 'role_based') {
                                bRoleId = branchNode.data.roleId ? parseInt(branchNode.data.roleId, 10) : null;
                                if (branchNode.data.routingType === 'SPECIFIC') {
                                    bDepartmentId = branchNode.data.targetDepartmentId ? parseInt(branchNode.data.targetDepartmentId, 10) : null;
                                } else if (branchNode.data.routingType === 'INITIATOR_DEPT' && submitterInfo) {
                                    const sQuery = await pool.query('SELECT department_id FROM users WHERE id = $1', [doc.submitter_id]);
                                    bDepartmentId = sQuery.rows[0]?.department_id || null;
                                }
                            } else {
                                bAssigneeId = branchNode.data?.assignee ? parseInt(branchNode.data.assignee, 10) : null;
                            }

                            branches.push({
                                parallelNodeId: targetNode.id,
                                nodeId: branchNode.id,
                                assigneeId: bAssigneeId,
                                roleId: bRoleId,
                                departmentId: bDepartmentId,
                                status: 'Pending'
                            });
                        }
                    }
                    if (branches.length > 0) {
                        parallelBranches = branches;
                        isFinalStep = false;
                    }
                    break;

                } else {
                    // It's a task (approval) node — this is the next human step
                    nextNodeId = targetNode.id;
                    if (targetNode.data?.assignmentStrategy === 'role_based') {
                        nextRoleId = targetNode.data.roleId ? parseInt(targetNode.data.roleId, 10) : null;
                        if (targetNode.data.routingType === 'SPECIFIC') {
                            nextDepartmentId = targetNode.data.targetDepartmentId ? parseInt(targetNode.data.targetDepartmentId, 10) : null;
                        } else if (targetNode.data.routingType === 'INITIATOR_DEPT' && doc.submitter_id) {
                            const submitterDeptQuery = await pool.query('SELECT department_id FROM users WHERE id = $1', [doc.submitter_id]);
                            nextDepartmentId = submitterDeptQuery.rows[0]?.department_id || null;
                        }
                    } else {
                        nextAssigneeId = targetNode.data?.assignee ? parseInt(targetNode.data.assignee, 10) : null;
                    }
                    isFinalStep = false;
                    break;
                }
            }
        }

        // Save Route State & Trigger Stamp
        if (parallelBranches) {
            // Fan out: set document to point at the parallel node, store all branch data
            const parallelNodeId = parallelBranches[0].parallelNodeId;
            await pool.query(
                'UPDATE documents SET current_node_id = $1, current_assignee_id = NULL, current_role_id = NULL, current_department_id = NULL, parallel_branch_data = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                [parallelNodeId, JSON.stringify(parallelBranches), documentId]
            );
            // Notify all parallel assignees at once (Emails to role-pools isn't trivial, so we stick to explicit assignees for emails here)
            for (const branch of parallelBranches) {
                if (branch.assigneeId) {
                    await sendNotificationEmail(
                        branch.assigneeId,
                        'Parallel Review Required',
                        `A document <b>"${doc.title}"</b> requires your parallel review. All assigned reviewers must approve before the workflow continues.`
                    );
                }
            }
            console.log(`⑂ PARALLEL SPLIT — Fanned out to ${parallelBranches.length} branches`);

        } else if (isFinalStep) {
            await pool.query(
                "UPDATE documents SET status = 'Approved', current_node_id = NULL, current_assignee_id = NULL, current_role_id = NULL, current_department_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                [documentId]
            );

            // FEATURE 2: Fulfill any dependent workflows where THIS document is required
            await pool.query(
                `UPDATE document_prerequisites dp
                 SET fulfilled_by_document_id = $1, fulfilled_at = CURRENT_TIMESTAMP 
                 FROM documents d
                 WHERE dp.required_workflow_id = $2 
                 AND dp.fulfilled_by_document_id IS NULL
                 AND dp.parent_document_id = d.id 
                 AND d.submitter_id = $3`,
                [documentId, doc.workflow_id, doc.submitter_id]
            );

            await sendNotificationEmail(
                doc.submitter_id,
                'Document Fully Approved!',
                `Great news! Your document <b>"${doc.title}"</b> has passed all review stages.`
            );

            // Apply the permanent watermark
            const userQuery = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
            await stampApprovedDocument(doc.file_path, userQuery.rows[0].name);
        } else {
            await pool.query(
                "UPDATE documents SET current_node_id = $1, current_assignee_id = $2, current_role_id = $3, current_department_id = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5",
                [nextNodeId, nextAssigneeId, nextRoleId, nextDepartmentId, documentId]
            );
            if (nextAssigneeId) {
                await sendNotificationEmail(
                    nextAssigneeId,
                    'New Document Ready for Review',
                    `A new document <b>"${doc.title}"</b> has been routed to your queue.`
                );
            }
        }

        const nodeLogLabel = doc.current_node_id || 'System';
        await pool.query(
            "INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Approved', $4)",
            [documentId, req.user.id, nodeLogLabel, comments || 'Verified by 2FA']
        );

        const auditMessage = isFinalStep
            ? 'Document fully Approved via 2FA'
            : `Document Approved - Routed automatically to next step`;
        await pool.query(
            "INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)",
            [documentId, req.user.id, auditMessage]
        );

        await pool.query('COMMIT');
        otpStore.delete(req.user.id);

        res.status(200).json({
            message: isFinalStep
                ? 'Document securely approved'
                : 'Document dynamically routed to next reviewer'
        });

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