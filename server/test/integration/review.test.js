/**
 * What a step can ask of its reviewer before approving: a required checklist and a
 * decision outcome that later "Branch on outcome" steps route on. Also working-day deadlines.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { addDuration } = require('../../src/services/workflowEngine');

const skip = h.databaseAvailable() ? false : 'PostgreSQL is not reachable (see server/.env)';

test('working-day deadlines skip the weekend', () => {
    const friday = new Date(2026, 10, 20, 15, 0, 0); // Friday 20 Nov 2026, 3 PM
    const plain = addDuration(friday, 24);
    assert.equal(plain.getDay(), 6, 'one calendar day after Friday is Saturday');
    const working = addDuration(friday, 24, true);
    assert.equal(working.getDay(), 1, 'one working day after Friday is Monday');
    assert.equal(working.getHours(), 15);
    const saturday = new Date(2026, 10, 21, 10, 0, 0);
    const fromWeekend = addDuration(saturday, 4, true);
    assert.equal(fromWeekend.getDay(), 1, 'work handed in on Saturday starts counting on Monday');
    assert.equal(fromWeekend.getHours(), 4);
});

test('review requirements', { skip, concurrency: false }, async (t) => {
    await h.setup();
    t.after(h.teardown);

    const admin = await h.login('admin@example.com');
    const staff = await h.login('staff@example.com');
    const staff2 = await h.login('staff2@example.com');
    const student = await h.login('abebe@example.com');
    const S1 = staff.user.id, S2 = staff2.user.id;

    const checklist = ['Fee receipt attached', 'Student ID matches'];

    await t.test('a step with a checklist cannot be approved until every item is confirmed', async () => {
        const wf = await h.createWorkflow(admin.token, 'Checklist step', [h.task('check', S1, { checklist })], []);
        const doc = await h.submit(student.token, wf.id);

        const none = await h.approve(staff.token, doc.id);
        assert.equal(none.status, 400);
        assert.match(none.data.message, /Fee receipt attached; Student ID matches/);

        const partial = await h.approve(staff.token, doc.id, 'ok', { checklist: [checklist[0]] });
        assert.equal(partial.status, 400);
        assert.match(partial.data.message, /Still open: Student ID matches/);

        const ok = await h.approve(staff.token, doc.id, 'ok', { checklist });
        assert.equal(ok.status, 200);
        const row = (await h.pool.query('SELECT checklist_confirmed FROM approvals WHERE document_id = $1', [doc.id])).rows[0];
        assert.deepEqual(row.checklist_confirmed, checklist, 'the confirmed items are kept with the approval');
    });

    await t.test('a step with outcomes needs one of them, and the next step branches on it', async () => {
        const wf = await h.createWorkflow(admin.token, 'Outcome branch',
            [h.task('assess', S1, { allowedTags: 'Undergraduate, Postgraduate' }),
                h.node('route', 'condition', { conditionValue: 'Postgraduate' }), h.task('pg', S2), h.task('ug', S1)],
            [h.edge('assess', 'route'), h.edge('route', 'pg', 'true'), h.edge('route', 'ug', 'false')]);

        const doc = await h.submit(student.token, wf.id);
        const missing = await h.approve(staff.token, doc.id);
        assert.equal(missing.status, 400);
        assert.match(missing.data.message, /Choose an outcome/);

        const wrong = await h.approve(staff.token, doc.id, 'ok', { outcome: 'PhD' });
        assert.equal(wrong.status, 400);

        const ok = await h.approve(staff.token, doc.id, 'ok', { outcome: 'postgraduate' });
        assert.equal(ok.status, 200);
        const after = await h.getDoc(doc.id);
        assert.equal(after.metadata_tag, 'Postgraduate', 'the outcome is stored with its defined spelling');
        assert.equal(after.current_assignee_id, S2, 'routed down the Postgraduate branch');

        const other = await h.submit(student.token, wf.id);
        assert.equal((await h.approve(staff.token, other.id, 'ok', { outcome: 'Undergraduate' })).status, 200);
        assert.equal((await h.getDoc(other.id)).current_assignee_id, S1, 'routed down the other branch');
    });

    await t.test('the outcome can be set ahead of approving, but only to a listed value and by the reviewer', async () => {
        const wf = await h.createWorkflow(admin.token, 'Outcome early', [h.task('assess', S1, { allowedTags: 'Complete, Incomplete' })], []);
        const doc = await h.submit(student.token, wf.id);
        assert.equal((await h.api('PATCH', `/documents/${doc.id}/tag`, { token: staff2.token, body: { tag: 'Complete' } })).status, 403);
        assert.equal((await h.api('PATCH', `/documents/${doc.id}/tag`, { token: staff.token, body: { tag: 'Maybe' } })).status, 400);
        assert.equal((await h.api('PATCH', `/documents/${doc.id}/tag`, { token: staff.token, body: { tag: 'complete' } })).status, 200);
        assert.equal((await h.getDoc(doc.id)).metadata_tag, 'Complete');
    });

    await t.test('working-days-only steps get a deadline that skips weekends', async () => {
        const wf = await h.createWorkflow(admin.token, 'Working days', [h.task('review', S1, { escalationHours: 24 * 5, workingDaysOnly: true })], []);
        const doc = await h.submit(student.token, wf.id);
        const days = (new Date((await h.getDoc(doc.id)).delegation_sla_deadline) - Date.now()) / 86400000;
        // From a weekday, five working days is a full calendar week (started at a weekend, Monday is day one)
        const weekday = ![0, 6].includes(new Date().getDay());
        if (weekday) assert.ok(days >= 6.99 && days <= 7.01, `five working days is a calendar week (got ${days.toFixed(2)} days)`);
        else assert.ok(days > 5 && days <= 7, `the weekend is skipped (got ${days.toFixed(2)} days)`);
    });
});
