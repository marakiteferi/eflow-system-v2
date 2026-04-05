const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function run() {
  try {
    const sql = fs.readFileSync('01_document_prerequisites.sql', 'utf8');
    await pool.query(sql);
    console.log('Migration completed.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}
run();
