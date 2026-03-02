const express = require('express');
const router = express.Router();
const multer = require('multer');
const { Pool } = require('pg');
const authenticateToken = require('../middleware/authMiddleware');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Configure Multer for file storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Files will be saved in the server/uploads directory
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname); // Give files unique names
    }
});
const upload = multer({ storage });

// POST: Upload a new document
router.post('/upload', authenticateToken, upload.single('document'), async (req, res) => {
    try {
        const { title, extracted_text } = req.body;
        const submitter_id = req.user.id; // From the auth middleware
        const file_path = req.file.path;

        if (!title || !req.file) {
            return res.status(400).json({ message: 'Title and document file are required.' });
        }

        const newDoc = await pool.query(
            'INSERT INTO documents (title, file_path, extracted_text, submitter_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, file_path, extracted_text, submitter_id, 'Pending']
        );

        res.status(201).json({ message: 'Document submitted successfully', document: newDoc.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error during file upload' });
    }
});

// GET: Fetch documents based on role
router.get('/', authenticateToken, async (req, res) => {
    try {
        let query;
        let values;

        if (req.user.role_id === 1) {
            // Student: See only their own documents
            query = 'SELECT * FROM documents WHERE submitter_id = $1 ORDER BY created_at DESC';
            values = [req.user.id];
        } else if (req.user.role_id === 2) {
            // Staff: See all pending documents for review
            query = 'SELECT * FROM documents WHERE status = $1 ORDER BY created_at ASC';
            values = ['Pending'];
        } else {
            // Admin: See everything
            query = 'SELECT * FROM documents ORDER BY created_at DESC';
            values = [];
        }

        const result = await pool.query(query, values);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching documents' });
    }
});

module.exports = router;