const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

// 1. Initialize app FIRST
const app = express();
const PORT = process.env.PORT || 5000;

// 2. Middleware
app.use(cors());
app.use(express.json());

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

// 5. Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});