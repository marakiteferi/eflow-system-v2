const { Pool } = require('pg');
require('dotenv').config({ path: 'server/.env' });
const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});
async function fix() {
    try {
        await pool.query('BEGIN');
        const res = await pool.query('SELECT * FROM dynamic_roles');
        for (const role of res.rows) {
            if (role.id <= 3) {
                await pool.query('UPDATE dynamic_roles SET id = $1 WHERE id = $2', [role.id + 3, role.id]);
            }
        }
        await pool.query(`SELECT setval(pg_get_serial_sequence('dynamic_roles', 'id'), COALESCE((SELECT MAX(id) FROM dynamic_roles), 3) + 1, false)`);
        await pool.query('COMMIT');
        console.log('Fixed dynamic_roles sequence globally!');
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
    } finally {
        pool.end();
    }
}
fix();
