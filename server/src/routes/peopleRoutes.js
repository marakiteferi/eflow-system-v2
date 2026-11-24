/**
 * People: every account in the system, with its account type, permissions, department
 * and offices. Holders of "Manage people" add, import, edit and deactivate accounts.
 *
 * Changing someone's account type or permissions needs the admin verification code,
 * only Administrators can create or demote Administrators, and nobody can change their
 * own account type or permissions, or deactivate themselves.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const csv = require('csv-parser');
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const codes = require('../services/oneTimeCodes');
const { sendWelcome } = require('../services/mailer');
const { notifyUser } = require('../services/notifier');
const { ACCOUNT_TYPES, PERMISSIONS, STUDENT, STAFF, ADMINISTRATOR, requirePermission } = require('../services/access');

const upload = multer({ dest: 'uploads/', limits: { fileSize: 2 * 1024 * 1024 } });
const canManagePeople = requirePermission('manage_people');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const audit = (db, userId, action) => db.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)', [userId, action]);

const checkAdminCode = async (req, res) => {
    const status = await codes.checkCode(req.user.id, 'admin', req.body.otp);
    if (status === 'ok') {
        await codes.consumeCode(req.user.id, 'admin');
        return true;
    }
    res.status(400).json({
        message: status === 'expired' ? 'The verification code has expired. Request a new one.' : 'Enter the verification code sent to your email.',
        needsCode: true,
    });
    return false;
};

const cleanPermissions = (list) => [...new Set((Array.isArray(list) ? list : []).filter((p) => PERMISSIONS[p]))];

/** A link the new person opens to choose a password (valid 24 hours). */
const setPasswordLink = async (db, userId) => {
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [userId, token, new Date(Date.now() + 24 * 60 * 60 * 1000)]);
    return `${process.env.CLIENT_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
};

/** Work currently waiting on this person: single steps and parallel branches. */
const pendingWorkFor = async (db, userId) => (await db.query(
    `SELECT id, title FROM documents WHERE status = 'Pending' AND (current_assignee_id = $1
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(parallel_branch_data::jsonb, '[]'::jsonb)) b
                  WHERE b->>'status' = 'Pending' AND (b->>'assigneeId')::int = $1))`,
    [userId])).rows;

// ── Reading ─────────────────────────────────────────────────────────────────

// Everyone, with filters: ?q= (name or email), ?type=1|2|3, ?office=<id>, ?status=active|inactive, ?permission=<key>
router.get('/', authenticateToken, canManagePeople, async (req, res) => {
    const where = [];
    const params = [];
    // Each "?" in a condition stands for the same value
    const add = (sql, value) => { params.push(value); where.push(sql.split('?').join(`$${params.length}`)); };
    if (req.query.q) add('(u.name ILIKE ? OR u.email ILIKE ?)', `%${req.query.q}%`);
    if (req.query.type) add('u.role_id = ?', parseInt(req.query.type, 10));
    if (req.query.department) add('u.department_id = ?', parseInt(req.query.department, 10));
    if (req.query.office) add(`(EXISTS (SELECT 1 FROM office_members m WHERE m.user_id = u.id AND m.office_id = ?)
        OR EXISTS (SELECT 1 FROM offices o WHERE o.head_id = u.id AND o.id = ?))`, parseInt(req.query.office, 10));
    if (req.query.permission) add('(u.role_id = 3 OR EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id = u.id AND p.permission = ?))', req.query.permission);
    if (req.query.status === 'active') where.push('COALESCE(u.is_active, TRUE)');
    if (req.query.status === 'inactive') where.push('u.is_active = FALSE');
    try {
        const people = (await pool.query(
            `SELECT u.id, u.name, u.email, u.role_id, u.department_id, d.name AS department_name,
                    COALESCE(u.is_active, TRUE) AS is_active, u.created_at,
                    COALESCE((SELECT array_agg(p.permission ORDER BY p.permission) FROM user_permissions p WHERE p.user_id = u.id), '{}') AS permissions,
                    COALESCE((SELECT json_agg(json_build_object('id', o.id, 'name', o.name, 'is_head', o.head_id = u.id, 'position', op.name) ORDER BY o.name)
                              FROM offices o
                              LEFT JOIN office_members m ON m.office_id = o.id AND m.user_id = u.id
                              LEFT JOIN office_positions op ON op.id = m.position_id
                              WHERE o.head_id = u.id OR m.user_id = u.id), '[]') AS offices
             FROM users u LEFT JOIN departments d ON d.id = u.department_id
             ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
             ORDER BY COALESCE(u.is_active, TRUE) DESC, u.name ASC`,
            params
        )).rows;
        res.json(people.map((p) => ({
            ...p,
            account_type: ACCOUNT_TYPES[p.role_id] || 'Staff',
            permissions: p.role_id === ADMINISTRATOR ? Object.keys(PERMISSIONS) : p.permissions,
        })));
    } catch (err) {
        console.error('List people failed:', err);
        res.status(500).json({ message: 'Could not load people.' });
    }
});

// The permissions that exist, and who holds each one
router.get('/permissions', authenticateToken, canManagePeople, async (req, res) => {
    try {
        const admins = (await pool.query(
            'SELECT id, name, email FROM users WHERE role_id = 3 AND COALESCE(is_active, TRUE) ORDER BY name')).rows;
        const grants = (await pool.query(
            `SELECT p.permission, u.id, u.name, u.email, p.granted_at, g.name AS granted_by_name
             FROM user_permissions p JOIN users u ON u.id = p.user_id LEFT JOIN users g ON g.id = p.granted_by
             WHERE u.role_id <> 3 AND COALESCE(u.is_active, TRUE) ORDER BY u.name`)).rows;
        res.json({
            accountTypes: Object.entries(ACCOUNT_TYPES).map(([id, name]) => ({ id: Number(id), name })),
            administrators: admins,
            permissions: Object.entries(PERMISSIONS).map(([key, def]) => ({
                key, ...def, holders: grants.filter((g) => g.permission === key),
            })),
        });
    } catch (err) {
        console.error('List permissions failed:', err);
        res.status(500).json({ message: 'Could not load permissions.' });
    }
});

// ── Adding people ───────────────────────────────────────────────────────────

/** Validates one new account. Returns { error } or { person } ready to insert. */
const checkNewPerson = async (db, input, actor) => {
    const name = String(input.name || '').trim();
    const email = String(input.email || '').trim().toLowerCase();
    const roleId = parseInt(input.role_id, 10) || STUDENT;
    if (!name) return { error: 'A name is required.' };
    if (!EMAIL.test(email)) return { error: 'A valid email address is required.' };
    if (!ACCOUNT_TYPES[roleId]) return { error: 'Choose Student, Staff or Administrator.' };
    if (roleId === ADMINISTRATOR && actor.role_id !== ADMINISTRATOR) return { error: 'Only an Administrator can create another Administrator.' };
    if ((await db.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [email])).rows.length) return { error: 'Someone with this email already has an account.' };
    const departmentId = input.department_id ? parseInt(input.department_id, 10) : null;
    if (departmentId && !(await db.query('SELECT 1 FROM departments WHERE id = $1', [departmentId])).rows.length) return { error: 'That department does not exist.' };
    const officeId = input.office_id ? parseInt(input.office_id, 10) : null;
    const positionId = input.position_id ? parseInt(input.position_id, 10) : null;
    if (officeId) {
        if (roleId === STUDENT) return { error: 'Students cannot be officers.' };
        if (!(await db.query('SELECT 1 FROM offices WHERE id = $1', [officeId])).rows.length) return { error: 'That office does not exist.' };
        if (positionId && !(await db.query('SELECT 1 FROM office_positions WHERE id = $1 AND office_id = $2', [positionId, officeId])).rows.length) {
            return { error: 'That position is not in the chosen office.' };
        }
    }
    const permissions = roleId === STAFF ? cleanPermissions(input.permissions) : [];
    return { person: { name, email, roleId, departmentId, officeId, positionId: officeId ? positionId : null, permissions } };
};

const createPerson = async (db, p, actorId) => {
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const id = (await db.query(
        'INSERT INTO users (name, email, password_hash, role_id, department_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [p.name, p.email, hash, p.roleId, p.departmentId])).rows[0].id;
    for (const perm of p.permissions) {
        await db.query('INSERT INTO user_permissions (user_id, permission, granted_by) VALUES ($1, $2, $3)', [id, perm, actorId]);
    }
    if (p.officeId) {
        await db.query('INSERT INTO office_members (office_id, user_id, position_id) VALUES ($1, $2, $3)', [p.officeId, id, p.positionId]);
    }
    return { id, link: await setPasswordLink(db, id) };
};

// Add one person. They get an email with a link to choose their password.
router.post('/', authenticateToken, canManagePeople, async (req, res) => {
    const client = await pool.connect();
    try {
        const checked = await checkNewPerson(client, req.body, req.user);
        if (checked.error) return res.status(400).json({ message: checked.error });
        const p = checked.person;
        if ((p.roleId === ADMINISTRATOR || p.permissions.length) && !(await checkAdminCode(req, res))) return;
        await client.query('BEGIN');
        const created = await createPerson(client, p, req.user.id);
        await audit(client, req.user.id, `Added ${ACCOUNT_TYPES[p.roleId]} account: ${p.email}`);
        await client.query('COMMIT');
        const emailed = await sendWelcome({ name: p.name, email: p.email, link: created.link });
        res.status(201).json({
            id: created.id,
            message: emailed ? `${p.name} was added and emailed a link to set their password.` : `${p.name} was added.`,
            // Without email configured (development), hand the link back so it can be passed on
            ...(!emailed && process.env.NODE_ENV !== 'production' ? { setPasswordLink: created.link } : {}),
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Add person failed:', err);
        res.status(500).json({ message: 'Could not add this person.' });
    } finally {
        client.release();
    }
});

// CSV import, step 1: check every row and report problems. Columns: Name, Email, Type, Department, Office, Position
router.post('/import/preview', authenticateToken, canManagePeople, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Choose a CSV file.' });
    const rows = [];
    fs.createReadStream(req.file.path)
        .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim().toLowerCase() }))
        .on('data', (row) => rows.push(row))
        .on('error', () => res.status(400).json({ message: 'The file could not be read as CSV.' }))
        .on('end', async () => {
            fs.unlink(req.file.path, () => {});
            try {
                const types = Object.fromEntries(Object.entries(ACCOUNT_TYPES).map(([id, n]) => [n.toLowerCase(), Number(id)]));
                Object.assign(types, { admin: 3, 'super admin': 3, 'staff+': 2 });
                const lookup = async (table, name, extra = '', params = []) => name
                    ? (await pool.query(`SELECT id FROM ${table} WHERE TRIM(name) ILIKE $1 ${extra}`, [name, ...params])).rows[0]?.id || 0
                    : null;
                const seen = new Set();
                const report = [];
                for (const [i, row] of rows.entries()) {
                    const v = (k) => String(row[k] || '').trim();
                    const typeName = v('type') || v('role') || 'Student';
                    const input = {
                        name: v('name'), email: v('email'), role_id: types[typeName.toLowerCase()] || -1,
                        department_id: await lookup('departments', v('department')),
                        office_id: await lookup('offices', v('office')),
                    };
                    input.position_id = input.office_id ? await lookup('office_positions', v('position'), 'AND office_id = $2', [input.office_id]) : null;
                    let error = null;
                    if (input.role_id === -1) error = `Unknown account type "${typeName}". Use Student, Staff or Administrator.`;
                    else if (input.department_id === 0) error = `Department "${v('department')}" not found.`;
                    else if (input.office_id === 0) error = `Office "${v('office')}" not found.`;
                    else if (input.position_id === 0) error = `Position "${v('position')}" not found in ${v('office')}.`;
                    else if (seen.has(input.email.toLowerCase())) error = 'This email appears twice in the file.';
                    else error = (await checkNewPerson(pool, input, req.user)).error || null;
                    seen.add(input.email.toLowerCase());
                    report.push({
                        rowNumber: i + 1, name: input.name, email: input.email, type: typeName,
                        role_id: input.role_id, department: v('department'), department_id: input.department_id || null,
                        office: v('office'), office_id: input.office_id || null, position: v('position'), position_id: input.position_id || null,
                        isValid: !error, error,
                    });
                }
                res.json(report);
            } catch (err) {
                console.error('Import preview failed:', err);
                res.status(500).json({ message: 'Could not check the file.' });
            }
        });
});

// CSV import, step 2: create the valid rows (needs the verification code)
router.post('/import/commit', authenticateToken, canManagePeople, async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows.filter((r) => r.isValid) : [];
    if (!rows.length) return res.status(400).json({ message: 'There are no valid rows to import.' });
    if (!(await checkAdminCode(req, res))) return;
    const imported = [];
    const failed = [];
    for (const row of rows) {
        const client = await pool.connect();
        try {
            const checked = await checkNewPerson(client, row, req.user);
            if (checked.error) { failed.push({ email: row.email, error: checked.error }); continue; }
            await client.query('BEGIN');
            const created = await createPerson(client, checked.person, req.user.id);
            await audit(client, req.user.id, `Imported account from CSV: ${checked.person.email}`);
            await client.query('COMMIT');
            await sendWelcome({ name: checked.person.name, email: checked.person.email, link: created.link });
            imported.push(checked.person.email);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error(`Import of ${row.email} failed:`, err);
            failed.push({ email: row.email, error: 'Could not be created.' });
        } finally {
            client.release();
        }
    }
    res.json({ message: `Imported ${imported.length} ${imported.length === 1 ? 'person' : 'people'}.`, imported, failed });
});

// ── Editing ─────────────────────────────────────────────────────────────────

// Change name, department, account type or permissions
router.put('/:id', authenticateToken, canManagePeople, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const client = await pool.connect();
    try {
        const person = (await client.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
        if (!person) return res.status(404).json({ message: 'Person not found.' });
        const current = (await client.query('SELECT permission FROM user_permissions WHERE user_id = $1', [id])).rows.map((r) => r.permission);

        const roleId = req.body.role_id !== undefined ? parseInt(req.body.role_id, 10) : person.role_id;
        if (!ACCOUNT_TYPES[roleId]) return res.status(400).json({ message: 'Choose Student, Staff or Administrator.' });
        const permissions = roleId === STAFF
            ? (req.body.permissions !== undefined ? cleanPermissions(req.body.permissions) : current)
            : [];
        const typeChanged = roleId !== person.role_id;
        const permsChanged = permissions.length !== current.length || permissions.some((p) => !current.includes(p));

        if ((typeChanged || permsChanged) && id === req.user.id) {
            return res.status(403).json({ message: 'You cannot change your own account type or permissions.' });
        }
        if (typeChanged && (roleId === ADMINISTRATOR || person.role_id === ADMINISTRATOR) && req.user.role_id !== ADMINISTRATOR) {
            return res.status(403).json({ message: 'Only an Administrator can make or remove an Administrator.' });
        }
        if (typeChanged && roleId === STUDENT) {
            const roles = (await client.query(
                `SELECT name FROM offices WHERE head_id = $1 UNION
                 SELECT o.name FROM office_members m JOIN offices o ON o.id = m.office_id WHERE m.user_id = $1`, [id])).rows;
            if (roles.length) return res.status(409).json({ message: `Remove them from ${roles.map((r) => r.name).join(', ')} first: students cannot work in an office.` });
        }
        const name = req.body.name !== undefined ? String(req.body.name).trim() : person.name;
        if (!name) return res.status(400).json({ message: 'A name is required.' });
        const departmentId = req.body.department_id !== undefined ? (parseInt(req.body.department_id, 10) || null) : person.department_id;

        if ((typeChanged || permsChanged) && !(await checkAdminCode(req, res))) return;

        await client.query('BEGIN');
        await client.query('UPDATE users SET name = $1, role_id = $2, department_id = $3 WHERE id = $4', [name, roleId, departmentId, id]);
        if (permsChanged || typeChanged) {
            await client.query('DELETE FROM user_permissions WHERE user_id = $1 AND NOT (permission = ANY($2))', [id, permissions]);
            for (const p of permissions) {
                await client.query('INSERT INTO user_permissions (user_id, permission, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, p, req.user.id]);
            }
        }
        const changes = [
            typeChanged && `account type ${ACCOUNT_TYPES[person.role_id]} → ${ACCOUNT_TYPES[roleId]}`,
            permsChanged && `permissions: ${permissions.map((p) => PERMISSIONS[p].label).join(', ') || 'none'}`,
            name !== person.name && 'name',
            departmentId !== person.department_id && 'department',
        ].filter(Boolean);
        if (changes.length) await audit(client, req.user.id, `Updated ${person.email}: ${changes.join('; ')}`);
        await client.query('COMMIT');
        res.json({ message: `${name} updated.` });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Update person failed:', err);
        res.status(500).json({ message: 'Could not update this person.' });
    } finally {
        client.release();
    }
});

// Deactivate: they can no longer sign in. Waiting work must go to someone else first.
router.post('/:id/deactivate', authenticateToken, canManagePeople, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) return res.status(403).json({ message: 'You cannot deactivate your own account.' });
    const client = await pool.connect();
    try {
        const person = (await client.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
        if (!person) return res.status(404).json({ message: 'Person not found.' });
        if (person.role_id === ADMINISTRATOR && req.user.role_id !== ADMINISTRATOR) {
            return res.status(403).json({ message: 'Only an Administrator can deactivate an Administrator.' });
        }
        const heads = (await client.query('SELECT name FROM offices WHERE head_id = $1', [id])).rows;
        if (heads.length) return res.status(409).json({ message: `Appoint a new head of ${heads.map((h) => h.name).join(', ')} first.` });

        const work = await pendingWorkFor(client, id);
        const reassignTo = req.body.reassign_to ? parseInt(req.body.reassign_to, 10) : null;
        if (work.length && !reassignTo) {
            return res.status(409).json({
                message: `${work.length} document(s) are waiting on ${person.name}. Choose who takes them over.`,
                pending: work,
            });
        }
        if (reassignTo) {
            const target = (await client.query('SELECT role_id, COALESCE(is_active, TRUE) AS active FROM users WHERE id = $1', [reassignTo])).rows[0];
            if (!target || !target.active || target.role_id === STUDENT || reassignTo === id) {
                return res.status(400).json({ message: 'Hand the work to another active staff member.' });
            }
        }

        await client.query('BEGIN');
        // Office steps they had claimed go back to the office queue; everything else goes to the new person
        const toQueue = await client.query(
            `UPDATE documents SET current_assignee_id = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE status = 'Pending' AND current_assignee_id = $1 AND current_office_id IS NOT NULL RETURNING id`, [id]);
        const moved = reassignTo ? await client.query(
            `UPDATE documents SET current_assignee_id = $2, updated_at = CURRENT_TIMESTAMP
             WHERE status = 'Pending' AND current_assignee_id = $1 RETURNING id, title`, [id, reassignTo]) : { rows: [] };
        const parallel = (await client.query(
            `SELECT id, parallel_branch_data FROM documents WHERE status = 'Pending' AND parallel_branch_data IS NOT NULL`)).rows;
        for (const doc of parallel) {
            let changed = false;
            const branches = doc.parallel_branch_data.map((b) => {
                if (b.status !== 'Pending' || b.assigneeId !== id) return b;
                changed = true;
                return { ...b, assigneeId: b.officeId ? null : reassignTo };
            });
            if (changed) await client.query('UPDATE documents SET parallel_branch_data = $1 WHERE id = $2', [JSON.stringify(branches), doc.id]);
        }
        for (const doc of moved.rows) {
            await notifyUser(client, reassignTo, {
                title: '📥 Handed over to you',
                body: `"${doc.title}" was handed over to you because ${person.name}'s account was deactivated.`,
                type: 'task',
                documentId: doc.id,
            });
        }
        await client.query('DELETE FROM office_members WHERE user_id = $1', [id]);
        await client.query('UPDATE users SET is_out_of_office = FALSE, delegate_id = NULL WHERE delegate_id = $1', [id]);
        await client.query('UPDATE users SET is_active = FALSE WHERE id = $1', [id]);
        await audit(client, req.user.id, `Deactivated ${person.email}${reassignTo ? `; work handed to user ${reassignTo}` : ''}`);
        await client.query('COMMIT');
        res.json({ message: `${person.name} was deactivated.`, handedOver: moved.rows.length, returnedToQueue: toQueue.rows.length });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Deactivate failed:', err);
        res.status(500).json({ message: 'Could not deactivate this account.' });
    } finally {
        client.release();
    }
});

router.post('/:id/reactivate', authenticateToken, canManagePeople, async (req, res) => {
    try {
        const r = await pool.query('UPDATE users SET is_active = TRUE WHERE id = $1 RETURNING name, email', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ message: 'Person not found.' });
        await audit(pool, req.user.id, `Reactivated ${r.rows[0].email}`);
        res.json({ message: `${r.rows[0].name} can sign in again.` });
    } catch (err) {
        console.error('Reactivate failed:', err);
        res.status(500).json({ message: 'Could not reactivate this account.' });
    }
});

// A fresh set-password link, for someone who lost their welcome email
router.post('/:id/send-setup-link', authenticateToken, canManagePeople, async (req, res) => {
    try {
        const p = (await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.params.id])).rows[0];
        if (!p) return res.status(404).json({ message: 'Person not found.' });
        const link = await setPasswordLink(pool, p.id);
        const emailed = await sendWelcome({ name: p.name, email: p.email, link });
        res.json({
            message: emailed ? `A new link was emailed to ${p.email}.` : 'A new link was created.',
            ...(!emailed && process.env.NODE_ENV !== 'production' ? { setPasswordLink: link } : {}),
        });
    } catch (err) {
        console.error('Setup link failed:', err);
        res.status(500).json({ message: 'Could not create a link.' });
    }
});

module.exports = router;
