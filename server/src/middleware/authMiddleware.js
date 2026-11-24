const jwt = require('jsonwebtoken');
const pool = require('../db');

/**
 * Checks the bearer token, then reads the account from the database so that a
 * deactivated account is locked out at once and a changed account type applies
 * without signing in again.
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format is "Bearer <token>"

    if (!token) return res.status(401).json({ message: 'Access Denied: No Token Provided' });

    jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid Token' });
        // File tokens only open uploaded files; they can't call the API
        if (user.purpose === 'files') return res.status(403).json({ message: 'Invalid Token' });
        try {
            const row = (await pool.query(
                'SELECT role_id, department_id, COALESCE(is_active, TRUE) AS is_active FROM users WHERE id = $1', [user.id])).rows[0];
            if (!row || !row.is_active) return res.status(401).json({ message: 'This account has been deactivated.' });
            req.user = { ...user, role_id: row.role_id, department_id: row.department_id };
            next();
        } catch (dbErr) {
            console.error('Auth lookup failed:', dbErr);
            res.status(500).json({ message: 'Server error checking your session.' });
        }
    });
};

module.exports = authenticateToken;
