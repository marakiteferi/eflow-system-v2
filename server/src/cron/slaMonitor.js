/**
 * Background jobs, run every few minutes:
 *  1. Resume documents whose delay timer has finished.
 *  2. SLA monitoring for approval steps: a reminder, then a warning, then escalation
 *     to the step's configured escalation target once the deadline passes.
 *
 * Each step's deadline is set by the routing engine when the step is assigned
 * (documents.delegation_sla_deadline), from the node's "escalate after" hours.
 */
const cron = require('node-cron');
const pool = require('../db');
const engine = require('../services/workflowEngine');
const { parseFlow, getNode } = require('../services/workflowGraph');
const { notifyUser } = require('../services/notifier');

const HOUR = 3600 * 1000;

/** True when the deadline is still ahead but no more than `hours` away. */
const isWithinHours = (deadline, hours, now = Date.now()) => {
    if (!deadline || !hours || hours <= 0) return false;
    const remaining = new Date(deadline).getTime() - now;
    return remaining > 0 && remaining <= hours * HOUR;
};

const isBreached = (deadline, now = Date.now()) => Boolean(deadline) && now > new Date(deadline).getTime();

const loadFlow = async (db, workflowId) => {
    const r = await db.query('SELECT flow_structure FROM workflows WHERE id = $1', [workflowId]);
    return r.rows[0] ? parseFlow(r.rows[0].flow_structure) : null;
};

/** Run `fn` inside a transaction on its own connection. */
const inTransaction = async (fn) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// ── 1. Delay timers ──────────────────────────────────────────────────────────
const resumeDelayedDocuments = async () => {
    const due = await pool.query(
        "SELECT id FROM documents WHERE status = 'Pending' AND resume_at IS NOT NULL AND resume_at <= NOW()"
    );
    for (const { id } of due.rows) {
        try {
            await inTransaction(async (db) => {
                const doc = (await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id])).rows[0];
                if (!doc || !doc.resume_at || doc.status !== 'Pending') return; // handled elsewhere meanwhile
                const flow = await loadFlow(db, doc.workflow_id);
                await engine.resumeAfterDelay(db, doc, flow || parseFlow(null));
                await db.query("INSERT INTO audit_logs (document_id, action) VALUES ($1, 'Delay finished — workflow resumed')", [doc.id]);
            });
            console.log(`⏩ Delay finished for document ${id}, workflow resumed`);
        } catch (err) {
            console.error(`Failed to resume document ${id}:`, err.message);
        }
    }
};

// ── 2. SLA alerts and escalation ─────────────────────────────────────────────
const checkSlas = async () => {
    const docs = await pool.query(`
        SELECT * FROM documents
        WHERE status = 'Pending' AND resume_at IS NULL AND sla_escalated = FALSE
          AND COALESCE(delegation_sla_deadline, original_sla_deadline) IS NOT NULL`);

    for (const doc of docs.rows) {
        if (!doc.workflow_id || !doc.current_node_id) continue;
        try {
            await inTransaction(async (db) => {
                const flow = await loadFlow(db, doc.workflow_id);
                const node = flow ? getNode(flow, doc.current_node_id) : null;
                const deadline = doc.delegation_sla_deadline || doc.original_sla_deadline;
                const reminderHours = Math.abs(parseFloat(node?.data?.reminderHours)) || null;
                const warningHours = Math.abs(parseFloat(node?.data?.warningHours)) || null;
                const assignee = doc.current_assignee_id;

                if (isBreached(deadline)) {
                    const target = node?.data?.escalationUserId ? parseInt(node.data.escalationUserId, 10) : null;
                    // Escalate once per step; the flag resets when the document moves to its next step
                    await db.query('UPDATE documents SET sla_escalated = TRUE WHERE id = $1', [doc.id]);

                    if (target) {
                        await db.query(
                            'UPDATE documents SET current_assignee_id = $1, current_role_id = NULL, current_department_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                            [target, doc.id]
                        );
                        await db.query(
                            "INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Auto-Escalated', $4)",
                            [doc.id, assignee, doc.current_node_id, `Deadline missed (${new Date(deadline).toISOString()}). Reassigned to the escalation target.`]
                        );
                        await db.query(
                            'INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)',
                            [doc.id, assignee, 'SLA Breached — Reassigned to Escalation Target']
                        );
                        await notifyUser(db, target, {
                            title: `🚨 Escalated to you: "${doc.title}"`,
                            body: `"${doc.title}" was escalated to you because its reviewer missed the deadline. Please act on it as soon as possible.`,
                            type: 'danger',
                            documentId: doc.id,
                        });
                        console.log(`🚨 SLA breach: document ${doc.id} escalated to user ${target}`);
                    } else {
                        await db.query(
                            'INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)',
                            [doc.id, assignee, 'SLA Breached — no escalation target configured for this step']
                        );
                        console.warn(`⚠️ SLA breach: document ${doc.id} has no escalation target`);
                    }
                    return;
                }

                if (warningHours && !doc.sla_warning_sent && isWithinHours(deadline, warningHours)) {
                    await db.query('UPDATE documents SET sla_warning_sent = TRUE, sla_reminder_sent = TRUE WHERE id = $1', [doc.id]);
                    await notifyUser(db, assignee, {
                        title: `⚠️ SLA warning: "${doc.title}"`,
                        body: `"${doc.title}" is about to miss its review deadline. Immediate action is required.`,
                        type: 'danger',
                        documentId: doc.id,
                    });
                } else if (reminderHours && !doc.sla_reminder_sent && isWithinHours(deadline, reminderHours)) {
                    await db.query('UPDATE documents SET sla_reminder_sent = TRUE WHERE id = $1', [doc.id]);
                    await notifyUser(db, assignee, {
                        title: `⏰ Reminder: "${doc.title}"`,
                        body: `"${doc.title}" is approaching its review deadline.`,
                        type: 'warning',
                        documentId: doc.id,
                    });
                }
            });
        } catch (err) {
            console.error(`SLA check failed for document ${doc.id}:`, err.message);
        }
    }
};

const runBackgroundJobs = async () => {
    await resumeDelayedDocuments();
    await checkSlas();
};

const startSlaMonitor = () => {
    console.log('⏳ Background jobs active (delay timers and SLA monitoring), checking every minute.');
    cron.schedule('* * * * *', () => {
        runBackgroundJobs().catch((err) => console.error('Background job error:', err));
    });
};

module.exports = startSlaMonitor;
module.exports.runBackgroundJobs = runBackgroundJobs;
module.exports.isWithinHours = isWithinHours;
