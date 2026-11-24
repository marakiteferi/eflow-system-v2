require('dotenv').config();

// Fail fast if required secrets are missing, instead of running with insecure defaults
const REQUIRED_ENV = ['JWT_SECRET', 'APPROVAL_SIGNING_SECRET', 'DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}. Copy server/.env.example to server/.env and fill them in.`);
    process.exit(1);
}

const startSlaMonitor = require('./cron/slaMonitor');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// 1. Initialize app FIRST
const app = express();
const PORT = process.env.PORT || 5000;

// 2. Middleware
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000' }));
app.use(express.json());
const UPLOADS_DIR = path.join(__dirname, '../uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));
// 3. Database Pool
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

pool.connect((err, client, release) => {
    if (err) console.error('❌ Error connecting to PostgreSQL:', err.message);
    else {
        console.log('✅ Successfully connected to PostgreSQL!');
        release();
    }
});

// 4. API Routes
app.get('/api/health', (req, res) => res.status(200).json({ status: 'OK' }));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/workflows', require('./routes/workflowRoutes'));
app.use('/api/documents', require('./routes/documentRoutes'));
app.use('/api/approvals', require('./routes/approvalRoutes')); // We will build this next!
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/users', require('./routes/userRoutes')); // For OOO and delegation
app.use('/api/notifications', require('./routes/notificationRoutes')); // In-app notifications
// 5. Start Server
startSlaMonitor(); // Activate the SLA monitoring engine
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});