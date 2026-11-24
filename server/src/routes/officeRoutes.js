/**
 * Offices (Registrar, Library, Finance...): the admin creates offices and appoints a head;
 * each head manages their own officers, the positions in the office (Deputy, Cashier...)
 * and who covers for whom. Workflow steps can be sent to an office, or to one position in
 * it, where an officer claims the document from the shared queue.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const { parseFlow } = require('../services/workflowGraph');

const { hasPermission } = require('../services/access');

const STUDENT_ROLE_ID = 1;

// Administrators, and staff given "Manage offices", manage every office
const isAdmin = (user) => hasPermission(user, 'manage_offices');

const requireAdmin = async (req, res, next) => {
    try {
        if (await isAdmin(req.user)) return next();
        return res.status(403).json({ message: 'You need the "Manage offices" permission to do this.' });
    } catch (err) {
        return res.status(500).json({ message: 'Server error verifying permissions.' });
    }
};

/** The admin, or the head of the office in the URL. */
const requireHeadOrAdmin = async (req, res, next) => {
    try {
        if (await isAdmin(req.user)) return next();
        const r = await pool.query('SELECT 1 FROM offices WHERE id = $1 AND head_id = $2', [req.params.id, req.user.id]);
        if (r.rows.length) return next();
        return res.status(403).json({ message: 'Only the head of this office or an administrator can do this.' });
    } catch (err) {
        return res.status(500).json({ message: 'Server error verifying permissions.' });
    }
};

const isStaff = async (db, userId) => {
    const r = await db.query('SELECT role_id FROM users WHERE id = $1', [userId]);
    return r.rows[0] && r.rows[0].role_id !== STUDENT_ROLE_ID;
};

const officeDetails = async (where = '', params = []) => {
    const offices = (await pool.query(
        `SELECT o.id, o.name, o.description, o.head_id, h.name AS head_name, h.email AS head_email,
                h.is_out_of_office AS head_out_of_office, h.delegate_id AS head_delegate_id
         FROM offices o LEFT JOIN users h ON h.id = o.head_id ${where} ORDER BY o.name`,
        params
    )).rows;
    if (!offices.length) return [];
    const members = (await pool.query(
        `SELECT m.office_id, m.position_id, p.name AS position_name, u.id, u.name, u.email,
                u.is_out_of_office, u.delegate_id, d.name AS delegate_name
         FROM office_members m JOIN users u ON u.id = m.user_id LEFT JOIN users d ON d.id = u.delegate_id
         LEFT JOIN office_positions p ON p.id = m.position_id
         WHERE m.office_id = ANY($1) AND COALESCE(u.is_active, TRUE) ORDER BY u.name`,
        [offices.map((o) => o.id)]
    )).rows;
    const positions = (await pool.query(
        `SELECT p.id, p.office_id, p.name, p.reports_to_id, r.name AS reports_to_name,
                (SELECT COUNT(*)::int FROM office_members m WHERE m.position_id = p.id) AS holders
         FROM office_positions p LEFT JOIN office_positions r ON r.id = p.reports_to_id
         WHERE p.office_id = ANY($1) ORDER BY p.name`,
        [offices.map((o) => o.id)]
    )).rows;
    const queue = (await pool.query(
        `SELECT current_office_id AS office_id, COUNT(*)::int AS waiting,
                COUNT(*) FILTER (WHERE current_assignee_id IS NULL)::int AS unclaimed
         FROM documents WHERE status = 'Pending' AND current_office_id = ANY($1) GROUP BY current_office_id`,
        [offices.map((o) => o.id)]
    )).rows;
    return offices.map((o) => ({
        ...o,
        members: members.filter((m) => m.office_id === o.id),
        positions: positions.filter((p) => p.office_id === o.id),
        waiting: queue.find((q) => q.office_id === o.id)?.waiting || 0,
        unclaimed: queue.find((q) => q.office_id === o.id)?.unclaimed || 0,
    }));
};

// ── Reading ─────────────────────────────────────────────────────────────────

// All offices (staff and admins: the workflow builder and admin screens use this)
router.get('/', authenticateToken, async (req, res) => {
    if (req.user.role_id === STUDENT_ROLE_ID) return res.status(403).json({ message: 'Not available.' });
    try {
        res.json(await officeDetails());
    } catch (err) {
        console.error('List offices failed:', err);
        res.status(500).json({ message: 'Could not load offices.' });
    }
});

// The offices I work in, and which of them I head
router.get('/mine', authenticateToken, async (req, res) => {
    try {
        const offices = await officeDetails(
            'WHERE o.head_id = $1 OR EXISTS (SELECT 1 FROM office_members m WHERE m.office_id = o.id AND m.user_id = $1)',
            [req.user.id]
        );
        res.json(offices.map((o) => ({ ...o, i_am_head: o.head_id === req.user.id })));
    } catch (err) {
        console.error('My offices failed:', err);
        res.status(500).json({ message: 'Could not load your offices.' });
    }
});

// Staff who can be added to an office
router.get('/staff-directory', authenticateToken, async (req, res) => {
    if (req.user.role_id === STUDENT_ROLE_ID) return res.status(403).json({ message: 'Not available.' });
    const r = await pool.query(`SELECT id, name, email FROM users WHERE role_id <> $1 AND COALESCE(is_active, TRUE) ORDER BY name`, [STUDENT_ROLE_ID]);
    res.json(r.rows);
});

// ── Admin: offices and heads ────────────────────────────────────────────────

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    const name = String(req.body.name || '').trim();
    const headId = req.body.head_id ? parseInt(req.body.head_id, 10) : null;
    if (!name) return res.status(400).json({ message: 'Give the office a name.' });
    try {
        if (headId && !(await isStaff(pool, headId))) return res.status(400).json({ message: 'The head must be a staff member.' });
        const r = await pool.query(
            'INSERT INTO offices (name, description, head_id) VALUES ($1, $2, $3) RETURNING *',
            [name, req.body.description || null, headId]
        );
        await pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)', [req.user.id, `Office created: ${name}`]);
        res.status(201).json(r.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: 'An office with that name already exists.' });
        console.error('Create office failed:', err);
        res.status(500).json({ message: 'Could not create the office.' });
    }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    const headId = req.body.head_id ? parseInt(req.body.head_id, 10) : null;
    try {
        if (headId && !(await isStaff(pool, headId))) return res.status(400).json({ message: 'The head must be a staff member.' });
        const r = await pool.query(
            `UPDATE offices SET name = COALESCE(NULLIF($1, ''), name), description = COALESCE($2, description), head_id = $3
             WHERE id = $4 RETURNING *`,
            [String(req.body.name || '').trim(), req.body.description ?? null, headId, req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({ message: 'Office not found.' });
        await pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)', [req.user.id, `Office updated: ${r.rows[0].name}`]);
        res.json(r.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: 'An office with that name already exists.' });
        console.error('Update office failed:', err);
        res.status(500).json({ message: 'Could not update the office.' });
    }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
        const waiting = await pool.query(
            `SELECT COUNT(*)::int AS n FROM documents WHERE status = 'Pending' AND (current_office_id = $1
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(parallel_branch_data::jsonb, '[]'::jsonb)) b
                          WHERE b->>'status' = 'Pending' AND (b->>'officeId')::int = $1))`,
            [id]
        );
        if (waiting.rows[0].n > 0) {
            return res.status(409).json({ message: `${waiting.rows[0].n} document(s) are waiting in this office. Finish or move them first.` });
        }
        const used = await pool.query(
            `SELECT name FROM workflows w, jsonb_array_elements(COALESCE(w.flow_structure::jsonb->'nodes', '[]'::jsonb)) n
             WHERE n->'data'->>'assignmentStrategy' = 'office' AND n->'data'->>'officeId' = $1::text LIMIT 1`,
            [id]
        );
        if (used.rows.length) {
            return res.status(409).json({ message: `The workflow "${used.rows[0].name}" sends steps to this office. Change it first.` });
        }
        await pool.query('DELETE FROM offices WHERE id = $1', [id]);
        res.json({ message: 'Office removed.' });
    } catch (err) {
        console.error('Delete office failed:', err);
        res.status(500).json({ message: 'Could not remove the office.' });
    }
});

// ── Head (or admin): officers and cover ─────────────────────────────────────

router.post('/:id/members', authenticateToken, requireHeadOrAdmin, async (req, res) => {
    const userId = parseInt(req.body.user_id, 10);
    try {
        if (!(await isStaff(pool, userId))) return res.status(400).json({ message: 'Only staff members can be officers.' });
        const positionId = req.body.position_id ? parseInt(req.body.position_id, 10) : null;
        if (positionId && !(await pool.query('SELECT 1 FROM office_positions WHERE id = $1 AND office_id = $2', [positionId, req.params.id])).rows.length) {
            return res.status(400).json({ message: 'That position is not in this office.' });
        }
        await pool.query(
            `INSERT INTO office_members (office_id, user_id, position_id) VALUES ($1, $2, $3)
             ON CONFLICT (office_id, user_id) DO UPDATE SET position_id = COALESCE(EXCLUDED.position_id, office_members.position_id)`,
            [req.params.id, userId, positionId]);
        await pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)', [req.user.id, `Added user ${userId} to office ${req.params.id}`]);
        res.status(201).json({ message: 'Officer added.' });
    } catch (err) {
        console.error('Add officer failed:', err);
        res.status(500).json({ message: 'Could not add the officer.' });
    }
});

router.delete('/:id/members/:userId', authenticateToken, requireHeadOrAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM office_members WHERE office_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
        // Documents they had claimed go back to the office queue
        const released = await client.query(
            `UPDATE documents SET current_assignee_id = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE status = 'Pending' AND current_office_id = $1 AND current_assignee_id = $2 RETURNING id`,
            [req.params.id, req.params.userId]
        );
        await client.query('COMMIT');
        res.json({ message: 'Officer removed.', returnedToQueue: released.rows.length });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Remove officer failed:', err);
        res.status(500).json({ message: 'Could not remove the officer.' });
    } finally {
        client.release();
    }
});

// ── Head (or admin): positions ──────────────────────────────────────────────

/** Would making `positionId` report to `reportsToId` create a loop (A reports to B reports to A)? */
const reportingLoop = async (positionId, reportsToId) => {
    let current = reportsToId;
    for (let hops = 0; current && hops < 50; hops++) {
        if (current === positionId) return true;
        current = (await pool.query('SELECT reports_to_id FROM office_positions WHERE id = $1', [current])).rows[0]?.reports_to_id;
    }
    return false;
};

const checkReportsTo = async (officeId, positionId, reportsToId) => {
    if (!reportsToId) return null;
    const r = await pool.query('SELECT 1 FROM office_positions WHERE id = $1 AND office_id = $2', [reportsToId, officeId]);
    if (!r.rows.length) return 'A position can only report to another position in the same office.';
    if (positionId && await reportingLoop(positionId, reportsToId)) return 'That would make the positions report to each other in a loop.';
    return null;
};

router.post('/:id/positions', authenticateToken, requireHeadOrAdmin, async (req, res) => {
    const officeId = parseInt(req.params.id, 10);
    const name = String(req.body.name || '').trim();
    const reportsTo = req.body.reports_to_id ? parseInt(req.body.reports_to_id, 10) : null;
    if (!name) return res.status(400).json({ message: 'Give the position a name, such as Deputy or Cashier.' });
    try {
        const problem = await checkReportsTo(officeId, null, reportsTo);
        if (problem) return res.status(400).json({ message: problem });
        const r = await pool.query('INSERT INTO office_positions (office_id, name, reports_to_id) VALUES ($1, $2, $3) RETURNING *',
            [officeId, name, reportsTo]);
        await pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)', [req.user.id, `Position created in office ${officeId}: ${name}`]);
        res.status(201).json(r.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: `This office already has a "${name}" position.` });
        console.error('Create position failed:', err);
        res.status(500).json({ message: 'Could not create the position.' });
    }
});

router.put('/:id/positions/:positionId', authenticateToken, requireHeadOrAdmin, async (req, res) => {
    const officeId = parseInt(req.params.id, 10);
    const positionId = parseInt(req.params.positionId, 10);
    try {
        const current = (await pool.query('SELECT * FROM office_positions WHERE id = $1 AND office_id = $2', [positionId, officeId])).rows[0];
        if (!current) return res.status(404).json({ message: 'Position not found.' });
        const name = req.body.name !== undefined ? String(req.body.name).trim() : current.name;
        if (!name) return res.status(400).json({ message: 'Give the position a name.' });
        const reportsTo = req.body.reports_to_id !== undefined ? (parseInt(req.body.reports_to_id, 10) || null) : current.reports_to_id;
        const problem = await checkReportsTo(officeId, positionId, reportsTo);
        if (problem) return res.status(400).json({ message: problem });
        const r = await pool.query('UPDATE office_positions SET name = $1, reports_to_id = $2 WHERE id = $3 RETURNING *', [name, reportsTo, positionId]);
        res.json(r.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: 'This office already has a position with that name.' });
        console.error('Update position failed:', err);
        res.status(500).json({ message: 'Could not update the position.' });
    }
});

router.delete('/:id/positions/:positionId', authenticateToken, requireHeadOrAdmin, async (req, res) => {
    const officeId = parseInt(req.params.id, 10);
    const positionId = parseInt(req.params.positionId, 10);
    try {
        const used = await pool.query(
            `SELECT name FROM workflows w, jsonb_array_elements(COALESCE(w.flow_structure::jsonb->'nodes', '[]'::jsonb)) n
             WHERE n->'data'->>'officePosition' = 'position' AND n->'data'->>'positionId' = $1::text LIMIT 1`,
            [positionId]
        );
        if (used.rows.length) {
            return res.status(409).json({ message: `The workflow "${used.rows[0].name}" sends steps to this position. Change it first.` });
        }
        const waiting = await pool.query("SELECT COUNT(*)::int AS n FROM documents WHERE status = 'Pending' AND current_position_id = $1", [positionId]);
        if (waiting.rows[0].n) return res.status(409).json({ message: `${waiting.rows[0].n} document(s) are waiting for this position.` });
        const r = await pool.query('DELETE FROM office_positions WHERE id = $1 AND office_id = $2 RETURNING name', [positionId, officeId]);
        if (!r.rows.length) return res.status(404).json({ message: 'Position not found.' });
        await pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)', [req.user.id, `Position removed from office ${officeId}: ${r.rows[0].name}`]);
        res.json({ message: `Position "${r.rows[0].name}" removed.` });
    } catch (err) {
        console.error('Delete position failed:', err);
        res.status(500).json({ message: 'Could not remove the position.' });
    }
});

// Give an officer a position (or none)
router.put('/:id/members/:userId', authenticateToken, requireHeadOrAdmin, async (req, res) => {
    const officeId = parseInt(req.params.id, 10);
    const positionId = req.body.position_id ? parseInt(req.body.position_id, 10) : null;
    try {
        if (positionId && !(await pool.query('SELECT 1 FROM office_positions WHERE id = $1 AND office_id = $2', [positionId, officeId])).rows.length) {
            return res.status(400).json({ message: 'That position is not in this office.' });
        }
        const r = await pool.query('UPDATE office_members SET position_id = $1 WHERE office_id = $2 AND user_id = $3 RETURNING user_id',
            [positionId, officeId, req.params.userId]);
        if (!r.rows.length) return res.status(404).json({ message: 'That person is not an officer here.' });
        await pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)',
            [req.user.id, `Set position of user ${req.params.userId} in office ${officeId} to ${positionId || 'none'}`]);
        res.json({ message: 'Position updated.' });
    } catch (err) {
        console.error('Set position failed:', err);
        res.status(500).json({ message: 'Could not update the position.' });
    }
});

// Who covers for whom: mark someone (an officer or the head) away and name who covers
router.put('/:id/cover/:userId', authenticateToken, requireHeadOrAdmin, async (req, res) => {
    const officeId = parseInt(req.params.id, 10);
    const userId = parseInt(req.params.userId, 10);
    const away = Boolean(req.body.is_out_of_office);
    const coverId = away && req.body.delegate_id ? parseInt(req.body.delegate_id, 10) : null;
    try {
        const inOffice = async (uid) => (await pool.query(
            `SELECT 1 FROM office_members WHERE office_id = $1 AND user_id = $2
             UNION SELECT 1 FROM offices WHERE id = $1 AND head_id = $2`, [officeId, uid])).rows.length > 0;
        if (!(await inOffice(userId))) return res.status(400).json({ message: 'That person is not in this office.' });
        if (coverId && (coverId === userId || !(await inOffice(coverId)))) {
            return res.status(400).json({ message: 'Cover must be someone else in the same office.' });
        }
        await pool.query('UPDATE users SET is_out_of_office = $1, delegate_id = $2 WHERE id = $3', [away, coverId, userId]);
        await pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)',
            [req.user.id, away ? `Set user ${userId} away, covered by ${coverId || 'nobody'}` : `Set user ${userId} back in office`]);
        res.json({ message: away ? 'Marked as away.' : 'Marked as back.' });
    } catch (err) {
        console.error('Set cover failed:', err);
        res.status(500).json({ message: 'Could not update cover.' });
    }
});

// ── Shared queue: claim and release ─────────────────────────────────────────

/** Steps meant for the office head are never put in (or taken from) the shared queue. */
const isHeadStep = async (db, doc, nodeId) => {
    if (!doc.workflow_id || !nodeId) return false;
    const r = await db.query('SELECT flow_structure FROM workflows WHERE id = $1', [doc.workflow_id]);
    const node = parseFlow(r.rows[0]?.flow_structure).nodes.find((n) => n.id === nodeId);
    return node?.data?.officePosition === 'head';
};

const membership = async (db, userId) => {
    const r = await db.query(
        `SELECT office_id AS id, FALSE AS head, position_id FROM office_members WHERE user_id = $1
         UNION ALL SELECT id, TRUE, NULL FROM offices WHERE head_id = $1`, [userId]);
    return {
        ids: r.rows.map((x) => x.id),
        heads: r.rows.filter((x) => x.head).map((x) => x.id),
        positions: r.rows.filter((x) => x.position_id).map((x) => x.position_id),
    };
};

const changeClaim = (mode) => async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const doc = (await client.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.documentId])).rows[0];
        if (!doc || doc.status !== 'Pending') {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'This document is not waiting for review.' });
        }
        const me = await membership(client, req.user.id);
        // A step for one position can only be claimed by its holders (or the head)
        const canClaim = (officeId, assigneeId, positionId) => !assigneeId && me.ids.includes(officeId)
            && (!positionId || me.positions.includes(positionId) || me.heads.includes(officeId));
        const canRelease = (officeId, assigneeId) => assigneeId && (assigneeId === req.user.id || me.heads.includes(officeId));
        const allowed = mode === 'claim' ? canClaim : canRelease;
        const newAssignee = mode === 'claim' ? req.user.id : null;

        if (Array.isArray(doc.parallel_branch_data)) {
            const branches = doc.parallel_branch_data.map((b) => ({ ...b }));
            const i = branches.findIndex((b) => b.status === 'Pending' && b.officeId && allowed(b.officeId, b.assigneeId, b.positionId));
            if (i === -1) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: mode === 'claim' ? 'Nothing to claim here: it is taken or not in your office.' : 'You have not claimed this document.' });
            }
            if (await isHeadStep(client, doc, branches[i].nodeId)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: 'This step is for the head of the office and cannot go to the shared queue.' });
            }
            branches[i].assigneeId = newAssignee;
            await client.query('UPDATE documents SET parallel_branch_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [JSON.stringify(branches), doc.id]);
        } else {
            if (!doc.current_office_id || !allowed(doc.current_office_id, doc.current_assignee_id, doc.current_position_id)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: mode === 'claim' ? 'Someone in your office has already claimed it, or it is not in your office.' : 'You have not claimed this document.' });
            }
            if (await isHeadStep(client, doc, doc.current_node_id)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: 'This step is for the head of the office and cannot go to the shared queue.' });
            }
            await client.query('UPDATE documents SET current_assignee_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newAssignee, doc.id]);
        }
        await client.query('INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, $3)',
            [doc.id, req.user.id, mode === 'claim' ? 'Claimed from the office queue' : 'Returned to the office queue']);
        await client.query('COMMIT');
        res.json({ message: mode === 'claim' ? 'Claimed. It is now in your tasks.' : 'Returned to the office queue.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`${mode} failed:`, err);
        res.status(500).json({ message: 'Could not update the claim.' });
    } finally {
        client.release();
    }
};

router.post('/queue/:documentId/claim', authenticateToken, changeClaim('claim'));
router.post('/queue/:documentId/release', authenticateToken, changeClaim('release'));

module.exports = router;
