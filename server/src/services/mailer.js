const { sendMail } = require('./notifier');

/** Email a new account its set-password link. Returns true when the email went out. */
const sendWelcome = ({ name, email, link }) => sendMail({
    to: email,
    subject: 'Welcome to E-flow: set your password',
    html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px; max-width: 500px;">
            <h2 style="color: #4f46e5;">Welcome to E-flow</h2>
            <p>Hello ${name},</p>
            <p>An account has been created for you. Choose a password to start using it. The link expires in <strong>24 hours</strong>.</p>
            <a href="${link}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;font-weight:bold;text-decoration:none;">Set my password</a>
            <p style="color:#6b7280;font-size:13px;margin-top:20px;">If you did not expect this, contact your administrator.</p>
        </div>`,
});

module.exports = { sendWelcome };
