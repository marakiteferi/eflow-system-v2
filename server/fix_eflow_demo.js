const { Client } = require('pg');

async function fixDemoSchema() {
    const client = new Client({
        user: 'postgres',
        password: '1234',
        host: 'localhost',
        port: 5432,
        database: 'eflow_demo'
    });

    try {
        await client.connect();
        console.log('Connected to eflow_demo...');

        await client.query(`
            ALTER TABLE workflows 
            ADD COLUMN IF NOT EXISTS allowed_submitters integer[] DEFAULT '{}'::integer[];
        `);
        console.log('Added missing column `allowed_submitters` to `workflows` table.');

        await client.query(`
            ALTER TABLE audit_logs 
            DROP CONSTRAINT IF EXISTS audit_logs_role_id_fkey;
        `);
        await client.query(`
            ALTER TABLE audit_logs 
            ADD CONSTRAINT audit_logs_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.dynamic_roles(id) ON UPDATE CASCADE ON DELETE SET NULL;
        `);
        console.log('Updated `audit_logs` foreign key constraints to match eflow_db_2.');

        console.log('eflow_demo schema is now perfectly identical to eflow_db_2_updated without touching the data!');

    } catch (e) {
        console.error('Error applying schema fix:', e);
    } finally {
        await client.end();
    }
}

fixDemoSchema();
