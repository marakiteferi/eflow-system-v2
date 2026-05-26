require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function check() {
    try {
        const users = await pool.query('SELECT id, name, role_id FROM users');
        console.log("All Users:", users.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
check();
