/**
 * Deadline (SLA) behaviour: reminders, final warnings and escalation, driven by the
 * same background job the server runs every minute.
 * Deadlines are moved in the database instead of waiting for real hours to pass.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const skip = h.databaseAvailable() ? false : 'PostgreSQL is not reachable (see server/.env)';

test('deadlines and escalation', { skip, concurrency: false }, async (t) => {
    await h.setup();
    t.after(h.teardown);
    const { runBackgroundJobs } = require('../../src/cron/slaMonitor');

    const admin = await h.login('admin@example.com');
    const staff = await h.login('staff@example.com');
    const staff2 = await h.login('staff2@example.com');
    const student = await h.login('abebe@example.com');
    const A = admin.user.id, S1 = staff.user.id, S2 = staff2.user.id;

    const deadlineIn = (docId, minutes) =>
        h.pool.query(`UPDATE documents SET delegation_sla_deadline = NOW() + ($1 || ' minutes')::interval WHERE id = $2`, [String(minutes), docId]);
    const notes = async (userId, docId) =>
        (await h.pool.query('SELECT title FROM notifications WHERE user_id = $1 AND document_id = $2 ORDER BY id', [userId, docId])).rows.map((r) => r.title);
    const audit = async (docId) =>
        (await h.pool.query('SELECT action FROM audit_logs WHERE document_id = $1 ORDER BY id', [docId])).rows.map((r) => r.action);

    const timed = { escalationHours: 4, reminderHours: 2, warningHours: 1, escalationUserId: String(A) };

    await t.test('the deadline is set from the step settings when the step starts', async () => {
        const wf = await h.createWorkflow(admin.token, 'Deadline set', [h.task('review', S1, timed)], []);
        const doc = await h.submit(student.token, wf.id);
        const hoursLeft = (new Date((await h.getDoc(doc.id)).delegation_sla_deadline) - Date.now()) / 3600000;
        assert.ok(hoursLeft > 3.9 && hoursLeft <= 4, `deadline is 4 hours away (got ${hoursLeft.toFixed(2)})`);
    });

    await t.test('nothing is sent while the deadline is still far away', async () => {
        const wf = await h.createWorkflow(admin.token, 'Far', [h.task('review', S1, timed)], []);
        const doc = await h.submit(student.token, wf.id);
        const before = (await notes(S1, doc.id)).length;
        await runBackgroundJobs();
        assert.equal((await notes(S1, doc.id)).length, before);
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, S1);
    });

    await t.test('a reminder, then a final warning, are each sent once to the reviewer', async () => {
        const wf = await h.createWorkflow(admin.token, 'Alerts', [h.task('review', S1, timed)], []);
        const doc = await h.submit(student.token, wf.id);

        await deadlineIn(doc.id, 90); // inside the 2-hour reminder window, outside the 1-hour warning
        await runBackgroundJobs();
        await runBackgroundJobs();
        let titles = await notes(S1, doc.id);
        assert.equal(titles.filter((x) => x.startsWith('⏰ Reminder')).length, 1, 'one reminder');
        assert.equal(titles.filter((x) => x.startsWith('⚠️ SLA warning')).length, 0, 'no warning yet');

        await deadlineIn(doc.id, 30); // inside the warning window
        await runBackgroundJobs();
        await runBackgroundJobs();
        titles = await notes(S1, doc.id);
        assert.equal(titles.filter((x) => x.startsWith('⚠️ SLA warning')).length, 1, 'one warning');
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, S1, 'not escalated before the deadline');
    });

    await t.test('after the deadline the step moves to the escalation target, who is told and can approve it', async () => {
        // A regular staff member as the target, so approving proves the handover (an admin can act on anything)
        const wf = await h.createWorkflow(admin.token, 'Escalate',
            [h.task('review', S1, { ...timed, escalationUserId: String(S2) }), h.task('next', A)], [h.edge('review', 'next')]);
        const doc = await h.submit(student.token, wf.id);

        await deadlineIn(doc.id, -1);
        await runBackgroundJobs();
        const d = await h.getDoc(doc.id);
        assert.equal(d.current_assignee_id, S2);
        assert.ok((await notes(S2, doc.id)).some((x) => x.startsWith('🚨 Escalated to you')), 'target notified');
        assert.ok((await audit(doc.id)).includes('SLA Breached — Reassigned to Escalation Target'));

        assert.equal((await h.approve(staff.token, doc.id)).status, 403, 'the original reviewer no longer holds it');
        assert.equal((await h.approve(staff2.token, doc.id)).status, 200, 'the escalation target can approve');
        const after = await h.getDoc(doc.id);
        assert.equal(after.current_node_id, 'next');
        assert.equal(after.current_assignee_id, A);
        assert.equal(after.sla_escalated, false, 'the escalation flag resets for the next step');
    });

    await t.test('a breach with no target is logged once and the reviewer keeps the step', async () => {
        // Publishing insists on a target, so remove it directly to simulate an older workflow
        const created = await h.createWorkflow(admin.token, 'No target', [h.task('review', S1, timed)], []);
        const flow = { nodes: [h.task('review', S1, { escalationHours: 1 })], edges: [] };
        await h.pool.query('UPDATE workflows SET flow_structure = $1 WHERE id = $2', [JSON.stringify(flow), created.id]);
        const wfId = created.id;
        const doc = await h.submit(student.token, wfId);
        await deadlineIn(doc.id, -1);
        await runBackgroundJobs();
        await runBackgroundJobs();
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, S1);
        assert.equal((await audit(doc.id)).filter((x) => x.startsWith('SLA Breached')).length, 1);
    });

    await t.test("a later step without a deadline is never escalated because of the first step's deadline", async () => {
        const wf = await h.createWorkflow(admin.token, 'Inherit',
            [h.task('a', S1, timed), h.task('b', S2)], [h.edge('a', 'b')]);
        const doc = await h.submit(student.token, wf.id);
        await h.approve(staff.token, doc.id);
        // The document-level deadline (set from step a) has long passed
        await h.pool.query("UPDATE documents SET original_sla_deadline = NOW() - INTERVAL '1 day' WHERE id = $1", [doc.id]);
        await runBackgroundJobs();
        const d = await h.getDoc(doc.id);
        assert.equal(d.current_assignee_id, S2);
        assert.equal((await audit(doc.id)).filter((x) => x.startsWith('SLA Breached')).length, 0);
    });

    await t.test('a timed step after a delay gets its deadline from when it starts', async () => {
        const wf = await h.createWorkflow(admin.token, 'Delay then deadline',
            [h.node('wait', 'delay', { delayHours: '1' }), h.task('review', S1, timed)], [h.edge('wait', 'review')]);
        const doc = await h.submit(student.token, wf.id);
        await h.pool.query("UPDATE documents SET resume_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [doc.id]);
        await runBackgroundJobs();
        const d = await h.getDoc(doc.id);
        assert.equal(d.current_node_id, 'review');
        const hoursLeft = (new Date(d.delegation_sla_deadline) - Date.now()) / 3600000;
        assert.ok(hoursLeft > 3.9, 'deadline counts from the end of the delay');
    });

    await t.test('parallel branches each have their own deadline and escalate on their own', async () => {
        const wf = await h.createWorkflow(admin.token, 'Parallel deadlines',
            [
                h.node('split', 'parallel'),
                h.task('library', S1, { ...timed, escalationUserId: String(S2) }),
                h.task('finance', A),
                h.node('merge', 'join'),
            ],
            [h.edge('split', 'library'), h.edge('split', 'finance'), h.edge('library', 'merge'), h.edge('finance', 'merge')]);
        const doc = await h.submit(student.token, wf.id);
        let d = await h.getDoc(doc.id);
        assert.ok(d.parallel_branch_data[0].deadline, 'the timed branch has a deadline');
        assert.equal(d.parallel_branch_data[1].deadline || null, null, 'the untimed branch has none');

        // Reminder for the timed branch
        const soon = (minutes) => {
            const branches = d.parallel_branch_data.map((b, i) => (i === 0 ? { ...b, deadline: new Date(Date.now() + minutes * 60000).toISOString() } : b));
            return h.pool.query('UPDATE documents SET parallel_branch_data = $1 WHERE id = $2', [JSON.stringify(branches), doc.id]);
        };
        await soon(90);
        await runBackgroundJobs();
        assert.equal((await notes(S1, doc.id)).filter((x) => x.startsWith('⏰ Reminder')).length, 1);

        d = await h.getDoc(doc.id);
        await soon(-1);
        await runBackgroundJobs();
        await runBackgroundJobs();
        d = await h.getDoc(doc.id);
        assert.equal(d.parallel_branch_data[0].assigneeId, S2, 'the late branch went to the target');
        assert.equal(d.parallel_branch_data[1].assigneeId, A, 'the other branch is untouched');
        const escalations = await h.pool.query("SELECT COUNT(*)::int AS n FROM approvals WHERE document_id = $1 AND status = 'Auto-Escalated'", [doc.id]);
        assert.equal(escalations.rows[0].n, 1);

        assert.equal((await h.approve(staff.token, doc.id)).status, 403, 'the late reviewer lost the branch');
        assert.equal((await h.approve(staff2.token, doc.id)).status, 200, 'the target can approve the branch');
        assert.equal((await h.approve(admin.token, doc.id)).status, 200);
        assert.equal((await h.getDoc(doc.id)).status, 'Approved');
    });
});
