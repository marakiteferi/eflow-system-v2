const express = require('express');
const router = express.Router();
const { registerUser, loginUser } = require('../controllers/authController');
const authenticateToken = require('../middleware/authMiddleware');
const { Pool } = require('pg');

// NEW: We must import bcrypt so we can securely check and hash the passwords!
const bcrypt = require('bcrypt'); 

const pool = new Pool({
    user: process.env.DB_USER, 
    host: process.env.DB_HOST, 
    database: process.env.DB_NAME, 
    password: process.env.DB_PASSWORD, 
    port: process.env.DB_PORT,
});

// POST /api/auth/register
router.post('/register', registerUser);

// POST /api/auth/login
router.post('/login', loginUser);

// PUT: Update User Profile (Name & Password)
router.put('/profile', authenticateToken, async (req, res) => {
    const { name, currentPassword, newPassword } = req.body;
    
    try {
        await pool.query('BEGIN');
        
        // 1. Update Name (if provided)
        if (name) {
            await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.id]);
        }

        // 2. Update Password (if they filled out the password fields)
        if (currentPassword && newPassword) {
            // FIX: Changed "password" to "password_hash" to match your database
            const userQuery = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
            
            // Safety check to ensure the user data loaded properly
            if (userQuery.rows.length === 0 || !userQuery.rows[0].password_hash) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ message: 'User password record not found.' });
            }

            const validPassword = await bcrypt.compare(currentPassword, userQuery.rows[0].password_hash);
            
            if (!validPassword) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ message: 'Your current password is incorrect.' });
            }
            
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            
            // FIX: Updating the "password_hash" column
            await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, req.user.id]);
        }

        await pool.query('COMMIT');
        
        // Optional: Log this security event in the audit trail
        await pool.query("INSERT INTO audit_logs (user_id, action) VALUES ($1, 'User updated profile/password')", [req.user.id]);
        
        res.status(200).json({ message: 'Profile updated successfully!' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Profile update error:', err);
        res.status(500).json({ message: 'Server error updating profile' });
    }
});

module.exports = router;