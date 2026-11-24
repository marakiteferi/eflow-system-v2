/**
 * Account types and permissions, and the People API: adding, importing, editing and
 * deactivating accounts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const skip = h.databaseAvailable() ? false : 'PostgreSQL is not reachable (see server/.env)';

test('people and permissions', { skip, concurrency: false }, async (t) => {
    await h.setup();
    t.after(h.teardown);

    const admin = await h.login('admin@example.com');
    const staff = await h.login('staff@example.com');
    const staff2 = await h.login('staff2@example.com');
    const student = await h.login('abebe@example.com');
    const A = admin.user.id, S1 = staff.user.id, S2 = staff2.user.id;

    const grant = async (userId, permissions) => h.api('PUT', `/people/${userId}`, {
        token: admin.token, body: { permissions, otp: await h.adminCode(A) },
    });

    await t.test('login tells the client the account type and permissions', async () => {
        assert.equal(admin.user.account_type, 'Administrator');
        assert.deepEqual([...admin.user.permissions].sort(), ['design_workflows', 'manage_offices', 'manage_people', 'view_audit_log']);
        assert.equal(staff.user.account_type, 'Staff');
        assert.deepEqual(staff.user.permissions, []);
        assert.equal(student.user.account_type, 'Student');
        const me = await h.api('GET', '/auth/me', { token: staff.token });
        assert.equal(me.status, 200);
        assert.equal(me.data.account_type, 'Staff');
    });

    await t.test('plain staff cannot reach the admin areas', async () => {
        assert.equal((await h.api('GET', '/people', { token: staff.token })).status, 403);
        assert.equal((await h.api('GET', '/admin/audit-logs', { token: staff.token })).status, 403);
        assert.equal((await h.api('POST', '/offices', { token: staff.token, body: { name: 'Nope' } })).status, 403);
        const wf = await h.api('POST', '/workflows', { token: staff.token, body: { name: 'Nope', flow_structure: { nodes: [], edges: [] } } });
        assert.equal(wf.status, 403);
        assert.match(wf.data.message, /Design workflows/);
    });

    await t.test('one permission opens exactly one area', async () => {
        const r = await grant(S1, ['view_audit_log']);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal((await h.api('GET', '/admin/audit-logs', { token: staff.token })).status, 200, 'the audit log opens');
        assert.equal((await h.api('GET', '/people', { token: staff.token })).status, 403, 'people stays closed');
        const me = await h.api('GET', '/auth/me', { token: staff.token });
        assert.deepEqual(me.data.permissions, ['view_audit_log']);

        await grant(S1, ['design_workflows']);
        const created = await h.createWorkflow(staff.token, 'Built by staff', [h.task('one', S2)], []);
        assert.ok(created.id, 'staff with "Design workflows" can publish a workflow');
        assert.equal((await h.api('GET', '/admin/audit-logs', { token: staff.token })).status, 403, 'the earlier permission was taken away');
    });

    await t.test('permission and account-type changes need the verification code', async () => {
        const r = await h.api('PUT', `/people/${S2}`, { token: admin.token, body: { permissions: ['manage_people'] } });
        assert.equal(r.status, 400);
        assert.equal(r.data.needsCode, true);
        const renamed = await h.api('PUT', `/people/${S2}`, { token: admin.token, body: { name: 'Demo Staff Two' } });
        assert.equal(renamed.status, 200, 'a plain edit needs no code');
    });

    await t.test('nobody changes their own type or permissions, and only admins make admins', async () => {
        assert.equal((await h.api('PUT', `/people/${A}`, { token: admin.token, body: { role_id: 2, otp: await h.adminCode(A) } })).status, 403);
        await grant(S2, ['manage_people']);
        const promote = await h.api('PUT', `/people/${S1}`, { token: staff2.token, body: { role_id: 3, otp: await h.adminCode(S2) } });
        assert.equal(promote.status, 403);
        assert.match(promote.data.message, /Only an Administrator/);
        const own = await h.api('PUT', `/people/${S2}`, { token: staff2.token, body: { permissions: ['manage_people', 'view_audit_log'], otp: await h.adminCode(S2) } });
        assert.equal(own.status, 403);
    });

    await t.test('people can be listed and filtered', async () => {
        const all = await h.api('GET', '/people', { token: admin.token });
        assert.equal(all.status, 200);
        assert.ok(all.data.length >= 4);
        const students = await h.api('GET', '/people?type=1', { token: admin.token });
        assert.ok(students.data.every((p) => p.account_type === 'Student'));
        const search = await h.api('GET', '/people?q=abebe', { token: admin.token });
        assert.deepEqual(search.data.map((p) => p.email), ['abebe@example.com']);
        const managers = await h.api('GET', '/people?permission=manage_people', { token: admin.token });
        assert.deepEqual(managers.data.map((p) => p.id).sort(), [A, S2].sort());
        const perms = await h.api('GET', '/people/permissions', { token: admin.token });
        assert.ok(perms.data.permissions.find((p) => p.key === 'manage_people').holders.some((x) => x.id === S2));
    });

    let newId;
    await t.test('adding a person creates the account and a set-password link', async () => {
        const dept = (await h.api('POST', '/admin/departments', { token: admin.token, body: { name: 'Computer Science' } })).data;
        const r = await h.api('POST', '/people', {
            token: admin.token,
            body: { name: 'New Student', email: 'New.Student@example.com', role_id: 1, department_id: dept.id },
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        newId = r.data.id;
        assert.match(r.data.setPasswordLink, /reset-password\?token=/);
        const dup = await h.api('POST', '/people', { token: admin.token, body: { name: 'Again', email: 'new.student@example.com' } });
        assert.equal(dup.status, 400, 'emails are unique regardless of case');

        // The link sets the password and the account can sign in
        const token = r.data.setPasswordLink.split('token=')[1];
        assert.equal((await h.api('POST', '/auth/reset-password', { body: { token, newPassword: 'Secret-pass-1' } })).status, 200);
        assert.ok((await h.login('new.student@example.com', 'Secret-pass-1')).token);

        const busy = await h.api('DELETE', `/admin/departments/${dept.id}`, { token: admin.token });
        assert.equal(busy.status, 409, 'a department with people in it cannot be removed');
    });

    await t.test('a CSV import checks every row before anything is created', async () => {
        const csv = [
            'Name,Email,Type,Department,Office,Position',
            'Lidya,lidya@example.com,Student,Computer Science,,',
            'Kebede,kebede@example.com,Staff,,,',
            'Bad type,bad@example.com,Wizard,,,',
            'Exists,abebe@example.com,Student,,,',
            'Nowhere,nowhere@example.com,Staff,,Atlantis,',
        ].join('\n');
        const form = new FormData();
        form.append('file', new Blob([csv], { type: 'text/csv' }), 'people.csv');
        const preview = await h.api('POST', '/people/import/preview', { token: admin.token, form });
        assert.equal(preview.status, 200, JSON.stringify(preview.data));
        assert.deepEqual(preview.data.map((r) => r.isValid), [true, true, false, false, false]);
        assert.match(preview.data[2].error, /Unknown account type/);
        assert.match(preview.data[4].error, /Office "Atlantis" not found/);
        assert.equal((await h.pool.query("SELECT 1 FROM users WHERE email = 'lidya@example.com'")).rows.length, 0, 'nothing created yet');

        const commit = await h.api('POST', '/people/import/commit', { token: admin.token, body: { rows: preview.data, otp: await h.adminCode(A) } });
        assert.equal(commit.status, 200);
        assert.deepEqual(commit.data.imported.sort(), ['kebede@example.com', 'lidya@example.com']);
    });

    await t.test('deactivating someone with waiting work asks who takes it over', async () => {
        const kebede = (await h.pool.query("SELECT id FROM users WHERE email = 'kebede@example.com'")).rows[0].id;
        const wf = await h.createWorkflow(admin.token, 'Handover', [h.task('check', kebede)], []);
        const doc = await h.submit(student.token, wf.id);

        const blocked = await h.api('POST', `/people/${kebede}/deactivate`, { token: admin.token, body: {} });
        assert.equal(blocked.status, 409);
        assert.equal(blocked.data.pending.length, 1);
        const done = await h.api('POST', `/people/${kebede}/deactivate`, { token: admin.token, body: { reassign_to: S1 } });
        assert.equal(done.status, 200, JSON.stringify(done.data));
        assert.equal(done.data.handedOver, 1);
        assert.equal((await h.getDoc(doc.id)).current_assignee_id, S1);
        assert.equal((await h.api('POST', '/auth/login', { body: { email: 'kebede@example.com', password: 'x' } })).status, 400);

        assert.equal((await h.api('POST', `/people/${A}/deactivate`, { token: admin.token, body: {} })).status, 403, 'not yourself');
    });

    await t.test('a deactivated account is locked out at once, even with a valid token', async () => {
        const r = await h.api('POST', `/people/${newId}/deactivate`, { token: admin.token, body: {} });
        assert.equal(r.status, 200);
        const login = await h.api('POST', '/auth/login', { body: { email: 'new.student@example.com', password: 'Secret-pass-1' } });
        assert.equal(login.status, 403);
        assert.match(login.data.message, /deactivated/);
        assert.equal((await h.api('POST', `/people/${newId}/reactivate`, { token: admin.token })).status, 200);
        assert.ok((await h.login('new.student@example.com', 'Secret-pass-1')).token);
    });

    await t.test('an existing token stops working after deactivation', async () => {
        const session = await h.login('new.student@example.com', 'Secret-pass-1');
        await h.api('POST', `/people/${newId}/deactivate`, { token: admin.token, body: {} });
        assert.equal((await h.api('GET', '/documents', { token: session.token })).status, 401);
    });
});
