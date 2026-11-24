/**
 * Uploaded files are served only to signed-in users who may see the document they belong to.
 *
 * Browsers can't attach an Authorization header to <iframe src> or a plain link, so the
 * client appends a short-lived "file token" (?ft=...). It is a JWT that only works here:
 * it can't be used to call the API.
 */
const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const STUDENT_ROLE_ID = 1;
const FILE_TOKEN_TTL = '8h';

const signFileToken = (user) =>
    jwt.sign({ id: user.id, role_id: user.role_id, purpose: 'files' }, process.env.JWT_SECRET, { expiresIn: FILE_TOKEN_TTL });

const readUser = (req) => {
    const header = req.headers.authorization?.split(' ')[1];
    try {
        if (req.query.ft) {
            const u = jwt.verify(String(req.query.ft), process.env.JWT_SECRET);
            return u.purpose === 'files' ? u : null;
        }
        if (header) {
            const u = jwt.verify(header, process.env.JWT_SECRET);
            return u.purpose === 'files' ? null : u;
        }
    } catch {
        return null;
    }
    return null;
};

/** The document a stored file belongs to: the main file, an older version, or an attachment. */
const findOwningDocument = async (fileName) => {
    const suffix = '/' + fileName;
    const r = await pool.query(
        `SELECT d.id, d.submitter_id FROM documents d
         WHERE right(replace(d.file_path, '\\', '/'), $2) = $1
         UNION
         SELECT d.id, d.submitter_id FROM document_versions v JOIN documents d ON d.id = v.document_id
         WHERE right(replace(v.file_path, '\\', '/'), $2) = $1
         UNION
         SELECT d.id, d.submitter_id FROM document_attachments a JOIN documents d ON d.id = a.document_id
         WHERE right(replace(a.file_path, '\\', '/'), $2) = $1
         LIMIT 1`,
        [suffix, suffix.length]
    );
    return r.rows[0] || null;
};

const serveUpload = (uploadsDir) => async (req, res) => {
    const user = readUser(req);
    if (!user) return res.status(401).json({ message: 'Please sign in to view this file.' });

    const fileName = path.basename(req.params.name || '');
    if (!fileName || fileName !== req.params.name) return res.status(400).json({ message: 'Invalid file name.' });

    try {
        const doc = await findOwningDocument(fileName);
        if (!doc) return res.status(404).json({ message: 'File not found.' });
        // Students only see files of their own documents; staff and admins review documents
        if (user.role_id === STUDENT_ROLE_ID && doc.submitter_id !== user.id) {
            return res.status(403).json({ message: 'You are not allowed to view this file.' });
        }
        res.setHeader('Cache-Control', 'private, no-store');
        res.sendFile(path.join(uploadsDir, fileName), (err) => {
            if (err && !res.headersSent) res.status(404).json({ message: 'File not found.' });
        });
    } catch (err) {
        console.error('File access check failed:', err.message);
        res.status(500).json({ message: 'Could not load the file.' });
    }
};

module.exports = { serveUpload, signFileToken };
