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

// Send urgent email for fallback escalation
const sendUrgentEmail = async (userId, docTitle) => {
    try {
        const userQuery = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
        if (userQuery.rows.length === 0) return;
        const { email, name } = userQuery.rows[0];
        await transporter.sendMail({
            from: `"E-flow System" <${process.env.FROM_EMAIL}>`,
            to: email,
            subject: '🚨 URGENT: Escalation Fallback Action Required',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #dc2626; border-radius: 8px; max-width: 500px;">
                    <h2 style="color: #dc2626;">⚠️ Urgent Escalation</h2>
                    <p>Hello ${name},</p>
                    <p style="font-size: 16px; color: #374151;">
                        The document <b>"${docTitle}"</b> has been escalated to you as the designated <b>Escalation Fallback</b>.
                        All previous reviewers exceeded their SLA deadline.
                    </p>
                    <p style="font-weight: bold; color: #dc2626;">Your immediate action is required.</p>
                    <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
                    <p style="font-size: 12px; color: #9ca3af;">Please log in to your dashboard to review and action this document.</p>
                </div>
            `
        });
        console.log(`📧 URGENT escalation email sent to ${email}`);
    } catch (err) {
        console.error('Failed to send urgent escalation email:', err.message);
    }
};

// Pitfall 3 FIX: SLA is breached when delegation_sla_deadline (or original_sla_deadline) is passed.
// We no longer use updated_at as the clock — we use the explicit deadline columns.
const isSlaBreached = (deadline) => {
    if (!deadline) return false;
    return new Date() > new Date(deadline);
};

// The Monitoring Engine
const startSlaMonitor = () => {
    console.log('⏳ SLA Monitor activated (Dual-Clock mode). Scanning every 5 minutes...');

    cron.schedule('*/5 * * * *', async () => {
        try {
            // Fetch pending docs that have an active SLA clock set
            const pendingDocs = await pool.query(`
                SELECT id, title, workflow_id, current_node_id, current_assignee_id,
                       original_sla_deadline, delegation_sla_deadline
                FROM documents
                WHERE status = 'Pending'
                  AND (delegation_sla_deadline IS NOT NULL OR original_sla_deadline IS NOT NULL)
            `);

            for (let doc of pendingDocs.rows) {
                if (!doc.workflow_id || !doc.current_node_id) continue;

                // Pitfall 3 FIX: Check delegation clock first; fall back to original clock
                const activeClock = doc.delegation_sla_deadline || doc.original_sla_deadline;
                if (!isSlaBreached(activeClock)) continue;

                console.log(`🚨 SLA BREACH: Document "${doc.title}" (ID: ${doc.id}) exceeded deadline. Auto-escalating...`);

                const wfQuery = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [doc.workflow_id]);
                if (wfQuery.rows.length === 0) continue;

                const flowData = typeof wfQuery.rows[0].flow_structure === 'string'
                    ? JSON.parse(wfQuery.rows[0].flow_structure)
                    : wfQuery.rows[0].flow_structure;

                const edges = flowData.edges || [];
                const nodes = flowData.nodes || [];

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

                        // Send urgent email notification to fallback user
                        await sendUrgentEmail(fallbackUserId, doc.title);
                    } else {
                        // No fallback configured — log a critical warning but do NOT auto-approve
                        await pool.query(
                            `INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)`,
                            [doc.id, doc.current_assignee_id, 'SLA CRITICAL: Final step breached but no Escalation Fallback role is configured!']
                        );
                        console.error(`❌ CRITICAL: Document "${doc.title}" has SLA breach on final step but no fallback role is configured!`);
                    }
                } else {
                    // Escalate to next step in workflow
                    // Pitfall 3 FIX: Calculate a fresh delegation_sla_deadline for the new assignee.
                    // The original_sla_deadline is NEVER touched — it is frozen permanently.
                    const nextNode = nodes.find(n => n.id === nextNodeId);
                    const nextSlaHours = nextNode?.data?.slaHours ? parseFloat(nextNode.data.slaHours) : null;
                    const newDelegationDeadline = nextSlaHours
                        ? new Date(Date.now() + nextSlaHours * 60 * 60 * 1000).toISOString()
                        : null;

                    await pool.query(`
                        UPDATE documents SET
                            current_node_id = $1,
                            current_assignee_id = $2,
                            delegation_sla_deadline = $3,
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