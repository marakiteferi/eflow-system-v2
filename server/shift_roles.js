require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function migrate() {
    try {
        await pool.query('BEGIN');
        
        // Find constraint names dynamically
        const constraints = await pool.query(`
            SELECT conname, conrelid::regclass as table_name
            FROM pg_constraint 
            WHERE confrelid = 'dynamic_roles'::regclass
        `);
        
        // Drop them temporarily
        for (const row of constraints.rows) {
            await pool.query(`ALTER TABLE ${row.table_name} DROP CONSTRAINT ${row.conname}`);
        }

        // Shift dynamic_roles IDs by 100
        await pool.query('UPDATE dynamic_roles SET id = id + 100 WHERE id < 100');
        
        // Update users to point to the new shifted role IDs
        await pool.query('UPDATE users SET role_id = role_id + 100 WHERE id IN (3, 4, 5, 6, 7)');
        
        // Update audit logs to point to the new shifted role IDs
        await pool.query('UPDATE audit_logs SET role_id = role_id + 100 WHERE role_id < 100 AND role_id IS NOT NULL');

        // Reset the sequence
        await pool.query("SELECT setval('dynamic_roles_id_seq', (SELECT MAX(id) FROM dynamic_roles))");

        // Re-add constraints manually based on what we know exists
        await pool.query('ALTER TABLE documents ADD CONSTRAINT documents_current_role_id_fkey FOREIGN KEY (current_role_id) REFERENCES dynamic_roles(id) ON DELETE SET NULL');
        await pool.query('ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_role_id_fkey FOREIGN KEY (role_id) REFERENCES dynamic_roles(id) ON DELETE SET NULL');
        
        await pool.query('COMMIT');
        console.log('✅ Role Shift Migration completed successfully!');
    } catch (e) {
        await pool.query('ROLLBACK');
        console.error('Migration failed:', e);
    } finally {
        pool.end();
    }
}
migrate();
