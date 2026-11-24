/**
 * Office-based routing: offices with a head and officers, steps sent to an office's shared
 * queue, claiming, cover while someone is away, and escalation to the office head.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const skip = h.databaseAvailable() ? false : 'PostgreSQL is not reachable (see server/.env)';

test('offices', { skip, concurrency: false }, async (t) => {
    await h.setup();
    t.after(h.teardown);
    const { runBackgroundJobs } = require('../../src/cron/slaMonitor');

    // Two more staff accounts, with the same demo password
    for (const [name, email] of [['Officer Two', 'officer2@example.com'], ['Outsider', 'outsider@example.com']]) {
        await h.pool.query(
            `INSERT INTO users (name, email, password_hash, role_id)
             SELECT $1, $2, password_hash, 2 FROM users WHERE email = 'staff@example.com'`, [name, email]);
    }
    const admin = await h.login('admin@example.com');
    const head = await h.login('staff2@example.com');
    const officer = await h.login('staff@example.com');
    const officer2 = await h.login('officer2@example.com');
    const outsider = await h.login('outsider@example.com');
    const student = await h.login('abebe@example.com');
    const HEAD = head.user.id, O1 = officer.user.id, O2 = officer2.user.id;

    const office = (id, extra = {}) => ({ assignmentStrategy: 'office', officeId: String(id), officePosition: 'officer', ...extra });
    const notes = async (userId, docId) =>
        (await h.pool.query('SELECT title FROM notifications WHERE user_id = $1 AND document_id = $2', [userId, docId])).rows.map((r) => r.title);
    const claim = (u, docId) => h.api('POST', `/offices/queue/${docId}/claim`, { token: u.token });
    const release = (u, docId) => h.api('POST', `/offices/queue/${docId}/release`, { token: u.token });
    const visibleTo = async (u, docId) => (await h.api('GET', '/documents', { token: u.token })).data.some((d) => d.id === docId);

    let registrar;

    await t.test('the admin creates offices and appoints a head; others cannot', async () => {
        const denied = await h.api('POST', '/offices', { token: officer.token, body: { name: 'Nope' } });
        assert.equal(denied.status, 403);
        const r = await h.api('POST', '/offices', { token: admin.token, body: { name: 'Registrar', head_id: HEAD } });
        assert.equal(r.status, 201);
        registrar = r.data.id;
        const dup = await h.api('POST', '/offices', { token: admin.token, body: { name: 'Registrar' } });
        assert.equal(dup.status, 400);
        const student403 = await h.api('POST', '/offices', { token: admin.token, body: { name: 'Bad head', head_id: student.user.id } });
        assert.equal(student403.status, 400, 'a student cannot head an office');
    });

    await t.test('the head manages their own officers; officers cannot', async () => {
        assert.equal((await h.api('POST', `/offices/${registrar}/members`, { token: head.token, body: { user_id: O1 } })).status, 201);
        assert.equal((await h.api('POST', `/offices/${registrar}/members`, { token: head.token, body: { user_id: O2 } })).status, 201);
        assert.equal((await h.api('POST', `/offices/${registrar}/members`, { token: officer.token, body: { user_id: outsider.user.id } })).status, 403);
        assert.equal((await h.api('POST', `/offices/${registrar}/members`, { token: head.token, body: { user_id: student.user.id } })).status, 400);
        const mine = await h.api('GET', '/offices/mine', { token: head.token });
        assert.equal(mine.data[0].i_am_head, true);
        assert.deepEqual(mine.data[0].members.map((m) => m.id).sort(), [O1, O2].sort());
    });

    await t.test('an office step needs an office before it can be published', async () => {
        const r = await h.api('POST', '/workflows', {
            token: admin.token,
            body: { name: 'No office', flow_structure: { nodes: [h.task('step', '', { assignmentStrategy: 'office' })], edges: [], metadata: { isPublished: true } } },
        });
        assert.equal(r.status, 400);
        assert.match(JSON.stringify(r.data.problems), /no office selected/);
    });

    await t.test('a step sent to an office waits in the shared queue and everyone in the office is told', async () => {
        const wf = await h.createWorkflow(admin.token, 'Transcript', [h.task('registrar', '', office(registrar))], []);
        const doc = await h.submit(student.token, wf.id);
        const d = await h.getDoc(doc.id);
        assert.equal(d.current_office_id, registrar);
        assert.equal(d.current_assignee_id, null, 'nobody has claimed it yet');
        for (const id of [HEAD, O1, O2]) assert.ok((await notes(id, doc.id)).length > 0, `user ${id} was notified`);
        assert.ok(await visibleTo(officer, doc.id));
        assert.ok(await visibleTo(officer2, doc.id));
        assert.equal(await visibleTo(outsider, doc.id), false, 'people outside the office do not see it');
    });

    await t.test('one officer claims it; the others see it is taken; release puts it back', async () => {
        const wf = await h.createWorkflow(admin.token, 'Claiming', [h.task('registrar', '', office(registrar))], []);
        const doc = await h.submit(student.token, wf.id);

        assert.equal((await claim(outsider, doc.id)).status, 409, 'outsiders cannot claim');
        assert.equal((await h.approve(outsider.token, doc.id)).status, 403, 'outsiders cannot approve');
        assert.equal((await claim(officer, doc.id)).status, 200);
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, O1);
        assert.equal((await claim(officer2, doc.id)).status, 409, 'already claimed');
        assert.equal((await h.approve(officer2.token, doc.id)).status, 403, 'only the claimer (or the head) can act now');
        const list = (await h.api('GET', '/documents', { token: officer2.token })).data.find((x) => x.id === doc.id);
        assert.equal(list.current_assignee_name, 'Demo Staff', 'the queue shows who has it');
        assert.equal(list.current_office_name, 'Registrar');

        assert.equal((await release(officer2, doc.id)).status, 409, 'cannot release someone else\'s claim');
        assert.equal((await release(officer, doc.id)).status, 200);
        assert.equal((await claim(officer2, doc.id)).status, 200);
        assert.equal((await h.approve(officer2.token, doc.id)).status, 200);
        assert.equal((await h.getDoc(doc.id)).status, 'Approved');
    });

    await t.test('an officer can approve straight from the queue without claiming first', async () => {
        const wf = await h.createWorkflow(admin.token, 'Direct', [h.task('registrar', '', office(registrar)), h.task('after', O1)], [h.edge('registrar', 'after')]);
        const doc = await h.submit(student.token, wf.id);
        assert.equal((await h.approve(officer2.token, doc.id)).status, 200);
        const d = await h.getDoc(doc.id);
        assert.equal(d.current_node_id, 'after');
        assert.equal(d.current_office_id, null, 'the next step is not an office step');
    });

    await t.test('the head can step in on a claimed document', async () => {
        const wf = await h.createWorkflow(admin.token, 'Head steps in', [h.task('registrar', '', office(registrar))], []);
        const doc = await h.submit(student.token, wf.id);
        await claim(officer, doc.id);
        assert.equal((await h.approve(head.token, doc.id)).status, 200);
    });

    await t.test('a step for the office head goes to the head, or to their cover while away', async () => {
        const wf = await h.createWorkflow(admin.token, 'Head sign-off', [h.task('dean', '', office(registrar, { officePosition: 'head' }))], []);
        let doc = await h.submit(student.token, wf.id);
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, HEAD);

        // The head marks themself away, covered by an officer
        const away = await h.api('PUT', `/offices/${registrar}/cover/${HEAD}`, { token: head.token, body: { is_out_of_office: true, delegate_id: O1 } });
        assert.equal(away.status, 200);
        assert.equal((await h.api('PUT', `/offices/${registrar}/cover/${O2}`, { token: head.token, body: { is_out_of_office: true, delegate_id: outsider.user.id } })).status, 400,
            'cover must be someone in the same office');
        assert.equal((await release(head, doc.id)).status, 409, "a head's step never goes to the shared queue");
        doc = await h.submit(student.token, wf.id);
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, O1);
        await h.api('PUT', `/offices/${registrar}/cover/${HEAD}`, { token: head.token, body: { is_out_of_office: false } });
    });

    await t.test('reminders go to the whole office until someone claims the document', async () => {
        const wf = await h.createWorkflow(admin.token, 'Office reminder',
            [h.task('registrar', '', office(registrar, { escalationHours: 4, reminderHours: 2 }))], []);
        const doc = await h.submit(student.token, wf.id);
        await h.pool.query("UPDATE documents SET delegation_sla_deadline = NOW() + INTERVAL '90 minutes' WHERE id = $1", [doc.id]);
        await runBackgroundJobs();
        for (const id of [HEAD, O1, O2]) {
            assert.ok((await notes(id, doc.id)).some((x) => x.startsWith('⏰ Reminder')), `user ${id} reminded`);
        }
    });

    await t.test('a late office step escalates to the head automatically, with no target set', async () => {
        const wf = await h.createWorkflow(admin.token, 'Office escalation',
            [h.task('registrar', '', office(registrar, { escalationHours: 1 }))], []);
        const doc = await h.submit(student.token, wf.id);
        await claim(officer, doc.id);
        await h.pool.query("UPDATE documents SET delegation_sla_deadline = NOW() - INTERVAL '1 minute' WHERE id = $1", [doc.id]);
        await runBackgroundJobs();
        const d = await h.getDoc(doc.id);
        assert.equal(d.current_assignee_id, HEAD);
        assert.ok((await notes(HEAD, doc.id)).some((x) => x.startsWith('🚨 Escalated to you')));
        assert.equal((await h.approve(head.token, doc.id)).status, 200);
    });

    await t.test("a named person's late step escalates to the head of their office", async () => {
        const wf = await h.createWorkflow(admin.token, 'Person escalation', [h.task('check', O2, { escalationHours: 1 })], []);
        const doc = await h.submit(student.token, wf.id);
        await h.pool.query("UPDATE documents SET delegation_sla_deadline = NOW() - INTERVAL '1 minute' WHERE id = $1", [doc.id]);
        await runBackgroundJobs();
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, HEAD);
    });

    await t.test('parallel branches can be office steps too', async () => {
        const lib = (await h.api('POST', '/offices', { token: admin.token, body: { name: 'Library', head_id: O2 } })).data.id;
        const wf = await h.createWorkflow(admin.token, 'Clearance',
            [h.node('split', 'parallel'), h.task('reg', '', office(registrar)), h.task('lib', '', office(lib)), h.node('merge', 'join')],
            [h.edge('split', 'reg'), h.edge('split', 'lib'), h.edge('reg', 'merge'), h.edge('lib', 'merge')]);
        const doc = await h.submit(student.token, wf.id);
        assert.equal((await claim(officer, doc.id)).status, 200);
        let d = await h.getDoc(doc.id);
        assert.equal(d.parallel_branch_data[0].assigneeId, O1);
        assert.equal(d.parallel_branch_data[1].assigneeId, null);
        assert.equal((await h.approve(officer.token, doc.id)).status, 200);
        assert.equal((await h.approve(officer2.token, doc.id)).status, 200, 'the library head approves the library branch');
        d = await h.getDoc(doc.id);
        assert.equal(d.status, 'Approved');
    });

    let deputy, records;
    await t.test('the head sets up positions, and who reports to whom', async () => {
        assert.equal((await h.api('POST', `/offices/${registrar}/positions`, { token: officer.token, body: { name: 'Deputy' } })).status, 403);
        deputy = (await h.api('POST', `/offices/${registrar}/positions`, { token: head.token, body: { name: 'Deputy Registrar' } })).data.id;
        const r = await h.api('POST', `/offices/${registrar}/positions`, { token: head.token, body: { name: 'Records Officer', reports_to_id: deputy } });
        assert.equal(r.status, 201);
        records = r.data.id;
        const loop = await h.api('PUT', `/offices/${registrar}/positions/${deputy}`, { token: head.token, body: { reports_to_id: records } });
        assert.equal(loop.status, 400, 'positions cannot report to each other in a loop');

        assert.equal((await h.api('PUT', `/offices/${registrar}/members/${O1}`, { token: head.token, body: { position_id: records } })).status, 200);
        assert.equal((await h.api('PUT', `/offices/${registrar}/members/${O2}`, { token: head.token, body: { position_id: deputy } })).status, 200);
        const mine = (await h.api('GET', '/offices/mine', { token: head.token })).data.find((o) => o.id === registrar);
        assert.deepEqual(mine.positions.map((p) => p.name), ['Deputy Registrar', 'Records Officer']);
        assert.equal(mine.members.find((m) => m.id === O1).position_name, 'Records Officer');
    });

    await t.test('a position step needs a position before it can be published', async () => {
        const r = await h.api('POST', '/workflows', {
            token: admin.token,
            body: { name: 'No position', flow_structure: { nodes: [h.task('step', '', office(registrar, { officePosition: 'position' }))], edges: [], metadata: { isPublished: true } } },
        });
        assert.equal(r.status, 400);
        assert.match(JSON.stringify(r.data.problems), /no position is selected/);
    });

    await t.test('a step for one position goes only to the people holding it', async () => {
        const wf = await h.createWorkflow(admin.token, 'Records check',
            [h.task('records', '', office(registrar, { officePosition: 'position', positionId: String(records) }))], []);
        const doc = await h.submit(student.token, wf.id);
        const d = await h.getDoc(doc.id);
        assert.equal(d.current_position_id, records);
        assert.equal(d.current_assignee_id, null);
        assert.ok((await notes(O1, doc.id)).length > 0, 'the records officer is told');
        assert.equal((await notes(O2, doc.id)).length, 0, 'the deputy is not');

        assert.equal((await claim(officer2, doc.id)).status, 409, 'other officers cannot claim it');
        assert.equal((await h.approve(officer2.token, doc.id)).status, 403, 'or approve it');
        assert.equal((await claim(officer, doc.id)).status, 200);
        assert.equal((await h.approve(officer.token, doc.id)).status, 200);
    });

    await t.test('late work escalates up the office: records officer to deputy', async () => {
        const wf = await h.createWorkflow(admin.token, 'Records escalation',
            [h.task('records', '', office(registrar, { officePosition: 'position', positionId: String(records), escalationHours: 1 }))], []);
        const doc = await h.submit(student.token, wf.id);
        await claim(officer, doc.id);
        await h.pool.query("UPDATE documents SET delegation_sla_deadline = NOW() - INTERVAL '1 minute' WHERE id = $1", [doc.id]);
        await runBackgroundJobs();
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, O2, 'the deputy takes it over');
        assert.ok((await notes(O2, doc.id)).some((x) => x.startsWith('🚨 Escalated to you')));
        assert.equal((await h.approve(officer2.token, doc.id)).status, 200);
    });

    await t.test('a position nobody holds sends the step to the head', async () => {
        const cashier = (await h.api('POST', `/offices/${registrar}/positions`, { token: head.token, body: { name: 'Cashier' } })).data.id;
        const wf = await h.createWorkflow(admin.token, 'Fees',
            [h.task('fees', '', office(registrar, { officePosition: 'position', positionId: String(cashier) }))], []);
        const doc = await h.submit(student.token, wf.id);
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, HEAD);
        const used = await h.api('DELETE', `/offices/${registrar}/positions/${cashier}`, { token: head.token });
        assert.equal(used.status, 409, 'a position used by a workflow cannot be removed');
    });

    await t.test('an office used by a workflow cannot be deleted', async () => {
        const r = await h.api('DELETE', `/offices/${registrar}`, { token: admin.token });
        assert.equal(r.status, 409);
    });

    await t.test('removing an officer returns their claimed documents to the queue', async () => {
        const wf = await h.createWorkflow(admin.token, 'Removal', [h.task('registrar', '', office(registrar))], []);
        const doc = await h.submit(student.token, wf.id);
        await claim(officer2, doc.id);
        const r = await h.api('DELETE', `/offices/${registrar}/members/${O2}`, { token: head.token });
        assert.equal(r.data.returnedToQueue, 1);
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, null);
    });
});
