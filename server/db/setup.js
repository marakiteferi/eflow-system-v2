/**
 * One-command database setup for E-Flow.
 *
 *   npm run db:setup            create the database (if needed), schema, migrations and demo accounts
 *   npm run db:setup -- --reset drop and recreate the database first (deletes all data!)
 *
 * Reads connection settings from server/.env.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const DB_NAME = process.env.DB_NAME;
const RESET = process.argv.includes('--reset');
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

// Built-in role IDs used throughout the app: 1 = Student, 2 = Staff, 3 = Super Admin
const DEMO_USERS = [
    { name: 'Demo Admin', email: 'admin@example.com', role_id: 3 },
    { name: 'Demo Staff', email: 'staff@example.com', role_id: 2 },
    { name: 'Demo Staff 2', email: 'staff2@example.com', role_id: 2 },
    { name: 'Abebe (Student)', email: 'abebe@example.com', role_id: 1 },
];

const connectionFor = (database) => ({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database,
});

async function ensureDatabase() {
    const admin = new Client(connectionFor('postgres'));
    await admin.connect();
    try {
        if (RESET) {
            await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
            console.log(`Dropped database ${DB_NAME}`);
        }
        const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
        if (exists.rows.length === 0) {
            await admin.query(`CREATE DATABASE "${DB_NAME}"`);
            console.log(`Created database ${DB_NAME}`);
            return true;
        }
        return false;
    } finally {
        await admin.end();
    }
}

async function run() {
    if (!DB_NAME) throw new Error('DB_NAME is not set. Copy server/.env.example to server/.env first.');

    const created = await ensureDatabase();
    const db = new Client(connectionFor(DB_NAME));
    await db.connect();

    try {
        const hasSchema = await db.query("SELECT to_regclass('public.users') AS t");
        if (created || !hasSchema.rows[0].t) {
            console.log('Applying schema.sql');
            await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
        }

        // Migrations are written to be safe to re-run (IF NOT EXISTS)
        const migrationsDir = path.join(__dirname, 'migrations');
        for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
            console.log(`Applying migrations/${file}`);
            await db.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
        }

        const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
        for (const u of DEMO_USERS) {
            await db.query(
                `INSERT INTO users (name, email, password_hash, role_id)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (email) DO NOTHING`,
                [u.name, u.email, hash, u.role_id]
            );
        }

        console.log('\n✅ Database ready. Demo accounts (password: ' + DEMO_PASSWORD + '):');
        DEMO_USERS.forEach((u) => console.log(`   ${u.email}`));
    } finally {
        await db.end();
    }
}

run().catch((err) => {
    console.error('❌ Database setup failed:', err.message);
    process.exit(1);
});
