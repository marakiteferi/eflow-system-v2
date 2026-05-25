require('dotenv').config();
const cron = require('node-cron');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_PORT == 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Insert a persistent in-app notification for a specific user
const insertNotification = async (userId, title, body, type = 'info', documentId = null) => {
    if (!userId) return;
    try {
        await pool.query(
            'INSERT INTO notifications (user_id, title, body, type, document_id) VALUES ($1, $2, $3, $4, $5)',
            [userId, title, body, type, documentId]
        );
    } catch (err) {
        console.error('Failed to insert notification:', err.message);
    }
};

// Send a typed SLA alert email to a user
const sendSlaEmail = async (userId, subject, html) => {
    try {
        const userQuery = await pool.query(
            'SELECT email, name, email_notifications FROM users WHERE id = $1', [userId]
        );
        if (userQuery.rows.length === 0) return;
        const { email, name, email_notifications } = userQuery.rows[0];
        if (email_notifications === false) return;

        await transporter.sendMail({
            from: `"E-flow System" <${process.env.FROM_EMAIL}>`,
            to: email,
            subject,
            html: html.replace(/\{\{name\}\}/g, name)
        });
        console.log(`📧 SLA email sent to ${email} — "${subject}"`);
    } catch (err) {
        console.error('Failed to send SLA email:', err.message);
    }
};

// Send urgent email for fallback escalation
const sendUrgentEmail = async (userId, docTitle) => {
    await sendSlaEmail(
        userId,
        '🚨 URGENT: Escalation Fallback Action Required',
        `<div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #dc2626; border-radius: 8px; max-width: 500px;">
            <h2 style="color: #dc2626;">⚠️ Urgent Escalation</h2>
            <p>Hello {{name}},</p>
            <p style="font-size: 16px; color: #374151;">
                The document <b>"${docTitle}"</b> has been escalated to you as the designated <b>Escalation Fallback</b>.
                All previous reviewers exceeded their SLA deadline.
            </p>
            <p style="font-weight: bold; color: #dc2626;">Your immediate action is required.</p>
            <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
            <p style="font-size: 12px; color: #9ca3af;">Please log in to your dashboard to review and action this document.</p>
        </div>`
    );
};

// Pitfall 3 FIX: SLA is breached when delegation_sla_deadline (or original_sla_deadline) is passed.
const isSlaBreached = (deadline) => {
    if (!deadline) return false;
    return new Date() > new Date(deadline);
};

// Check if a deadline is within a given number of hours from now
const isWithinHours = (deadline, hours) => {
    if (!deadline || !hours || hours <= 0) return false;
    const deadlineMs = new Date(deadline).getTime();
    const nowMs = Date.now();
    return deadlineMs > nowMs && (deadlineMs - nowMs) <= hours * 60 * 60 * 1000;
};

// ─── Main Monitor ─────────────────────────────────────────────────────────────

const startSlaMonitor = () => {
    console.log('⏳ SLA Monitor activated (Staged Alerts mode). Scanning every 5 minutes...');

    cron.schedule('*/5 * * * *', async () => {
        try {
            // Fetch pending docs that have an active SLA clock set
            const pendingDocs = await pool.query(`
                SELECT id, title, workflow_id, current_node_id, current_assignee_id,
                       original_sla_deadline, delegation_sla_deadline,
                       sla_reminder_sent, sla_warning_sent
                FROM documents
                WHERE status = 'Pending'
                  AND (delegation_sla_deadline IS NOT NULL OR original_sla_deadline IS NOT NULL)
            `);

            for (let doc of pendingDocs.rows) {
                if (!doc.workflow_id || !doc.current_node_id) continue;

                // Pitfall 3 FIX: Check delegation clock first; fall back to original clock
                const activeClock = doc.delegation_sla_deadline || doc.original_sla_deadline;

                // ── Load the current node to read reminderHours / warningHours ──────
                const wfQuery = await pool.query(
                    'SELECT flow_structure FROM workflows WHERE id = $1', [doc.workflow_id]
                );
                if (wfQuery.rows.length === 0) continue;
                const flowData = typeof wfQuery.rows[0].flow_structure === 'string'
                    ? JSON.parse(wfQuery.rows[0].flow_structure)
                    : wfQuery.rows[0].flow_structure;

                const nodes = flowData.nodes || [];
                const edges = flowData.edges || [];
                const currentNode = nodes.find(n => n.id === doc.current_node_id);

                const reminderHours = currentNode?.data?.reminderHours
                    ? Math.abs(parseFloat(currentNode.data.reminderHours)) : null;
                const warningHours = currentNode?.data?.warningHours
                    ? Math.abs(parseFloat(currentNode.data.warningHours)) : null;

                const assigneeId = doc.current_assignee_id;

                // ── STAGE 1: Reminder ─────────────────────────────────────────────
                if (reminderHours && !doc.sla_reminder_sent && isWithinHours(activeClock, reminderHours)) {
                    console.log(`🔔 SLA REMINDER: "${doc.title}" — ${reminderHours}h window`);
                    await sendSlaEmail(
                        assigneeId,
                        `⏰ Reminder: Document "${doc.title}" needs your attention`,
                        `<div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #fbbf24; border-radius: 8px; max-width: 500px;">
                            <h2 style="color: #d97706;">⏰ SLA Reminder</h2>
                            <p>Hello {{name}},</p>
                            <p>The document <b>"${doc.title}"</b> is awaiting your review and its deadline is approaching.</p>
                            <p style="color: #6b7280; font-size: 13px;">Please action this soon to avoid escalation.</p>
                        </div>`
                    );
                    await insertNotification(
                        assigneeId,
                        `⏰ SLA Reminder: "${doc.title}"`,
                        `This document is approaching its review deadline. Please action it soon.`,
                        'warning',
                        doc.id
                    );
                    await pool.query(
                        'UPDATE documents SET sla_reminder_sent = TRUE WHERE id = $1', [doc.id]
                    );
                }

                // ── STAGE 2: Warning ──────────────────────────────────────────────
                if (warningHours && !doc.sla_warning_sent && isWithinHours(activeClock, warningHours)) {
                    console.log(`⚠️ SLA WARNING: "${doc.title}" — ${warningHours}h window`);
                    await sendSlaEmail(
                        assigneeId,
                        `⚠️ Warning: "${doc.title}" is about to breach its SLA`,
                        `<div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #f97316; border-radius: 8px; max-width: 500px;">
                            <h2 style="color: #ea580c;">⚠️ Urgent SLA Warning</h2>
                            <p>Hello {{name}},</p>
                            <p>The document <b>"${doc.title}"</b> is <b>critically close to breaching its SLA</b>.</p>
                            <p style="font-weight: bold; color: #dc2626;">Immediate action is required.</p>
                        </div>`
                    );
                    await insertNotification(
                        assigneeId,
                        `⚠️ SLA Warning: "${doc.title}"`,
                        `This document is critically close to breaching its deadline. Immediate action required.`,
                        'danger',
                        doc.id
                    );
                    await pool.query(
                        'UPDATE documents SET sla_warning_sent = TRUE WHERE id = $1', [doc.id]
                    );
                }

                // ── STAGE 3: Breach — Escalate ────────────────────────────────────
                if (!isSlaBreached(activeClock)) continue;

                console.log(`🚨 SLA BREACH: Document "${doc.title}" (ID: ${doc.id}) exceeded deadline. Auto-escalating...`);

                let nextNodeId = null;
                let nextAssigneeId = null;
                let isFinalStep = true;

                const outgoingEdges = edges.filter(e => e.source === doc.current_node_id);
                if (outgoingEdges.length > 0) {
                    const targetNode = nodes.find(n => n.id === outgoingEdges[0].target);
                    if (targetNode) {
                        nextNodeId = targetNode.id;
                        nextAssigneeId = targetNode.data?.assignee ? parseInt(targetNode.data.assignee, 10) : null;
                        isFinalStep = false;
                    }
                }

                await pool.query('BEGIN');

                if (isFinalStep) {
                    // Pitfall 5 FIX: Do NOT auto-approve. Route to designated fallback role instead.
                    const fallbackQuery = await pool.query(`
                        SELECT u.id as user_id
                        FROM users u
                        JOIN dynamic_roles r ON u.role_id = r.id
                        WHERE r.is_escalation_fallback = TRUE AND r.is_active = TRUE
                        LIMIT 1
                    `);

                    if (fallbackQuery.rows.length > 0) {
                        const fallbackUserId = fallbackQuery.rows[0].user_id;
                        await pool.query(`
                            UPDATE documents SET
                                current_assignee_id = $1,
                                current_node_id = NULL,
                                delegation_sla_deadline = NULL,
                                sla_reminder_sent = FALSE,
                                sla_warning_sent = FALSE,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = $2
                        `, [fallbackUserId, doc.id]);

                        await pool.query(
                            `INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)`,
                            [doc.id, doc.current_assignee_id, 'SLA Breached on Final Step — Routed to Escalation Fallback']
                        );
                        await pool.query(
                            `INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Auto-Escalated', $4)`,
                            [doc.id, doc.current_assignee_id, doc.current_node_id, `SLA breached. Original deadline: ${doc.original_sla_deadline}. Routed to fallback.`]
                        );

                        await sendUrgentEmail(fallbackUserId, doc.title);
                        await insertNotification(
                            fallbackUserId,
                            `🚨 Escalated to You: "${doc.title}"`,
                            `This document was escalated because its previous reviewer breached the SLA deadline. Your immediate action is required.`,
                            'danger',
                            doc.id
                        );
                    } else {
                        await pool.query(
                            `INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)`,
                            [doc.id, doc.current_assignee_id, 'SLA CRITICAL: Final step breached but no Escalation Fallback role is configured!']
                        );
                        console.error(`❌ CRITICAL: Document "${doc.title}" has SLA breach on final step but no fallback role is configured!`);
                    }
                } else {
                    // Escalate to next step in workflow
                    const nextNode = nodes.find(n => n.id === nextNodeId);
                    const nextSlaHours = nextNode?.data?.slaHours
                        ? Math.abs(parseFloat(nextNode.data.slaHours)) : null;
                    const newDelegationDeadline = nextSlaHours
                        ? new Date(Date.now() + nextSlaHours * 60 * 60 * 1000).toISOString()
                        : null;

                    await pool.query(`
                        UPDATE documents SET
                            current_node_id = $1,
                            current_assignee_id = $2,
                            delegation_sla_deadline = $3,
                            sla_reminder_sent = FALSE,
                            sla_warning_sent = FALSE,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $4
                    `, [nextNodeId, nextAssigneeId, newDelegationDeadline, doc.id]);

                    await pool.query(
                        `INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)`,
                        [doc.id, doc.current_assignee_id, `SLA Breached — Escalated to next step. New delegation deadline: ${newDelegationDeadline || 'None'}`]
                    );
                    await pool.query(
                        `INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Auto-Escalated', $4)`,
                        [doc.id, doc.current_assignee_id, doc.current_node_id,
                        `SLA breached. Original deadline (frozen): ${doc.original_sla_deadline}. New delegation deadline: ${newDelegationDeadline}`]
                    );

                    if (nextAssigneeId) {
                        await insertNotification(
                            nextAssigneeId,
                            `📥 New Escalated Task: "${doc.title}"`,
                            `This document was escalated to you after its previous reviewer breached the SLA deadline.`,
                            'warning',
                            doc.id
                        );
                    }
                }

                await pool.query('COMMIT');
            }
        } catch (err) {
            console.error('SLA Monitor Error:', err);
            try { await pool.query('ROLLBACK'); } catch (_) { }
        }
    });
};

module.exports = startSlaMonitor;