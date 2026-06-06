const { Client } = require('pg');

async function getSchema(db) {
  const client = new Client({ user: 'postgres', password: '1234', host: 'localhost', port: 5432, database: db });
  await client.connect();
  const res = await client.query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema='public'
  `);
  await client.end();
  return res.rows;
}

async function run() {
  const ref = await getSchema('eflow_db_2');
  const demo = await getSchema('eflow_demo');
  
  const refSet = new Set(ref.map(r => r.table_name + '.' + r.column_name));
  const demoSet = new Set(demo.map(r => r.table_name + '.' + r.column_name));
  
  console.log('--- MISSING IN DEMO ---');
  ref.filter(r => !demoSet.has(r.table_name + '.' + r.column_name)).forEach(r => console.log(r));

  console.log('\\n--- EXTRA IN DEMO ---');
  demo.filter(r => !refSet.has(r.table_name + '.' + r.column_name)).forEach(r => console.log(r));
}
run().catch(console.error);
