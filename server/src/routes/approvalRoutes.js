const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const authenticateToken = require('../middleware/authMiddleware');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

const otpStore = new Map();

// Configure Nodemailer Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// POST: Generate OTP and Email it
router.post('/request-otp', authenticateToken, async (req, res) => {
    try {
        const { documentId } = req.body;
        
        const otp = crypto.randomInt(100000, 999999).toString();
        otpStore.set(req.user.id, { otp, documentId, expires: Date.now() + 5 * 60000 });

        const userQuery = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
        const userEmail = userQuery.rows[0].email;
        const userName = userQuery.rows[0].name;

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: userEmail,
            subject: 'System 2FA Approval Code',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px; max-width: 500px;">
                    <h2 style="color: #2563eb;">Document Approval Required</h2>
                    <p>Hello ${userName},</p>
                    <p>You have requested to approve a document. Please use the following One-Time Password (OTP) to complete the verification process:</p>
                    <h1 style="background: #f3f4f6; padding: 15px; text-align: center; letter-spacing: 5px; color: #1f2937;">${otp}</h1>
                    <p style="color: #ef4444; font-size: 12px;">This code will expire in 5 minutes.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ OTP email successfully sent to ${userEmail}`);

        res.status(200).json({ message: 'OTP generated and emailed successfully' });
    } catch (err) {
        console.error('Email error:', err);
        res.status(500).json({ message: 'Error generating or sending OTP' });
    }
});

// POST: Verify OTP and Execute Approval
router.post('/approve', authenticateToken, async (req, res) => {
    const { documentId, otp, comments } = req.body;
    const storedData = otpStore.get(req.user.id);

    if (!storedData || storedData.otp !== otp || storedData.documentId !== documentId) {
        return res.status(400).json({ message: 'Invalid or incorrect OTP' });
    }
    if (Date.now() > storedData.expires) {
        otpStore.delete(req.user.id);
        return res.status(400).json({ message: 'OTP has expired' });
    }

    try {
        await pool.query('BEGIN');

        await pool.query(
            "UPDATE documents SET status = 'Approved', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            [documentId]
        );

        await pool.query(
            "INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Approved', $4)",
            [documentId, req.user.id, 'Staff_Review', comments || 'Verified by 2FA']
        );

        await pool.query(
            "INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'Document Approved via 2FA Email Validation')",
            [documentId, req.user.id]
        );

        await pool.query('COMMIT');
        otpStore.delete(req.user.id);
        
        res.status(200).json({ message: 'Document securely approved' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Database error during approval' });
    }
});

module.exports = router;