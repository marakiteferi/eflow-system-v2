/**
 * Integration-test helpers: a throwaway database, the real Express app on a
 * random port, and small wrappers for the API calls a test needs.
 *
 * Uses the connection settings in server/.env, with the database name replaced
 * by TEST_DB_NAME (default "eflow_test"). That database is dropped and recreated.
 */
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

process.env.DB_NAME = process.env.TEST_DB_NAME || 'eflow_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.APPROVAL_SIGNING_SECRET = process.env.APPROVAL_SIGNING_SECRET || 'test-signing-secret';
process.env.DEMO_PASSWORD = 'demo1234';
delete process.env.SMTP_HOST; // never send real email from tests
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_CODES = '1000'; // tests request many codes; the limit itself is tested separately

const { PDFDocument } = require('pdf-lib');

let server;
let baseUrl;
let pool;

const setup = async () => {
    execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'db', 'setup.js'), '--reset'], {
        env: process.env,
        stdio: 'ignore',
    });
    // Run from server/ so relative upload paths resolve the same way as in production
    process.chdir(path.join(__dirname, '..', '..'));
    const app = require('../../src/index');
    pool = require('../../src/db');
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    return { pool };
};

const teardown = async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) await pool.end();
};

/** Is PostgreSQL reachable with the configured credentials? */
const databaseAvailable = () => {
    try {
        execFileSync(process.execPath, ['-e', `
            const { Client } = require('pg');
            const c = new Client({ user: process.env.DB_USER, password: process.env.DB_PASSWORD, host: process.env.DB_HOST, port: process.env.DB_PORT, database: 'postgres' });
            c.connect().then(() => c.end()).catch(() => process.exit(1));
        `], { env: process.env, stdio: 'ignore', cwd: path.join(__dirname, '..', '..') });
        return true;
    } catch (e) {
        return false;
    }
};

const api = async (method, url, { token, body, form } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + url, { method, headers, body: payload });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
};

const login = async (email, password = 'demo1234') => {
    const r = await api('POST', '/auth/login', { body: { email, password } });
    if (r.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(r.data)}`);
    return { token: r.data.token, fileToken: r.data.fileToken, user: r.data.user };
};

const makePdf = async (text = 'Test document') => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.drawText(text, { x: 50, y: 780, size: 18 });
    return Buffer.from(await doc.save({ useObjectStreams: false }));
};

const createWorkflow = async (adminToken, name, nodes, edges, metadata = {}) => {
    const r = await api('POST', '/workflows', {
        token: adminToken,
        body: { name, flow_structure: { nodes, edges, metadata: { isPublished: true, allowedSubmitters: [], ...metadata } } },
    });
    if (r.status !== 201) throw new Error(`Workflow "${name}" was rejected: ${JSON.stringify(r.data)}`);
    return r.data;
};

const submit = async (token, workflowId, { title = 'Request', tag } = {}) => {
    const form = new FormData();
    form.append('title', title);
    form.append('workflow_id', String(workflowId));
    if (tag) form.append('metadata_tag', tag);
    form.append('document', new Blob([await makePdf(title)], { type: 'application/pdf' }), 'request.pdf');
    const r = await api('POST', '/documents/upload', { token, form });
    if (r.status !== 201) throw new Error(`Upload failed: ${JSON.stringify(r.data)}`);
    return r.data.document;
};

/** Request an OTP (shown in the response when email isn't configured) and approve. */
const lastOtp = new Map();
const approve = async (token, documentId, comments = 'Looks good', extra = {}) => {
    const otpRes = await api('POST', '/approvals/request-otp', { token, body: { documentId } });
    const key = `${token}|${documentId}`;
    // A code requested in the last 30 seconds is still valid: reuse it
    const otp = otpRes.status === 429 ? lastOtp.get(key) : String(otpRes.data.message || '').match(/(\d{6})/)?.[1];
    if (otp) lastOtp.set(key, otp);
    if (!otp) throw new Error(`No OTP returned: ${JSON.stringify(otpRes.data)}`);
    return api('POST', '/approvals/approve', { token, body: { documentId, otp, comments, ...extra } });
};

/** An admin verification code for `userId`, issued directly (the email flow is tested elsewhere). */
const adminCode = async (userId) => (await require('../../src/services/oneTimeCodes').issueCode(userId, 'admin', { cooldownMs: 0 })).code;

const reject = (token, documentId, comments = 'Missing signature page') =>
    api('POST', '/approvals/reject', { token, body: { documentId, comments } });

const getDoc = async (documentId) => (await pool.query('SELECT * FROM documents WHERE id = $1', [documentId])).rows[0];

// Node builders matching what the workflow builder saves
const task = (id, assignee, extra = {}) => ({ id, type: 'task', position: { x: 0, y: 0 }, data: { label: id, assignee: String(assignee), ...extra } });
const roleTask = (id, roleId, extra = {}) => ({ id, type: 'task', position: { x: 0, y: 0 }, data: { label: id, assignmentStrategy: 'role_based', roleId: String(roleId), routingType: 'ANY', ...extra } });
const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } });
const edge = (source, target, sourceHandle) => ({ id: `${source}-${target}-${sourceHandle || ''}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

module.exports = {
    setup, teardown, databaseAvailable, api, login, makePdf, createWorkflow, submit, approve, reject, getDoc, adminCode,
    task, roleTask, node, edge,
    get pool() { return pool; },
    get origin() { return baseUrl.replace(/\/api$/, ''); },
};
