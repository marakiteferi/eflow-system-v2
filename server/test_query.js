const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });
async function run() {
    try {
        let res1 = await pool.query(`UPDATE dynamic_roles SET name = TRIM(name) WHERE name != TRIM(name)`);
        console.log(`Updated ${res1.rowCount} roles`);
        let res2 = await pool.query(`UPDATE departments SET name = TRIM(name) WHERE name != TRIM(name)`);
        console.log(`Updated ${res2.rowCount} departments`);
    } finally { pool.end(); }
}
run();
