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
        const roles = await pool.query('SELECT id, name FROM dynamic_roles ORDER BY id ASC');
        console.log("Roles:", roles.rows);
        
        const users = await pool.query('SELECT id, name, role_id FROM users WHERE role_id < 100 AND role_id > 3');
        console.log("Users with dynamic roles:", users.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
check();
