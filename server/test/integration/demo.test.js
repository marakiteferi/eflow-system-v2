/**
 * The demo data (db/demo.js) loads cleanly on a fresh database, and only once.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const h = require('./helpers');

const skip = h.databaseAvailable() ? false : 'PostgreSQL is not reachable (see server/.env)';
const loadDemo = () => execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'db', 'demo.js')], { env: process.env, encoding: 'utf8' });

test('demo data', { skip, concurrency: false }, async (t) => {
    await h.setup();
    t.after(h.teardown);
    loadDemo();

    await t.test('offices, services and requests at every stage are created', async () => {
        const count = async (sql) => Number((await h.pool.query(sql)).rows[0].n);
        assert.equal(await count('SELECT COUNT(*) n FROM offices'), 4);
        assert.equal(await count('SELECT COUNT(*) n FROM workflows'), 4);
        const statuses = (await h.pool.query('SELECT status, COUNT(*) n FROM documents GROUP BY status')).rows
            .reduce((acc, r) => ({ ...acc, [r.status]: Number(r.n) }), {});
        assert.deepEqual(statuses, { Approved: 1, Pending: 7, Rejected: 1 });
        assert.equal(await count("SELECT COUNT(*) n FROM documents WHERE metadata_tag = 'Partial waiver' AND current_node_id = 'applyPartial'"), 1,
            'the fee waiver followed the outcome chosen by Student Affairs');
    });

    await t.test('every demo account can sign in', async () => {
        for (const email of ['registrar@example.com', 'cashier@example.com', 'designer@example.com', 'ruth@example.com']) {
            assert.ok((await h.login(email)).token, email);
        }
    });

    await t.test('loading it again changes nothing', async () => {
        assert.match(loadDemo(), /already loaded/);
        assert.equal(Number((await h.pool.query('SELECT COUNT(*) n FROM documents')).rows[0].n), 9);
    });
});
