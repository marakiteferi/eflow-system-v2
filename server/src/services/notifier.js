/**
 * Email and in-app notifications, shared by the routes, the routing engine and the SLA monitor.
 * Email failures are logged and never break the request that triggered them.
 */
const nodemailer = require('nodemailer');

const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

const transporter = smtpConfigured
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: String(process.env.SMTP_PORT) === '465',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    : null;

const sendMail = async ({ to, subject, html }) => {
    if (!transporter) {
        console.log(`📧 [email not configured] To: ${to} | ${subject}`);
        return false;
    }
    try {
        await transporter.sendMail({ from: `"E-flow System" <${process.env.FROM_EMAIL}>`, to, subject, html });
        return true;
    } catch (err) {
        console.error(`❌ Email to ${to} failed: ${err.message}`);
        return false;
    }
};

const emailLayout = (name, message) => `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px; max-width: 500px;">
        <h2 style="color: #4f46e5;">E-flow Notification</h2>
        <p>Hello ${name},</p>
        <p style="font-size: 16px; color: #374151;">${message}</p>
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
        <p style="font-size: 12px; color: #9ca3af;">Please log in to your dashboard to view the details.</p>
    </div>`;

/** Create an in-app notification and, unless the user opted out, email them. */
const notifyUser = async (db, userId, { title, body, type = 'info', documentId = null, emailSubject = null }) => {
    if (!userId) return;
    try {
        await db.query(
            'INSERT INTO notifications (user_id, title, body, type, document_id) VALUES ($1, $2, $3, $4, $5)',
            [userId, title, body, type, documentId]
        );
        const u = await db.query('SELECT email, name, email_notifications FROM users WHERE id = $1', [userId]);
        const user = u.rows[0];
        if (user && user.email_notifications !== false) {
            await sendMail({ to: user.email, subject: emailSubject || title, html: emailLayout(user.name, body) });
        }
    } catch (err) {
        console.error('Notification failed:', err.message);
    }
};

module.exports = { sendMail, notifyUser, transporter, smtpConfigured };
