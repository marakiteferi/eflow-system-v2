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
/**
 * Decide what one step needs right now. A "slot" is either the document's single
 * current step or one pending parallel branch:
 *   { nodeId, assigneeId, deadline, reminderSent, warningSent, escalated }
 * Returns the actions to take; the caller stores the flags in the right place.
 */
const slaActionFor = (slot, node, now = Date.now()) => {
    if (!slot.deadline || slot.escalated) return null;
    if (isBreached(slot.deadline, now)) return { kind: 'escalate' };
    const warningHours = Math.abs(parseFloat(node?.data?.warningHours)) || null;
    const reminderHours = Math.abs(parseFloat(node?.data?.reminderHours)) || null;
    if (warningHours && !slot.warningSent && isWithinHours(slot.deadline, warningHours, now)) return { kind: 'warning' };
    if (reminderHours && !slot.reminderSent && !slot.warningSent && isWithinHours(slot.deadline, reminderHours, now)) return { kind: 'reminder' };
    return null;
};

/**
 * Who a late step goes to: the target set on the step if there is one, otherwise the head
 * of the office the step belongs to (or of the reviewer's office). Nobody if the head is
 * the one who is late.
 */
const escalationTarget = async (db, node, slot) => {
    if (node?.data?.escalationUserId) return parseInt(node.data.escalationUserId, 10);
    let officeId = slot.officeId || (node?.data?.assignmentStrategy === 'office' ? parseInt(node.data.officeId, 10) : null);
    if (!officeId && slot.assigneeId) {
        const r = await db.query(
            `SELECT o.id FROM office_members m JOIN offices o ON o.id = m.office_id
             WHERE m.user_id = $1 AND o.head_id IS NOT NULL AND o.head_id <> $1 ORDER BY o.id LIMIT 1`,
            [slot.assigneeId]
        );
        officeId = r.rows[0]?.id || null;
    }
    const head = await engine.resolveDelegate(db, await engine.officeHead(db, officeId));
    return head && head !== slot.assigneeId ? head : null;
};

/** The people to remind: the reviewer, or everyone in the office while nobody has claimed it. */
const recipients = async (db, slot) => (slot.assigneeId ? [slot.assigneeId] : engine.officeStaff(db, slot.officeId));

/** Send the alert or perform the escalation for one slot. Returns the slot's new fields. */
const applySlaAction = async (db, doc, slot, action) => {
    if (action.kind === 'warning') {
        for (const userId of await recipients(db, slot)) await notifyUser(db, userId, {
            title: `⚠️ SLA warning: "${doc.title}"`,
            body: `"${doc.title}" is about to miss its review deadline. Immediate action is required.`,
            type: 'danger',
            documentId: doc.id,
        });
        return { warningSent: true, reminderSent: true };
    }
    if (action.kind === 'reminder') {
        for (const userId of await recipients(db, slot)) await notifyUser(db, userId, {
            title: `⏰ Reminder: "${doc.title}"`,
            body: `"${doc.title}" is approaching its review deadline.`,
            type: 'warning',
            documentId: doc.id,
        });
        return { reminderSent: true };
    }

    // Escalation happens once per step; the flag resets when the step changes
    action.target = await escalationTarget(db, action.node, slot);
    const missed = new Date(slot.deadline).toISOString();
    if (!action.target) {
        await db.query('INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)',
            [doc.id, slot.assigneeId, 'SLA Breached — no escalation target or office head for this step']);
        console.warn(`⚠️ SLA breach: document ${doc.id} has no escalation target`);
        return { escalated: true };
    }
    await db.query(
        "INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Auto-Escalated', $4)",
        [doc.id, slot.assigneeId, slot.nodeId, `Deadline missed (${missed}). Reassigned to the escalation target.`]
    );
    await db.query('INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)',
        [doc.id, slot.assigneeId, 'SLA Breached — Reassigned to Escalation Target']);
    await notifyUser(db, action.target, {
        title: `🚨 Escalated to you: "${doc.title}"`,
        body: `"${doc.title}" was escalated to you because its reviewer missed the deadline. Please act on it as soon as possible.`,
        type: 'danger',
        documentId: doc.id,
    });
    console.log(`🚨 SLA breach: document ${doc.id} escalated to user ${action.target}`);
    return { escalated: true, assigneeId: action.target, roleId: null, departmentId: null };
};

const checkDocumentSla = async (db, doc, flow) => {
    // Parallel review: every pending branch has its own deadline
    if (Array.isArray(doc.parallel_branch_data)) {
        let changed = false;
        const branches = [];
        for (const b of doc.parallel_branch_data) {
            const node = getNode(flow, b.nodeId);
            const action = b.status === 'Pending' ? slaActionFor(b, node) : null;
            if (action) action.node = node;
            if (!action) { branches.push(b); continue; }
            branches.push({ ...b, ...(await applySlaAction(db, doc, b, action)) });
            changed = true;
        }
        if (changed) {
            await db.query('UPDATE documents SET parallel_branch_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [JSON.stringify(branches), doc.id]);
        }
        return;
    }

    // A single current step. Only that step's own deadline counts: a step without one is never escalated.
    const slot = {
        nodeId: doc.current_node_id,
        assigneeId: doc.current_assignee_id,
        deadline: doc.delegation_sla_deadline,
        reminderSent: doc.sla_reminder_sent,
        warningSent: doc.sla_warning_sent,
        escalated: doc.sla_escalated,
        officeId: doc.current_office_id,
    };
    const node = getNode(flow, doc.current_node_id);
    const action = slaActionFor(slot, node);
    if (!action) return;
    action.node = node;
    const r = await applySlaAction(db, doc, slot, action);
    if (r.assigneeId) {
        await db.query(
            'UPDATE documents SET current_assignee_id = $1, current_role_id = NULL, current_department_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [r.assigneeId, doc.id]);
    }
    await db.query(
        'UPDATE documents SET sla_reminder_sent = sla_reminder_sent OR $1, sla_warning_sent = sla_warning_sent OR $2, sla_escalated = sla_escalated OR $3 WHERE id = $4',
        [Boolean(r.reminderSent), Boolean(r.warningSent), Boolean(r.escalated), doc.id]);
};

const checkSlas = async () => {
    const docs = await pool.query(`
        SELECT id FROM documents
        WHERE status = 'Pending' AND resume_at IS NULL AND workflow_id IS NOT NULL
          AND (parallel_branch_data IS NOT NULL
               OR (delegation_sla_deadline IS NOT NULL AND sla_escalated = FALSE))`);

    for (const { id } of docs.rows) {
        try {
            await inTransaction(async (db) => {
                // Re-read under a row lock so an approval in progress can't race the escalation
                const doc = (await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id])).rows[0];
                if (!doc || doc.status !== 'Pending' || doc.resume_at) return;
                const flow = await loadFlow(db, doc.workflow_id);
                if (!flow) return;
                await checkDocumentSla(db, doc, flow);
            });
        } catch (err) {
            console.error(`SLA check failed for document ${id}:`, err.message);
        }
    }
};

// Any number to identify this job's lock; all servers must use the same one
const JOB_LOCK_ID = 724001;

/**
 * Run the jobs if no other server is running them right now. A PostgreSQL advisory lock
 * makes this safe with several API servers: only one of them does the work each minute,
 * so nobody gets the same reminder twice.
 */
const runBackgroundJobs = async () => {
    const client = await pool.connect();
    let locked = false;
    try {
        locked = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [JOB_LOCK_ID])).rows[0].ok;
        if (!locked) return false;
        await resumeDelayedDocuments();
        await checkSlas();
        return true;
    } finally {
        if (locked) await client.query('SELECT pg_advisory_unlock($1)', [JOB_LOCK_ID]).catch(() => {});
        client.release();
    }
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
