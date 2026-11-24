/**
 * Demo data for showing E-Flow: offices with positions, staff and students, four live
 * services and requests at every stage (waiting in a queue, claimed, approved, sent back, overdue).
 *
 *   npm run db:setup -- --reset   recreates the database and loads this demo (skip it with --no-demo)
 *   npm run db:demo               loads the demo into an existing database (only once)
 *
 * Accounts and offices are written directly; services and requests go through the real API,
 * so every request is routed, signed and stamped exactly as it would be in use.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const sharp = require('sharp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const MARKER_WORKFLOW = 'Official Transcript Request';

const DEPARTMENTS = ['Computer Science', 'Electrical Engineering', 'Business Administration'];

// role_id: 1 = Student, 2 = Staff, 3 = Administrator
const PEOPLE = [
    { key: 'registrar', name: 'Hana Tesfaye', email: 'registrar@example.com', role_id: 2 },
    { key: 'deputy', name: 'Samuel Girma', email: 'deputy.registrar@example.com', role_id: 2 },
    { key: 'records', name: 'Meron Alemu', email: 'records@example.com', role_id: 2 },
    { key: 'librarian', name: 'Yonas Kebede', email: 'librarian@example.com', role_id: 2 },
    { key: 'library', name: 'Liya Haile', email: 'library@example.com', role_id: 2 },
    { key: 'finance', name: 'Tigist Worku', email: 'finance@example.com', role_id: 2 },
    { key: 'cashier', name: 'Bereket Assefa', email: 'cashier@example.com', role_id: 2 },
    { key: 'dean', name: 'Dr. Selam Mekonnen', email: 'dean@example.com', role_id: 2 },
    { key: 'affairs', name: 'Kalkidan Tadesse', email: 'studentaffairs@example.com', role_id: 2 },
    { key: 'designer', name: 'Elias Negash', email: 'designer@example.com', role_id: 2, permissions: ['design_workflows', 'manage_offices'] },
    { key: 'abebe', name: 'Abebe Bikila', email: 'abebe@example.com', role_id: 1, department: 'Computer Science' },
    { key: 'sara', name: 'Sara Mohammed', email: 'sara@example.com', role_id: 1, department: 'Electrical Engineering' },
    { key: 'nahom', name: 'Nahom Desta', email: 'nahom@example.com', role_id: 1, department: 'Business Administration' },
    { key: 'ruth', name: 'Ruth Abraham', email: 'ruth@example.com', role_id: 1, department: 'Computer Science' },
];

const OFFICES = [
    {
        name: "Registrar's Office", description: 'Transcripts, enrolment records, ID cards and graduation', head: 'registrar',
        // Late Records Officer work goes to the Deputy Registrar, then to the head
        positions: [{ name: 'Deputy Registrar' }, { name: 'Records Officer', reportsTo: 'Deputy Registrar' }],
        members: [{ key: 'deputy', position: 'Deputy Registrar' }, { key: 'records', position: 'Records Officer' }, { email: 'staff2@example.com' }],
    },
    {
        name: 'Library', description: 'Borrowing, fines and library clearance', head: 'librarian',
        positions: [{ name: 'Circulation Officer' }],
        members: [{ key: 'library', position: 'Circulation Officer' }, { email: 'staff@example.com' }],
    },
    {
        name: 'Finance Office', description: 'Fees, payments and waivers', head: 'finance',
        positions: [{ name: 'Cashier' }],
        members: [{ key: 'cashier', position: 'Cashier' }],
    },
    {
        name: 'Dean of Students', description: 'Student welfare, conduct and support', head: 'dean',
        positions: [{ name: 'Student Affairs Officer' }],
        members: [{ key: 'affairs', position: 'Student Affairs Officer' }],
    },
];

// ── Building blocks ──────────────────────────────────────────────────────────

const edgeStyle = (handle) => {
    const stroke = handle === 'true' ? '#22c55e' : handle === 'false' ? '#ef4444' : '#64748b';
    return { type: 'smoothstep', animated: true, style: { stroke, strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: stroke } };
};
const edge = (source, target, sourceHandle) => ({
    id: `e-${source}-${target}${sourceHandle ? `-${sourceHandle}` : ''}`, source, target, ...(sourceHandle ? { sourceHandle } : {}), ...edgeStyle(sourceHandle),
});
const at = (col, row) => ({ x: col * 300, y: row * 160 });

/** An approval step for an office: 'officer' (shared queue), 'head', or a position name */
const step = (id, label, office, who, pos, extra = {}) => ({ id, type: 'task', position: pos, data: { label, assignmentStrategy: 'office', _office: office, _who: who, ...extra } });
const email = (id, label, subject, body, pos) => ({ id, type: 'email', position: pos, data: { label, recipient: '{{submitter_email}}', subject, body } });
const node = (id, type, label, pos, data = {}) => ({ id, type, position: pos, data: { label, ...data } });

const SERVICES = [
    {
        name: MARKER_WORKFLOW,
        nodes: [
            step('fee', 'Check the transcript fee', 'Finance Office', 'Cashier', at(1, 0), {
                checklist: ['Fee receipt is attached', 'Amount matches the fee schedule'],
                escalationHours: 24, workingDaysOnly: true, reminderHours: 4,
                allowedActions: ['approve', 'reject', 'attach_documents'],
            }),
            step('prepare', 'Prepare the transcript', "Registrar's Office", 'Records Officer', at(1, 1), {
                checklist: ['All grades for the requested terms are final', 'Name and student ID match the records'],
                escalationHours: 72, workingDaysOnly: true, reminderHours: 24, warningHours: 8,
            }),
            step('sign', 'Registrar signs', "Registrar's Office", 'head', at(1, 2), { escalationHours: 24, workingDaysOnly: true }),
            email('notify', 'Tell the student', 'Your official transcript is ready',
                'Dear {{submitter_name}}, your request "{{document_title}}" has been signed by the Registrar. You can download the stamped transcript from E-Flow.', at(1, 3)),
        ],
        edges: [edge('fee', 'prepare'), edge('prepare', 'sign'), edge('sign', 'notify')],
    },
    {
        name: 'Graduation Clearance',
        nodes: [
            node('split', 'parallel', 'Clear with every office', at(1, 0)),
            step('library', 'Library clearance', 'Library', 'officer', at(0, 1), {
                checklist: ['No books on loan', 'No unpaid library fines'], escalationHours: 72, workingDaysOnly: true, reminderHours: 24,
            }),
            step('finance', 'Finance clearance', 'Finance Office', 'Cashier', at(1, 1), {
                checklist: ['Tuition is fully paid', 'No outstanding fees'], escalationHours: 72, workingDaysOnly: true, reminderHours: 24,
            }),
            step('conduct', 'Student conduct check', 'Dean of Students', 'Student Affairs Officer', at(2, 1), {
                checklist: ['No open disciplinary cases'], escalationHours: 72, workingDaysOnly: true,
            }),
            node('merge', 'join', 'All offices cleared', at(1, 2)),
            step('final', 'Registrar approves graduation', "Registrar's Office", 'head', at(1, 3), { escalationHours: 168, workingDaysOnly: true, reminderHours: 48 }),
            email('notify', 'Tell the student', 'You are cleared for graduation',
                'Congratulations {{submitter_name}}! Every office has cleared you and the Registrar has approved your graduation.', at(1, 4)),
        ],
        edges: [
            edge('split', 'library'), edge('split', 'finance'), edge('split', 'conduct'),
            edge('library', 'merge'), edge('finance', 'merge'), edge('conduct', 'merge'),
            edge('merge', 'final'), edge('final', 'notify'),
        ],
    },
    {
        name: 'Fee Waiver Application',
        nodes: [
            step('assess', 'Assess financial need', 'Dean of Students', 'Student Affairs Officer', at(1, 0), {
                checklist: ['Income statement is attached', 'Recommendation letter is attached'],
                allowedTags: 'Full waiver, Partial waiver', escalationHours: 120, workingDaysOnly: true, reminderHours: 24,
            }),
            node('route', 'condition', 'Full or partial?', at(1, 1), { conditionValue: 'Full waiver' }),
            step('approveFull', 'Finance head approves full waiver', 'Finance Office', 'head', at(0, 2), { escalationHours: 72, workingDaysOnly: true }),
            step('applyPartial', 'Cashier applies partial waiver', 'Finance Office', 'Cashier', at(2, 2), {
                checklist: ['Waiver amount entered in the fee system'], escalationHours: 48, workingDaysOnly: true,
            }),
            email('notifyFull', 'Tell the student (full)', 'Your fee waiver was approved',
                'Dear {{submitter_name}}, your application "{{document_title}}" was approved as a full waiver.', at(0, 3)),
            email('notifyPartial', 'Tell the student (partial)', 'Your fee waiver was approved',
                'Dear {{submitter_name}}, your application "{{document_title}}" was approved as a partial waiver. Your new balance is shown in the fee system.', at(2, 3)),
        ],
        edges: [
            edge('assess', 'route'), edge('route', 'approveFull', 'true'), edge('route', 'applyPartial', 'false'),
            edge('approveFull', 'notifyFull'), edge('applyPartial', 'notifyPartial'),
        ],
    },
    {
        name: 'Student ID Replacement',
        nodes: [
            step('issue', 'Issue a new ID card', "Registrar's Office", 'officer', at(1, 0), {
                checklist: ['Lost-ID statement or police report is attached', 'Replacement fee is paid'],
                escalationHours: 48, workingDaysOnly: true, reminderHours: 8,
            }),
            email('notify', 'Tell the student', 'Your new ID card is ready',
                'Dear {{submitter_name}}, your new student ID card is ready for collection at the Registrar\'s Office.', at(1, 1)),
        ],
        edges: [edge('issue', 'notify')],
    },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A hand-drawn-looking signature (an SVG path, so no fonts are needed), as a PNG data URL */
const signatureFor = async (name) => {
    let seed = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed % 1000) / 1000; };
    let d = `M 20 ${60 + rand() * 20}`;
    let x = 20;
    while (x < 300) {
        const nx = x + 25 + rand() * 25;
        d += ` C ${x + 8} ${10 + rand() * 30}, ${nx - 8} ${90 + rand() * 20}, ${nx} ${45 + rand() * 30}`;
        x = nx;
    }
    d += ` M 30 ${95 + rand() * 6} Q 170 ${80 + rand() * 10} 310 ${92 + rand() * 6}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="120"><path d="${d}" fill="none" stroke="#1e3a8a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
};

const letterPdf = async ({ title, student, lines }) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: rgb(0.27, 0.31, 0.9) });
    page.drawText('E-Flow University', { x: 50, y: 810, size: 16, font: bold, color: rgb(1, 1, 1) });
    page.drawText(title, { x: 50, y: 740, size: 20, font: bold, color: rgb(0.1, 0.1, 0.15) });
    // Short text runs only: the text extractor used on upload rejects very long ones
    const grey = rgb(0.3, 0.3, 0.35);
    page.drawText(`Applicant: ${student.name}`, { x: 50, y: 712, size: 11, font, color: grey });
    page.drawText(`Department: ${student.department || 'n/a'}`, { x: 50, y: 696, size: 11, font, color: grey });
    page.drawText(`Date: ${new Date().toDateString()}`, { x: 50, y: 680, size: 11, font, color: grey });
    let y = 640;
    for (const paragraph of lines) {
        const words = paragraph.split(' ');
        let line = '';
        for (const w of words) {
            if ((line + ' ' + w).trim().length > 50) {
                page.drawText(line.trim(), { x: 50, y, size: 12, font, color: rgb(0.15, 0.15, 0.2) });
                y -= 18;
                line = '';
            }
            line += ' ' + w;
        }
        page.drawText(line.trim(), { x: 50, y, size: 12, font, color: rgb(0.15, 0.15, 0.2) });
        y -= 26;
    }
    page.drawText(`Signed, ${student.name}`, { x: 50, y: y - 30, size: 12, font: bold });
    return Buffer.from(await doc.save({ useObjectStreams: false }));
};

const REQUEST_TEXT = {
    [MARKER_WORKFLOW]: ['I request an official copy of my academic transcript for all completed terms.', 'The transcript fee receipt is attached as page 2.', 'Please send it to me once it is signed.'],
    'Graduation Clearance': ['I have completed all courses in my programme and request clearance for graduation.', 'Please confirm that I have no outstanding obligations with your office.'],
    'Fee Waiver Application': ['I am applying for a waiver of my tuition fees for the coming semester.', 'My family income statement and a recommendation letter are attached.'],
    'Student ID Replacement': ['My student ID card was lost on campus last week.', 'I attach a signed lost-ID statement and the replacement fee receipt.'],
};

// ── Main ─────────────────────────────────────────────────────────────────────

async function seedDemo({ quiet = false } = {}) {
    const log = (...a) => { if (!quiet) console.log(...a); };
    const serverDir = path.join(__dirname, '..');
    process.chdir(serverDir); // uploads are stored relative to server/
    fs.mkdirSync(path.join(serverDir, 'uploads'), { recursive: true });

    const app = require('../src/index');
    const pool = require('../src/db');
    const codes = require('../src/services/oneTimeCodes');
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const api = async (method, url, { token, body, form } = {}) => {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        let payload;
        if (form) payload = form;
        else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
        const res = await fetch(base + url, { method, headers, body: payload });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch (e) { data = text; }
        if (res.status >= 400) throw new Error(`${method} ${url} failed (${res.status}): ${typeof data === 'string' ? data : data.message || JSON.stringify(data)}`);
        return data;
    };

    try {
        if ((await pool.query('SELECT 1 FROM workflows WHERE name = $1', [MARKER_WORKFLOW])).rows.length) {
            log('Demo data is already loaded.');
            return false;
        }

        // Departments, people, permissions and signatures
        const deptId = {};
        for (const name of DEPARTMENTS) {
            deptId[name] = (await pool.query(
                'INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [name])).rows[0].id;
        }
        const hash = await bcrypt.hash(PASSWORD, 10);
        const ids = {};
        for (const p of PEOPLE) {
            const r = await pool.query(
                `INSERT INTO users (name, email, password_hash, role_id, department_id, signature_data)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, department_id = EXCLUDED.department_id,
                     signature_data = COALESCE(users.signature_data, EXCLUDED.signature_data)
                 RETURNING id`,
                [p.name, p.email, hash, p.role_id, p.department ? deptId[p.department] : null, p.role_id === 1 ? null : await signatureFor(p.name)]
            );
            ids[p.key] = r.rows[0].id;
            for (const perm of p.permissions || []) {
                await pool.query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ids[p.key], perm]);
            }
        }
        // The general demo accounts can approve too
        for (const e of ['admin@example.com', 'staff@example.com', 'staff2@example.com']) {
            const u = (await pool.query('SELECT id, name FROM users WHERE email = $1', [e])).rows[0];
            if (u) await pool.query('UPDATE users SET signature_data = COALESCE(signature_data, $1) WHERE id = $2', [await signatureFor(u.name), u.id]);
        }
        const idOf = async (m) => m.key ? ids[m.key] : (await pool.query('SELECT id FROM users WHERE email = $1', [m.email])).rows[0]?.id;

        // Offices, positions (with reporting lines) and officers
        const offices = {};
        for (const o of OFFICES) {
            const officeId = (await pool.query(
                `INSERT INTO offices (name, description, head_id) VALUES ($1, $2, $3)
                 ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, head_id = EXCLUDED.head_id RETURNING id`,
                [o.name, o.description, ids[o.head]])).rows[0].id;
            const positions = {};
            for (const p of o.positions) {
                const existing = (await pool.query('SELECT id FROM office_positions WHERE office_id = $1 AND name = $2', [officeId, p.name])).rows[0];
                positions[p.name] = existing?.id || (await pool.query(
                    'INSERT INTO office_positions (office_id, name, reports_to_id) VALUES ($1, $2, $3) RETURNING id',
                    [officeId, p.name, positions[p.reportsTo] || null])).rows[0].id;
            }
            for (const m of o.members) {
                const userId = await idOf(m);
                if (!userId) continue;
                await pool.query(
                    `INSERT INTO office_members (office_id, user_id, position_id) VALUES ($1, $2, $3)
                     ON CONFLICT (office_id, user_id) DO UPDATE SET position_id = EXCLUDED.position_id`,
                    [officeId, userId, positions[m.position] || null]);
            }
            offices[o.name] = { id: officeId, positions };
        }
        log(`Created ${PEOPLE.length} people and ${OFFICES.length} offices`);

        // Services, designed by the workflow designer through the API
        const login = async (key) => {
            const email = PEOPLE.find((p) => p.key === key)?.email || key;
            return (await api('POST', '/auth/login', { body: { email, password: PASSWORD } })).token;
        };
        const designer = await login('designer');
        const workflows = {};
        for (const s of SERVICES) {
            const nodes = s.nodes.map((n) => {
                if (n.type !== 'task') return n;
                const { _office, _who, ...data } = n.data;
                const office = offices[_office];
                const who = _who === 'officer' || _who === 'head'
                    ? { officePosition: _who }
                    : { officePosition: 'position', positionId: String(office.positions[_who]) };
                return { ...n, data: { ...data, officeId: String(office.id), ...who } };
            });
            const wf = await api('POST', '/workflows', {
                token: designer,
                body: { name: s.name, flow_structure: { nodes, edges: s.edges, metadata: { isPublished: true, allowedSubmitters: [1] } } },
            });
            workflows[s.name] = { id: wf.id, nodes };
        }
        log(`Published ${SERVICES.length} services`);

        // Requests at different stages
        const tokens = {};
        const tokenFor = async (key) => (tokens[key] ||= await login(key));
        const submit = async (studentKey, service, title) => {
            const student = PEOPLE.find((p) => p.key === studentKey);
            const form = new FormData();
            form.append('title', title);
            form.append('workflow_id', String(workflows[service].id));
            const pdf = await letterPdf({ title, student, lines: REQUEST_TEXT[service] });
            form.append('document', new Blob([pdf], { type: 'application/pdf' }), 'request.pdf');
            return (await api('POST', '/documents/upload', { token: await tokenFor(studentKey), form })).document;
        };
        const stepOf = (service, nodeId) => workflows[service].nodes.find((n) => n.id === nodeId);
        const claim = async (who, docId) => api('POST', `/offices/queue/${docId}/claim`, { token: await tokenFor(who) });
        const approve = async (who, docId, service, nodeId, { comments, outcome, claimFirst = true } = {}) => {
            const node = stepOf(service, nodeId);
            if (claimFirst && node.data.officePosition !== 'head') {
                const doc = (await pool.query('SELECT current_assignee_id, parallel_branch_data FROM documents WHERE id = $1', [docId])).rows[0];
                if (!Array.isArray(doc.parallel_branch_data) && !doc.current_assignee_id) await claim(who, docId);
            }
            const userId = ids[who];
            const { code } = await codes.issueCode(userId, 'approval', { documentId: docId, cooldownMs: 0 });
            const signature = (await pool.query('SELECT signature_data FROM users WHERE id = $1', [userId])).rows[0].signature_data;
            await api('POST', '/approvals/approve', {
                token: await tokenFor(who),
                body: { documentId: docId, otp: code, comments, signatureDrawing: signature, checklist: node.data.checklist || [], outcome },
            });
        };
        const reject = async (who, docId, comments) => {
            const doc = (await pool.query('SELECT current_assignee_id FROM documents WHERE id = $1', [docId])).rows[0];
            if (!doc.current_assignee_id) await claim(who, docId);
            await api('POST', '/approvals/reject', { token: await tokenFor(who), body: { documentId: docId, comments } });
        };
        const T = MARKER_WORKFLOW;

        // Transcripts: one finished, one waiting for the Records Officer, one claimed by the cashier
        const t1 = await submit('abebe', T, 'Official transcript for graduate school');
        await approve('cashier', t1.id, T, 'fee', { comments: 'Receipt matches; fee paid in full.' });
        await approve('records', t1.id, T, 'prepare', { comments: 'Transcript prepared for all eight terms.' });
        await approve('registrar', t1.id, T, 'sign', { comments: 'Approved.' });

        const t2 = await submit('sara', T, 'Transcript for a scholarship application');
        await approve('cashier', t2.id, T, 'fee', { comments: 'Paid.' });

        const t3 = await submit('nahom', T, 'Transcript for an employer');
        await claim('cashier', t3.id);

        // Graduation clearance: one part way through, one just submitted
        const g1 = await submit('ruth', 'Graduation Clearance', 'Graduation clearance, BSc Computer Science');
        await approve('library', g1.id, 'Graduation Clearance', 'library', { comments: 'No loans or fines.' });
        await approve('affairs', g1.id, 'Graduation Clearance', 'conduct', { comments: 'No cases on record.' });
        await submit('abebe', 'Graduation Clearance', 'Graduation clearance, BSc Computer Science');

        // Fee waivers: one assessed as partial (now with the cashier), one waiting for a decision
        const w1 = await submit('nahom', 'Fee Waiver Application', 'Fee waiver, second semester');
        await approve('affairs', w1.id, 'Fee Waiver Application', 'assess', { outcome: 'Partial waiver', comments: 'Need confirmed; partial waiver recommended.' });
        await submit('sara', 'Fee Waiver Application', 'Fee waiver for the final year');

        // ID cards: one sent back to the student, one overdue in the Registrar queue
        const i1 = await submit('ruth', 'Student ID Replacement', 'Replacement student ID');
        await reject('deputy', i1.id, 'The lost-ID statement is not signed. Please sign it and resubmit.');
        const i2 = await submit('abebe', 'Student ID Replacement', 'Replacement student ID card');
        await pool.query("UPDATE documents SET delegation_sla_deadline = NOW() - INTERVAL '3 hours', created_at = NOW() - INTERVAL '3 days' WHERE id = $1", [i2.id]);

        log('Created 9 requests at different stages');
        return true;
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await pool.end();
    }
}

module.exports = { seedDemo, PEOPLE, OFFICES };

if (require.main === module) {
    seedDemo()
        .then((created) => {
            if (created) {
                console.log(`\nDemo loaded. Every demo account uses the password: ${PASSWORD}`);
                PEOPLE.forEach((p) => console.log(`   ${p.email.padEnd(30)} ${p.name}`));
            }
            process.exit(0);
        })
        .catch((err) => { console.error('Loading the demo failed:', err.message); process.exit(1); });
}
