/**
 * End-to-end routing tests: real Express app, real PostgreSQL, real PDFs.
 * Skipped automatically when no database is reachable.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const h = require('./helpers');

const skip = h.databaseAvailable() ? false : 'PostgreSQL is not reachable (see server/.env)';

test('workflow routing', { skip, concurrency: false }, async (t) => {
    await h.setup();
    t.after(h.teardown);

    // Demo accounts created by db/setup.js
    const admin = await h.login('admin@example.com');
    const staff = await h.login('staff@example.com');
    const staff2 = await h.login('staff2@example.com');
    const student = await h.login('abebe@example.com');
    const A = admin.user.id, S1 = staff.user.id, S2 = staff2.user.id;

    await t.test('linear workflow: each step goes to the right person and the result is signed and stamped', async () => {
        const wf = await h.createWorkflow(admin.token, 'Linear', [h.task('first', S1), h.task('second', S2)], [h.edge('first', 'second')]);
        const doc = await h.submit(student.token, wf.id, { title: 'Linear request' });
        assert.equal(doc.current_assignee_id, S1);

        assert.equal((await h.approve(staff.token, doc.id)).status, 200);
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, S2);

        const final = await h.approve(staff2.token, doc.id);
        assert.equal(final.status, 200);
        assert.match(final.data.message, /securely approved/);
        const done = await h.getDoc(doc.id);
        assert.equal(done.status, 'Approved');
        assert.ok(done.final_file_hash, 'the stamped file hash is recorded');

        const { PDFDocument } = require('pdf-lib');
        const pdf = await PDFDocument.load(fs.readFileSync(done.file_path));
        assert.equal(pdf.getPageCount(), 2, 'a certificate page was appended');

        const chain = await h.api('GET', `/documents/${doc.id}/verify-chain`, { token: staff.token });
        assert.equal(chain.data.chain_valid, true);
        assert.equal(chain.data.file_intact, true);
        assert.equal(chain.data.approvals.length, 2);
    });

    await t.test('only the current approver can approve or reject', async () => {
        const wf = await h.createWorkflow(admin.token, 'Auth checks', [h.task('only', S1)], []);
        const doc = await h.submit(student.token, wf.id);

        assert.equal((await h.reject(student.token, doc.id)).status, 403, 'a student cannot reject');
        assert.equal((await h.reject(staff2.token, doc.id)).status, 403, 'another staff member cannot reject');
        assert.equal((await h.approve(staff2.token, doc.id)).status, 403, 'another staff member cannot approve');

        assert.equal((await h.reject(staff.token, doc.id, 'Wrong form')).status, 200);
        const rejected = await h.getDoc(doc.id);
        assert.equal(rejected.status, 'Rejected');
        assert.equal((await h.approve(staff.token, doc.id)).status, 403, 'a rejected document cannot be approved');
    });

    await t.test('resubmitting a rejected document restarts the workflow and keeps the old version', async () => {
        const wf = await h.createWorkflow(admin.token, 'Resubmit', [h.task('review', S1)], []);
        const doc = await h.submit(student.token, wf.id);
        await h.reject(staff.token, doc.id);

        const form = new FormData();
        form.append('document', new Blob([await h.makePdf('Fixed')], { type: 'application/pdf' }), 'fixed.pdf');
        const r = await h.api('PUT', `/documents/resubmit/${doc.id}`, { token: student.token, form });
        assert.equal(r.status, 200);
        const again = await h.getDoc(doc.id);
        assert.equal(again.status, 'Pending');
        assert.equal(again.current_assignee_id, S1);
        const versions = await h.api('GET', `/documents/${doc.id}/versions`, { token: student.token });
        assert.equal(versions.data.length, 1);
        assert.equal(versions.data[0].rejection_reason, 'Missing signature page');

        // The chain still verifies after a rejection and a resubmission
        assert.equal((await h.approve(staff.token, doc.id)).status, 200);
        const chain = await h.api('GET', `/documents/${doc.id}/verify-chain`, { token: staff.token });
        assert.equal(chain.data.chain_valid, true);
    });

    await t.test('condition routes on the document tag', async () => {
        const wf = await h.createWorkflow(admin.token, 'Condition',
            [h.node('check', 'condition', { conditionValue: 'thesis' }), h.task('yes', S1), h.task('no', S2)],
            [h.edge('check', 'yes', 'true'), h.edge('check', 'no', 'false')]);
        assert.equal((await h.submit(student.token, wf.id, { tag: 'Thesis' })).current_assignee_id, S1);
        assert.equal((await h.submit(student.token, wf.id)).current_assignee_id, S2);
    });

    await t.test('a workflow that starts with a condition or an email step is not stranded', async () => {
        const wf = await h.createWorkflow(admin.token, 'Starts with email',
            [h.node('mail', 'email', { recipient: '{{submitter_email}}', subject: 'Received' }), h.task('review', S1)],
            [h.edge('mail', 'review')]);
        const doc = await h.submit(student.token, wf.id);
        assert.equal(doc.current_node_id, 'review');
        assert.equal(doc.current_assignee_id, S1);
    });

    await t.test('parallel branches (including a two-step branch) all finish before the merge gate continues', async () => {
        const wf = await h.createWorkflow(admin.token, 'Parallel',
            [
                h.node('split', 'parallel'),
                h.task('library', S1),
                h.task('finance1', S2), h.task('finance2', A),
                h.node('merge', 'join'),
                h.task('registrar', S1),
            ],
            [
                h.edge('split', 'library'), h.edge('split', 'finance1'),
                h.edge('library', 'merge'),
                h.edge('finance1', 'finance2'), h.edge('finance2', 'merge'),
                h.edge('merge', 'registrar'),
            ]);
        const doc = await h.submit(student.token, wf.id);
        let d = await h.getDoc(doc.id);
        assert.deepEqual(d.parallel_branch_data.map((b) => b.assigneeId), [S1, S2]);

        assert.match((await h.approve(staff.token, doc.id)).data.message, /waiting for other reviewers/);
        assert.equal((await h.approve(staff.token, doc.id)).status, 403, 'cannot approve the same branch twice');

        await h.approve(staff2.token, doc.id);
        d = await h.getDoc(doc.id);
        assert.equal(d.parallel_branch_data[1].nodeId, 'finance2', 'the second step of the branch is now active');
        assert.equal(d.parallel_branch_data[1].assigneeId, A);

        await h.approve(admin.token, doc.id);
        d = await h.getDoc(doc.id);
        assert.equal(d.parallel_branch_data, null);
        assert.equal(d.current_node_id, 'registrar');
        assert.equal(d.current_assignee_id, S1);

        await h.approve(staff.token, doc.id);
        assert.equal((await h.getDoc(doc.id)).status, 'Approved');
    });

    await t.test('role-based steps go to the least busy person with that role', async () => {
        const wf = await h.createWorkflow(admin.token, 'Role based', [h.roleTask('any-staff', 2)], []);
        const pendingFor = async (id) => (await h.pool.query(
            "SELECT COUNT(*)::int AS n FROM documents WHERE current_assignee_id = $1 AND status = 'Pending'", [id])).rows[0].n;

        // Balance the two staff queues, then each new request should alternate between them
        let diff = (await pendingFor(S1)) - (await pendingFor(S2));
        await h.pool.query(
            "UPDATE documents SET status = 'Approved' WHERE id IN (SELECT id FROM documents WHERE current_assignee_id = $1 AND status = 'Pending' LIMIT $2)",
            [diff > 0 ? S1 : S2, Math.abs(diff)]
        );
        const first = await h.submit(student.token, wf.id);
        const second = await h.submit(student.token, wf.id);
        assert.ok([S1, S2].includes(first.current_assignee_id));
        assert.ok([S1, S2].includes(second.current_assignee_id));
        assert.notEqual(first.current_assignee_id, second.current_assignee_id, 'work is spread across staff');
    });

    await t.test('out-of-office approvers are skipped in favour of their delegate', async () => {
        await h.pool.query('UPDATE users SET is_out_of_office = TRUE, delegate_id = $1 WHERE id = $2', [S2, S1]);
        try {
            const wf = await h.createWorkflow(admin.token, 'Delegation', [h.task('review', S1)], []);
            const doc = await h.submit(student.token, wf.id);
            assert.equal(doc.current_assignee_id, S2);
        } finally {
            await h.pool.query('UPDATE users SET is_out_of_office = FALSE, delegate_id = NULL WHERE id = $1', [S1]);
        }
    });

    await t.test('a delay pauses the document and the background job resumes it', async () => {
        const { runBackgroundJobs } = require('../../src/cron/slaMonitor');
        const wf = await h.createWorkflow(admin.token, 'Delay',
            [h.task('before', S1), h.node('wait', 'delay', { delayHours: '1' }), h.task('after', S2)],
            [h.edge('before', 'wait'), h.edge('wait', 'after')]);
        const doc = await h.submit(student.token, wf.id);
        await h.approve(staff.token, doc.id);
        let d = await h.getDoc(doc.id);
        assert.equal(d.current_node_id, 'wait');
        assert.ok(d.resume_at);
        assert.equal((await h.approve(admin.token, doc.id)).status, 403, 'nobody can approve while the timer runs');

        await runBackgroundJobs();
        assert.equal((await h.getDoc(doc.id)).current_node_id, 'wait', 'not resumed before the timer ends');

        await h.pool.query("UPDATE documents SET resume_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [doc.id]);
        await runBackgroundJobs();
        d = await h.getDoc(doc.id);
        assert.equal(d.current_node_id, 'after');
        assert.equal(d.current_assignee_id, S2);
        assert.equal(d.resume_at, null);
    });

    await t.test('a missed deadline escalates once, to the configured target', async () => {
        const { runBackgroundJobs } = require('../../src/cron/slaMonitor');
        const wf = await h.createWorkflow(admin.token, 'SLA',
            [h.task('slow', S1, { escalationHours: 2, escalationUserId: String(A) })], []);
        const doc = await h.submit(student.token, wf.id);
        assert.ok((await h.getDoc(doc.id)).delegation_sla_deadline, 'the step has a deadline');

        await h.pool.query("UPDATE documents SET delegation_sla_deadline = NOW() - INTERVAL '1 minute' WHERE id = $1", [doc.id]);
        await runBackgroundJobs();
        await runBackgroundJobs();
        const d = await h.getDoc(doc.id);
        assert.equal(d.current_assignee_id, A);
        const escalations = await h.pool.query("SELECT COUNT(*)::int AS n FROM approvals WHERE document_id = $1 AND status = 'Auto-Escalated'", [doc.id]);
        assert.equal(escalations.rows[0].n, 1, 'escalated exactly once');
    });

    await t.test('the next step gets its own deadline instead of inheriting the first one', async () => {
        const wf = await h.createWorkflow(admin.token, 'Per-step SLA',
            [h.task('a', S1, { escalationHours: 1, escalationUserId: String(A) }), h.task('b', S2)],
            [h.edge('a', 'b')]);
        const doc = await h.submit(student.token, wf.id);
        await h.approve(staff.token, doc.id);
        assert.equal((await h.getDoc(doc.id)).delegation_sla_deadline, null, 'step b has no deadline configured');
    });

    await t.test('spawn steps start the selected workflows for the same student', async () => {
        const child = await h.createWorkflow(admin.token, 'ID card', [h.task('issue', S2)], []);
        const wf = await h.createWorkflow(admin.token, 'Graduation',
            [h.task('approve', S1), h.node('start-id', 'spawn', { spawnIds: String(child.id) })],
            [h.edge('approve', 'start-id')]);
        const doc = await h.submit(student.token, wf.id, { title: 'Graduation' });
        await h.approve(staff.token, doc.id);
        assert.equal((await h.getDoc(doc.id)).status, 'Approved');
        const spawned = await h.pool.query('SELECT * FROM documents WHERE workflow_id = $1', [child.id]);
        assert.equal(spawned.rows.length, 1);
        assert.equal(spawned.rows[0].submitter_id, student.user.id);
        assert.equal(spawned.rows[0].current_assignee_id, S2);
    });

    await t.test('clearances are started on submission and must finish before final approval', async () => {
        const clearance = await h.createWorkflow(admin.token, 'Library clearance', [h.task('library', S2)], []);
        const wf = await h.createWorkflow(admin.token, 'Needs clearance', [h.task('final', S1)], [],
            { clearanceWorkflowIds: [clearance.id] });
        const doc = await h.submit(student.token, wf.id, { title: 'Final clearance' });

        const child = (await h.pool.query('SELECT * FROM documents WHERE workflow_id = $1', [clearance.id])).rows[0];
        assert.ok(child, 'the clearance document was created');
        assert.equal((await h.approve(staff.token, doc.id)).status, 400, 'blocked until the clearance is approved');

        await h.approve(staff2.token, child.id);
        assert.equal((await h.approve(staff.token, doc.id)).status, 200);
    });

    await t.test('tampering with a stored approval is detected', async () => {
        const wf = await h.createWorkflow(admin.token, 'Tamper', [h.task('a', S1), h.task('b', S2)], [h.edge('a', 'b')]);
        const doc = await h.submit(student.token, wf.id);
        await h.approve(staff.token, doc.id);
        await h.approve(staff2.token, doc.id);
        await h.pool.query('UPDATE approvals SET approver_id = $1 WHERE document_id = $2 AND approver_id = $3', [A, doc.id, S1]);
        const chain = await h.api('GET', `/documents/${doc.id}/verify-chain`, { token: admin.token });
        assert.equal(chain.data.chain_valid, false);
    });

    await t.test('publishing rejects broken workflows and explains why', async () => {
        const looped = await h.api('POST', '/workflows', {
            token: admin.token,
            body: { name: 'Loop', flow_structure: { nodes: [h.task('a', S1), h.task('b', S2)], edges: [h.edge('a', 'b'), h.edge('b', 'a')], metadata: { isPublished: true } } },
        });
        assert.equal(looped.status, 400);
        assert.match(looped.data.message, /loop/);

        const noApprover = await h.api('POST', '/workflows', {
            token: admin.token,
            body: { name: 'Empty step', flow_structure: { nodes: [h.node('a', 'task')], edges: [], metadata: { isPublished: true } } },
        });
        assert.equal(noApprover.status, 400);

        const draft = await h.api('POST', '/workflows', {
            token: admin.token,
            body: { name: 'Draft', flow_structure: { nodes: [h.node('a', 'task')], edges: [], metadata: { isPublished: false } } },
        });
        assert.equal(draft.status, 201, 'drafts can be saved incomplete');

        const submitDraft = await h.submit(student.token, draft.data.id).catch((e) => e);
        assert.match(String(submitDraft), /not published/);
    });

    await t.test('editing a workflow cannot remove a step that documents are waiting at', async () => {
        const wf = await h.createWorkflow(admin.token, 'Editable', [h.task('a', S1), h.task('b', S2)], [h.edge('a', 'b')]);
        await h.submit(student.token, wf.id);
        const withoutA = { nodes: [h.task('b', S2)], edges: [], metadata: { isPublished: true } };
        const r = await h.api('PUT', `/workflows/${wf.id}`, { token: admin.token, body: { name: 'Editable', flow_structure: withoutA } });
        assert.equal(r.status, 409);
        const renamed = { nodes: [h.task('a', S1, { label: 'Renamed' }), h.task('b', S2)], edges: [h.edge('a', 'b')], metadata: { isPublished: true } };
        const ok = await h.api('PUT', `/workflows/${wf.id}`, { token: admin.token, body: { name: 'Editable', flow_structure: renamed } });
        assert.equal(ok.status, 200, 'other edits are still allowed');
    });

    await t.test('a step can switch off rejecting', async () => {
        const wf = await h.createWorkflow(admin.token, 'Approve only', [h.task('a', S1, { allowedActions: ['approve'] })], []);
        const doc = await h.submit(student.token, wf.id);
        assert.equal((await h.reject(staff.token, doc.id)).status, 403);
        assert.equal((await h.approve(staff.token, doc.id)).status, 200);
    });

    await t.test('services restricted to some roles reject other roles', async () => {
        const wf = await h.createWorkflow(admin.token, 'Staff only', [h.task('a', A)], [], { allowedSubmitters: [2] });
        const r = await h.submit(student.token, wf.id).catch((e) => e);
        assert.match(String(r), /not available for your role/);
        assert.ok(await h.submit(staff.token, wf.id));
    });
});
