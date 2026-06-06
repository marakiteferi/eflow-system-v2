const { Client } = require('pg');

async function getSchema(dbName) {
  const client = new Client({ user: 'postgres', password: '1234', host: 'localhost', port: 5432, database: dbName });
  await client.connect();
  
  const tables = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema='public' AND table_type='BASE TABLE'
  `);
  
  const schema = {};
  for (let row of tables.rows) {
    const tableName = row.table_name;
    const cols = await client.query(`
      SELECT column_name, data_type, character_maximum_length, column_default 
      FROM information_schema.columns 
      WHERE table_schema='public' AND table_name=$1
    `, [tableName]);
    schema[tableName] = cols.rows.map(c => ({
      name: c.column_name,
      type: c.data_type,
      length: c.character_maximum_length,
      default: c.column_default
    }));
  }
  
  await client.end();
  return schema;
}

async function main() {
  const schemaRef = await getSchema('eflow_db_2');
  const schemaDemo = await getSchema('eflow_demo');
  
  const missingTables = [];
  const missingColumns = [];
  
  for (let table in schemaRef) {
    if (!schemaDemo[table]) {
      missingTables.push(table);
    } else {
      const refCols = schemaRef[table];
      const demoCols = schemaDemo[table];
      
      for (let rc of refCols) {
        if (!demoCols.find(dc => dc.name === rc.name)) {
          missingColumns.push({ table, col: rc });
        }
      }
    }
  }
  
  console.log('--- MISSING TABLES IN DEMO ---');
  console.log(missingTables);
  
  console.log('\n--- MISSING COLUMNS IN DEMO ---');
  console.log(missingColumns);
}

main().catch(console.error);
