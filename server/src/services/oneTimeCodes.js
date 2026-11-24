/**
 * One-time codes for approvals and admin actions, stored hashed in the database.
 * One active code per user and purpose; a new request replaces the old code.
 */
const crypto = require('crypto');
const pool = require('../db');

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const hash = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

/**
 * Create a code. Returns { code } or { tooSoon: seconds } when one was issued less than
 * `cooldownMs` ago for the same document (the earlier code still works).
 */
const issueCode = async (userId, purpose, { documentId = null, cooldownMs = 30 * 1000 } = {}) => {
    const existing = (await pool.query(
        'SELECT document_id, created_at, expires_at FROM one_time_codes WHERE user_id = $1 AND purpose = $2',
        [userId, purpose]
    )).rows[0];
    if (existing && new Date(existing.expires_at) > new Date()) {
        const age = Date.now() - new Date(existing.created_at).getTime();
        const sameTarget = String(existing.document_id ?? '') === String(documentId ?? '');
        if (sameTarget && age < cooldownMs) return { tooSoon: Math.ceil((cooldownMs - age) / 1000) };
    }
    const code = crypto.randomInt(100000, 1000000).toString();
    await pool.query(
        `INSERT INTO one_time_codes (user_id, purpose, document_id, code_hash, attempts, expires_at, created_at)
         VALUES ($1, $2, $3, $4, 0, $5, NOW())
         ON CONFLICT (user_id, purpose) DO UPDATE
           SET document_id = EXCLUDED.document_id, code_hash = EXCLUDED.code_hash, attempts = 0,
               expires_at = EXCLUDED.expires_at, created_at = NOW()`,
        [userId, purpose, documentId, hash(code), new Date(Date.now() + TTL_MS)]
    );
    return { code };
};

/**
 * Check a code without using it up. Returns 'ok', 'invalid' or 'expired'.
 * Five wrong guesses delete the code, so a new one must be requested.
 */
const checkCode = async (userId, purpose, code, { documentId = null } = {}) => {
    const row = (await pool.query(
        'SELECT * FROM one_time_codes WHERE user_id = $1 AND purpose = $2',
        [userId, purpose]
    )).rows[0];
    if (!row) return 'invalid';
    if (documentId !== null && String(row.document_id) !== String(documentId)) return 'invalid';
    if (new Date(row.expires_at) < new Date()) {
        await consumeCode(userId, purpose);
        return 'expired';
    }
    const given = Buffer.from(hash(code || ''));
    if (!crypto.timingSafeEqual(given, Buffer.from(row.code_hash))) {
        const r = await pool.query(
            'UPDATE one_time_codes SET attempts = attempts + 1 WHERE user_id = $1 AND purpose = $2 RETURNING attempts',
            [userId, purpose]
        );
        if (r.rows[0]?.attempts >= MAX_ATTEMPTS) await consumeCode(userId, purpose);
        return 'invalid';
    }
    return 'ok';
};

const consumeCode = (userId, purpose) =>
    pool.query('DELETE FROM one_time_codes WHERE user_id = $1 AND purpose = $2', [userId, purpose]);

module.exports = { issueCode, checkCode, consumeCode };
