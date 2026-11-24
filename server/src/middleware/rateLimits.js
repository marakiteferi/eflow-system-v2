/**
 * Limits on the endpoints people could brute-force or use to flood inboxes.
 * Counts are kept in memory per server; limits can be changed with environment variables.
 */
const rateLimit = require('express-rate-limit');

const num = (name, fallback) => parseInt(process.env[name], 10) || fallback;
const tooMany = (what) => ({ message: `Too many ${what}. Please wait a few minutes and try again.` });

// Failed sign-ins per account and address: successful sign-ins don't count
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: num('RATE_LIMIT_LOGIN', 10),
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany('sign-in attempts'),
});

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: num('RATE_LIMIT_PASSWORD_RESET', 5),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany('password reset requests'),
});

// One-time code requests per signed-in user (use after authenticateToken)
const codeRequestLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: num('RATE_LIMIT_CODES', 10),
    keyGenerator: (req) => `user:${req.user?.id}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany('code requests'),
});

module.exports = { loginLimiter, passwordResetLimiter, codeRequestLimiter };
