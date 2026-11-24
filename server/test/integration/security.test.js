/**
 * Security behaviour: protected file downloads, sign-in limits, stored one-time codes,
 * and background jobs that only one server runs at a time.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');

const skip = h.databaseAvailable() ? false : 'PostgreSQL is not reachable (see server/.env)';

test('security', { skip, concurrency: false }, async (t) => {
    await h.setup();
    t.after(h.teardown);

    const admin = await h.login('admin@example.com');
    const staff = await h.login('staff@example.com');
    const student = await h.login('abebe@example.com');
    await h.api('POST', '/auth/register', { body: { name: 'Other Student', email: 'other@example.com', password: 'demo1234' } });
    const other = await h.login('other@example.com');
    const S1 = staff.user.id;

    const wf = await h.createWorkflow(admin.token, 'Files', [h.task('review', S1)], []);
    const doc = await h.submit(student.token, wf.id, { title: 'Private file' });
    const fileUrl = `${h.origin}/${doc.file_path.replace(/\\/g, '/')}`;
    const get = (url, headers = {}) => fetch(url, { headers }).then((r) => r.status);

    await t.test('uploaded files are not public', async () => {
        assert.equal(await get(fileUrl), 401);
    });

    await t.test('the submitter and staff can open the file; another student cannot', async () => {
        assert.equal(await get(`${fileUrl}?ft=${student.fileToken}`), 200);
        assert.equal(await get(`${fileUrl}?ft=${staff.fileToken}`), 200);
        assert.equal(await get(fileUrl, { Authorization: `Bearer ${student.token}` }), 200, 'the normal sign-in token works as a header');
        assert.equal(await get(`${fileUrl}?ft=${other.fileToken}`), 403);
    });

    await t.test('tokens are not interchangeable', async () => {
        assert.equal(await get(`${fileUrl}?ft=${student.token}`), 401, 'a sign-in token is not accepted in a link');
        const r = await h.api('GET', '/documents', { token: student.fileToken });
        assert.equal(r.status, 403, 'a file token cannot call the API');
    });

    await t.test('unknown and malformed file names are refused', async () => {
        assert.equal(await get(`${h.origin}/uploads/does-not-exist.pdf?ft=${staff.fileToken}`), 404);
        assert.equal(await get(`${h.origin}/uploads/..%2F.env?ft=${staff.fileToken}`), 400);
    });

    await t.test('one-time codes are stored hashed in the database, not in memory', async () => {
        const r = await h.api('POST', '/approvals/request-otp', { token: staff.token, body: { documentId: doc.id } });
        const code = r.data.message.match(/(\d{6})/)[1];
        const row = (await h.pool.query("SELECT * FROM one_time_codes WHERE user_id = $1 AND purpose = 'approval'", [S1])).rows[0];
        assert.ok(row, 'the code is in the database');
        assert.notEqual(row.code_hash, code);
        assert.equal(row.code_hash, crypto.createHash('sha256').update(code).digest('hex'));
    });

    await t.test('five wrong codes cancel the code', async () => {
        for (let i = 0; i < 5; i++) {
            const r = await h.api('POST', '/approvals/approve', { token: staff.token, body: { documentId: doc.id, otp: '000000' } });
            assert.equal(r.status, 400);
        }
        const row = (await h.pool.query("SELECT 1 FROM one_time_codes WHERE user_id = $1 AND purpose = 'approval'", [S1])).rows[0];
        assert.equal(row, undefined);
    });

    await t.test('repeated failed sign-ins are blocked', async () => {
        const statuses = [];
        for (let i = 0; i < 11; i++) {
            statuses.push((await h.api('POST', '/auth/login', { body: { email: 'staff2@example.com', password: 'wrong' } })).status);
        }
        assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
        assert.equal(statuses[10], 429);
        // Other accounts are not affected
        assert.equal((await h.api('POST', '/auth/login', { body: { email: 'abebe@example.com', password: 'demo1234' } })).status, 200);
    });

    await t.test('background jobs run on only one server at a time', async () => {
        const { runBackgroundJobs } = require('../../src/cron/slaMonitor');
        // Simulate another server holding the job lock
        const holder = await h.pool.connect();
        await holder.query('SELECT pg_advisory_lock(724001)');
        try {
            assert.equal(await runBackgroundJobs(), false, 'skipped while another server runs the jobs');
        } finally {
            await holder.query('SELECT pg_advisory_unlock(724001)');
            holder.release();
        }
        assert.equal(await runBackgroundJobs(), true);
    });
});
