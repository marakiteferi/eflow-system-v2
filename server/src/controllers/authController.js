const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { signFileToken } = require('../middleware/fileAccess');

// Initialize database connection
const pool = require('../db');
const { ACCOUNT_TYPES, loadAccess } = require('../services/access');

/** What the client needs to know about the signed-in person. */
const accountSummary = async (user) => {
    const access = await loadAccess(user.id);
    const offices = (await pool.query(
        `SELECT o.id, o.name, (o.head_id = $1) AS is_head, p.name AS position_name
         FROM offices o
         LEFT JOIN office_members m ON m.office_id = o.id AND m.user_id = $1
         LEFT JOIN office_positions p ON p.id = m.position_id
         WHERE o.head_id = $1 OR m.user_id = $1
         ORDER BY o.name`, [user.id])).rows;
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: user.role_id,
        account_type: ACCOUNT_TYPES[user.role_id] || 'Staff',
        department_id: user.department_id,
        permissions: access ? access.permissions : [],
        offices,
    };
};

// User Registration
const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        // Self-registration always creates a Student account. Staff and admin roles
        // can only be granted by an administrator (see PUT /api/admin/users/:id/role).
        const STUDENT_ROLE_ID = 1;

        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Name, email and password are required' });
        }

        // Check if user already exists
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert into database
        const newUser = await pool.query(
            'INSERT INTO users (name, email, password_hash, role_id) VALUES ($1, $2, $3, $4) RETURNING id, name, email',
            [name, email, hashedPassword, STUDENT_ROLE_ID]
        );

        res.status(201).json({ message: 'User registered successfully', user: newUser.rows[0] });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error during registration' });
    }
};

// User Login
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const userQuery = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [String(email || '').trim()]);

        if (userQuery.rows.length === 0) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const user = userQuery.rows[0];

        // Check password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        if (user.is_active === false) {
            return res.status(403).json({ message: 'This account has been deactivated. Please contact an administrator.' });
        }

        // Generate JWT
        const token = jwt.sign(
            { id: user.id, role_id: user.role_id, department_id: user.department_id },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        await pool.query(
            "INSERT INTO audit_logs (user_id, action) VALUES ($1, 'User logged into the system')", 
            [user.id]
        );

        res.status(200).json({
            token,
            fileToken: signFileToken(user),
            user: await accountSummary(user),
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error during login' });
    }
};
// The signed-in person's current account, permissions and offices
const getMe = async (req, res) => {
    try {
        const user = (await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id])).rows[0];
        if (!user) return res.status(404).json({ message: 'Account not found.' });
        res.json(await accountSummary(user));
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error loading your account' });
    }
};

module.exports = { registerUser, loginUser, getMe, accountSummary };