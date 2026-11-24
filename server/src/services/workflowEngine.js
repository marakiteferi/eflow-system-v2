/**
 * Workflow routing engine.
 *
 * Decides where a document goes when it is submitted, approved, or when a delay
 * timer finishes, using the pure graph logic in workflowGraph.js. This module adds
 * the parts that need the database: picking an approver (load balancing and
 * out-of-office delegation), running email/spawn steps, and saving the new state.
 *
 * Every function takes a `db` argument (a pg client inside a transaction) so a
 * whole approval either succeeds or is rolled back.
 */
const graph = require('./workflowGraph');
const { sendMail, notifyUser } = require('./notifier');

const MAX_SPAWN_DEPTH = 5;

// ── Approver selection ───────────────────────────────────────────────────────

/** Follow out-of-office delegation (A → B → C), stopping on loops. */
const resolveDelegate = async (db, userId) => {
    if (!userId) return null;
    let current = userId;
    const seen = new Set();
    while (current && !seen.has(current)) {
        seen.add(current);
        const r = await db.query('SELECT is_out_of_office, delegate_id FROM users WHERE id = $1', [current]);
        if (r.rows.length === 0) break;
        const { is_out_of_office, delegate_id } = r.rows[0];
        if (is_out_of_office && delegate_id) current = delegate_id;
        else break;
    }
    return current;
};

const officeHead = async (db, officeId) => {
    if (!officeId) return null;
    const r = await db.query('SELECT head_id FROM offices WHERE id = $1', [officeId]);
    return r.rows[0]?.head_id || null;
};

/** Everyone who works from an office's queue: its officers and its head. */
const officeStaff = async (db, officeId) => {
    if (!officeId) return [];
    const r = await db.query(
        `SELECT user_id AS id FROM office_members WHERE office_id = $1
         UNION SELECT head_id FROM offices WHERE id = $1 AND head_id IS NOT NULL`,
        [officeId]
    );
    return r.rows.map((x) => x.id);
};

/** Offices a user belongs to, and the ones they head. */
const loadOfficeMembership = async (db, userId) => {
    const r = await db.query(
        `SELECT office_id AS id, FALSE AS is_head FROM office_members WHERE user_id = $1
         UNION ALL SELECT id, TRUE FROM offices WHERE head_id = $1`,
        [userId]
    );
    return {
        officeIds: [...new Set(r.rows.map((x) => x.id))],
        headOfOfficeIds: r.rows.filter((x) => x.is_head).map((x) => x.id),
    };
};

/**
 * Who should act on a task node:
 *  - "office": the office head, or the office's shared queue (any officer can claim it).
 *  - "role_based": the active user with that role (and department) who has the fewest pending documents.
 *    If nobody holds the role, the task stays open to the role as a pool.
 *  - otherwise: the specific user configured on the node.
 * Either way, out-of-office delegation is applied.
 */
const resolveTaskAssignment = async (db, node, submitterId) => {
    const data = node.data || {};
    if (data.assignmentStrategy === 'office') {
        // Office steps: the head personally, or the office's shared queue for any officer to claim
        const officeId = data.officeId ? parseInt(data.officeId, 10) : null;
        if (data.officePosition === 'head') {
            const head = await officeHead(db, officeId);
            return { assigneeId: await resolveDelegate(db, head), roleId: null, departmentId: null, officeId };
        }
        return { assigneeId: null, roleId: null, departmentId: null, officeId };
    }
    if (data.assignmentStrategy === 'role_based') {
        const roleId = data.roleId ? parseInt(data.roleId, 10) : null;
        let departmentId = null;
        if (data.routingType === 'SPECIFIC') {
            departmentId = data.targetDepartmentId ? parseInt(data.targetDepartmentId, 10) : null;
        } else if (data.routingType === 'INITIATOR_DEPT' && submitterId) {
            const r = await db.query('SELECT department_id FROM users WHERE id = $1', [submitterId]);
            departmentId = r.rows[0]?.department_id || null;
        }

        const params = [roleId];
        let sql = `
            SELECT u.id, COUNT(d.id) AS pending_count
            FROM users u
            LEFT JOIN documents d ON d.current_assignee_id = u.id AND d.status = 'Pending'
            WHERE u.role_id = $1 AND u.is_active = TRUE`;
        if (departmentId) {
            sql += ' AND u.department_id = $2';
            params.push(departmentId);
        }
        sql += ' GROUP BY u.id ORDER BY pending_count ASC, u.id ASC LIMIT 1';

        const lb = await db.query(sql, params);
        if (lb.rows.length > 0) {
            return { assigneeId: await resolveDelegate(db, lb.rows[0].id), roleId: null, departmentId: null };
        }
        return { assigneeId: null, roleId, departmentId };
    }

    const assignee = data.assignee ? parseInt(data.assignee, 10) : null;
    return { assigneeId: await resolveDelegate(db, assignee), roleId: null, departmentId: null };
};

/** Deadline for a task: "escalate after" hours (falls back to the older slaHours field). */
const deadlineFor = (node) => {
    const hours = parseFloat(node?.data?.escalationHours) || parseFloat(node?.data?.slaHours) || null;
    return hours && hours > 0 ? new Date(Date.now() + hours * 3600 * 1000) : null;
};

// ── Side effects ─────────────────────────────────────────────────────────────

const fillTemplate = (text, ctx) =>
    String(text || '')
        .replace(/\{\{submitter_email\}\}/gi, ctx.submitter?.email || '')
        .replace(/\{\{submitter_name\}\}/gi, ctx.submitter?.name || '')
        .replace(/\{\{document_title\}\}/gi, ctx.doc.title || '');

const runEffects = async (db, effects, ctx) => {
    for (const node of effects) {
        if (node.type === 'email') {
            const to = fillTemplate(node.data?.recipient, ctx).trim();
            if (!to) continue;
            const body = fillTemplate(node.data?.body, ctx);
            await sendMail({
                to,
                subject: fillTemplate(node.data?.subject || 'E-flow Notification', ctx),
                html: `<div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px; max-width: 500px;">
                         <h2 style="color: #4f46e5;">E-flow Notification</h2>
                         <p style="font-size: 16px; color: #374151; white-space: pre-line;">${body}</p>
                       </div>`,
            });
        } else if (node.type === 'spawn') {
            await spawnWorkflows(db, node, ctx);
        }
    }
};

/** Create a new document for `workflowId`, owned by the parent's submitter, and route it. */
const spawnWorkflow = async (db, workflowId, parentDoc, ctx = {}) => {
    const wf = await db.query('SELECT name, flow_structure FROM workflows WHERE id = $1', [workflowId]);
    if (wf.rows.length === 0) return null;
    const inserted = await db.query(
        `INSERT INTO documents (title, submitter_id, workflow_id, status, file_path, extracted_text)
         VALUES ($1, $2, $3, 'Pending', $4, $5) RETURNING *`,
        [`${wf.rows[0].name}: ${parentDoc.title}`, parentDoc.submitter_id, workflowId, parentDoc.file_path, parentDoc.extracted_text]
    );
    const child = inserted.rows[0];
    await startDocument(db, child, graph.parseFlow(wf.rows[0].flow_structure), { spawnDepth: (ctx.spawnDepth || 0) + 1 });
    await db.query('INSERT INTO audit_logs (document_id, action) VALUES ($1, $2)', [child.id, `Started automatically by "${parentDoc.title}"`]);
    return child;
};

/** Spawn node: start each selected workflow. */
const spawnWorkflows = async (db, node, ctx) => {
    if ((ctx.spawnDepth || 0) >= MAX_SPAWN_DEPTH) return;
    const ids = String(node.data?.spawnIds || '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));
    for (const workflowId of ids) await spawnWorkflow(db, workflowId, ctx.doc, ctx);
};

// ── Applying an outcome ──────────────────────────────────────────────────────

/** The columns that describe where a document currently is. */
const emptyState = () => ({
    status: 'Pending',
    current_node_id: null,
    current_assignee_id: null,
    current_role_id: null,
    current_department_id: null,
    current_office_id: null,
    parallel_branch_data: null,
    resume_at: null,
    delegation_sla_deadline: null,
});

const buildBranch = async (db, branchOutcome, parallelNodeId, doc) => {
    if (branchOutcome.kind === 'task') {
        const a = await resolveTaskAssignment(db, branchOutcome.node, doc.submitter_id);
        return {
            parallelNodeId,
            nodeId: branchOutcome.node.id,
            assigneeId: a.assigneeId,
            roleId: a.roleId,
            departmentId: a.departmentId,
            officeId: a.officeId || null,
            status: 'Pending',
            deadline: deadlineFor(branchOutcome.node),
        };
    }
    // The branch reached a merge gate or the end without needing anyone
    return {
        parallelNodeId,
        nodeId: null,
        joinNodeId: branchOutcome.kind === 'join' ? branchOutcome.node.id : null,
        status: 'Approved',
    };
};

/**
 * Turn a graph outcome into the document's new state, running side effects along the way.
 * Returns { state, assigned: [userIds to notify], completed: boolean }.
 */
const applyOutcome = async (db, doc, flow, outcome, ctx = {}) => {
    const submitter = doc.submitter_id
        ? (await db.query('SELECT name, email FROM users WHERE id = $1', [doc.submitter_id])).rows[0]
        : null;
    await runEffects(db, outcome.effects || [], { ...ctx, doc, submitter });

    const state = emptyState();
    const assigned = [];

    if (outcome.kind === 'task') {
        const a = await resolveTaskAssignment(db, outcome.node, doc.submitter_id);
        state.current_node_id = outcome.node.id;
        state.current_assignee_id = a.assigneeId;
        state.current_role_id = a.roleId;
        state.current_department_id = a.departmentId;
        state.current_office_id = a.officeId || null;
        state.delegation_sla_deadline = deadlineFor(outcome.node);
        if (a.assigneeId) assigned.push(a.assigneeId);
        else if (a.officeId) assigned.push(...(await officeStaff(db, a.officeId)));
        return { state, assigned, completed: false };
    }

    if (outcome.kind === 'delay') {
        state.current_node_id = outcome.node.id;
        state.resume_at = new Date(Date.now() + outcome.hours * 3600 * 1000);
        return { state, assigned, completed: false };
    }

    if (outcome.kind === 'parallel') {
        const branches = [];
        for (const b of outcome.branches) branches.push(await buildBranch(db, b, outcome.node.id, doc));

        if (branches.every((b) => b.status === 'Approved')) {
            // Nothing for anyone to do in any branch: continue straight past the merge gate
            const joinId = branches.find((b) => b.joinNodeId)?.joinNodeId;
            const after = joinId ? graph.leaveNode(flow, joinId, { tag: doc.metadata_tag }) : { kind: 'end', effects: [] };
            return applyOutcome(db, doc, flow, after, ctx);
        }

        state.current_node_id = outcome.node.id;
        state.parallel_branch_data = branches;
        for (const b of branches) {
            if (b.status !== 'Pending') continue;
            if (b.assigneeId) assigned.push(b.assigneeId);
            else if (b.officeId) assigned.push(...(await officeStaff(db, b.officeId)));
        }
        return { state, assigned, completed: false };
    }

    // 'end' (or a stray 'join' outside a parallel split): the workflow is complete
    state.status = 'Approved';
    return { state, assigned, completed: true };
};

const saveState = async (db, documentId, state) => {
    await db.query(
        `UPDATE documents SET
            status = $1, current_node_id = $2, current_assignee_id = $3, current_role_id = $4,
            current_department_id = $5, parallel_branch_data = $6, resume_at = $7,
            delegation_sla_deadline = $8, sla_reminder_sent = FALSE, sla_warning_sent = FALSE,
            sla_escalated = FALSE, current_office_id = $10, updated_at = CURRENT_TIMESTAMP
         WHERE id = $9`,
        [
            state.status,
            state.current_node_id,
            state.current_assignee_id,
            state.current_role_id,
            state.current_department_id,
            state.parallel_branch_data ? JSON.stringify(state.parallel_branch_data) : null,
            state.resume_at,
            state.delegation_sla_deadline,
            documentId,
            state.current_office_id || null,
        ]
    );
};

const notifyAssigned = async (db, doc, userIds, heading = 'New document ready for review') => {
    for (const userId of new Set(userIds)) {
        await notifyUser(db, userId, {
            title: heading,
            body: `"${doc.title}" has been routed to your queue.`,
            type: 'info',
            documentId: doc.id,
        });
    }
};

// ── Public API ───────────────────────────────────────────────────────────────

/** Route a newly submitted (or resubmitted, or spawned) document to its first step. */
const startDocument = async (db, doc, flow, ctx = {}) => {
    const start = graph.findStartNode(flow);
    const outcome = start ? graph.enterNode(flow, start.id, { tag: doc.metadata_tag }) : { kind: 'end', effects: [] };
    const result = await applyOutcome(db, doc, flow, outcome, ctx);
    // The SLA clock for the whole document starts now
    await db.query('UPDATE documents SET original_sla_deadline = $1 WHERE id = $2', [result.state.delegation_sla_deadline, doc.id]);
    await saveState(db, doc.id, result.state);
    await notifyAssigned(db, doc, result.assigned);
    return result;
};

/** Find the parallel branch (index) this user may act on, or -1. Super admins may act on any pending branch. */
const inOffice = (user, officeId) => Boolean(officeId) && (user.officeIds || []).includes(officeId);
const headsOffice = (user, officeId) => Boolean(officeId) && (user.headOfOfficeIds || []).includes(officeId);

/**
 * Whether `user` holds a step described by (assigneeId, roleId, departmentId, officeId).
 * Office steps: once claimed, the claimer (or the office head); before that, anyone in the office.
 */
const holdsStep = (user, { assigneeId, roleId, departmentId, officeId }) => {
    if (assigneeId) return assigneeId === user.id || headsOffice(user, officeId);
    if (officeId) return inOffice(user, officeId);
    return roleId != null && roleId === user.role_id && (!departmentId || departmentId === user.department_id);
};

const findBranchForUser = (branches, user) => {
    const pending = (b) => b.status === 'Pending';
    // Prefer a branch assigned to this user personally, then one they can act on through a role or office
    let i = branches.findIndex((b) => pending(b) && b.assigneeId === user.id);
    if (i === -1) i = branches.findIndex((b) => pending(b) && holdsStep(user, b));
    if (i === -1 && user.role_id === 3) i = branches.findIndex(pending);
    return i;
};

/** Whether `user` (with role_id and department_id) may approve or reject the document right now. */
const canActOn = (doc, user) => {
    if (doc.status !== 'Pending' || doc.resume_at) return false;
    if (user.role_id === 3) return true;
    if (Array.isArray(doc.parallel_branch_data)) return findBranchForUser(doc.parallel_branch_data, user) !== -1;
    return holdsStep(user, {
        assigneeId: doc.current_assignee_id,
        roleId: doc.current_role_id,
        departmentId: doc.current_department_id,
        officeId: doc.current_office_id,
    });
};

/**
 * Move a document on after `user` approves its current step.
 * Returns { completed, waitingOnBranches, nodeId } where nodeId is the step that was approved.
 */
const advanceAfterApproval = async (db, doc, flow, user) => {
    const tag = doc.metadata_tag;

    if (Array.isArray(doc.parallel_branch_data)) {
        const branches = doc.parallel_branch_data.map((b) => ({ ...b }));
        const idx = findBranchForUser(branches, user);
        if (idx === -1) throw new Error('No pending parallel branch for this user.');
        const branch = branches[idx];
        const approvedNodeId = branch.nodeId;

        // Walk this branch onward: it may have more steps before the merge gate
        const next = graph.leaveNode(flow, branch.nodeId, { tag, inBranch: true });
        const submitter = (await db.query('SELECT name, email FROM users WHERE id = $1', [doc.submitter_id])).rows[0];
        await runEffects(db, next.effects, { doc, submitter });

        if (next.kind === 'task') {
            const a = await resolveTaskAssignment(db, next.node, doc.submitter_id);
            branches[idx] = {
                parallelNodeId: branch.parallelNodeId, nodeId: next.node.id, status: 'Pending',
                assigneeId: a.assigneeId, roleId: a.roleId, departmentId: a.departmentId, officeId: a.officeId || null,
                deadline: deadlineFor(next.node), // each step in a branch gets its own deadline
            };
            const who = a.assigneeId ? [a.assigneeId] : await officeStaff(db, a.officeId);
            await notifyAssigned(db, doc, who, 'Parallel review required');
        } else {
            branches[idx] = { ...branch, status: 'Approved', joinNodeId: next.kind === 'join' ? next.node.id : branch.joinNodeId || null };
        }

        if (!branches.every((b) => b.status === 'Approved')) {
            await db.query(
                'UPDATE documents SET parallel_branch_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [JSON.stringify(branches), doc.id]
            );
            return { completed: false, waitingOnBranches: true, nodeId: approvedNodeId };
        }

        // Every branch is done: continue after the merge gate
        const joinId = branches.find((b) => b.joinNodeId)?.joinNodeId;
        const after = joinId ? graph.leaveNode(flow, joinId, { tag }) : { kind: 'end', effects: [] };
        const result = await applyOutcome(db, doc, flow, after);
        await saveState(db, doc.id, result.state);
        await notifyAssigned(db, doc, result.assigned);
        return { completed: result.completed, waitingOnBranches: false, nodeId: approvedNodeId };
    }

    const approvedNodeId = doc.current_node_id;
    const outcome = approvedNodeId ? graph.leaveNode(flow, approvedNodeId, { tag }) : { kind: 'end', effects: [] };
    const result = await applyOutcome(db, doc, flow, outcome);
    await saveState(db, doc.id, result.state);
    await notifyAssigned(db, doc, result.assigned);
    return { completed: result.completed, waitingOnBranches: false, nodeId: approvedNodeId };
};

/** Continue a document whose delay timer has finished. */
const resumeAfterDelay = async (db, doc, flow) => {
    const outcome = graph.leaveNode(flow, doc.current_node_id, { tag: doc.metadata_tag });
    const result = await applyOutcome(db, doc, flow, outcome);
    await saveState(db, doc.id, result.state);
    await notifyAssigned(db, doc, result.assigned);
    return result;
};

module.exports = {
    resolveDelegate,
    spawnWorkflow,
    resolveTaskAssignment,
    startDocument,
    advanceAfterApproval,
    resumeAfterDelay,
    canActOn,
    findBranchForUser,
    officeHead,
    officeStaff,
    loadOfficeMembership,
};
