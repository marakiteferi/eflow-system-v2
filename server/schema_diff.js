const fs = require('fs');

let refSql = fs.readFileSync('eflow_db_2_ updated.sql', 'utf16le');
if (!refSql.includes('CREATE TABLE')) {
    refSql = fs.readFileSync('eflow_db_2_ updated.sql', 'utf8');
}
const demoSql = fs.readFileSync('eflow_demo.sql', 'utf8');

function extractCleanSchema(sql) {
    const lines = sql.split(/\r?\n/);
    const result = [];
    let inData = false;
    for (let line of lines) {
        if (line.startsWith('COPY ')) inData = true;
        if (inData && line.startsWith('\\.')) {
            inData = false;
            continue;
        }
        if (!inData && line.trim() && !line.startsWith('--') && !line.startsWith('INSERT INTO') && !line.startsWith('SET ') && !line.startsWith('SELECT ')) {
            // standardize spaces
            result.push(line.trim().replace(/\s+/g, ' '));
        }
    }
    return result;
}

const refLines = extractCleanSchema(refSql);
const demoLines = extractCleanSchema(demoSql);

const demoSet = new Set(demoLines);

console.log('--- MISSING IN DEMO ---');
let missing = [];
for (let line of refLines) {
    if (!demoSet.has(line)) {
        missing.push(line);
    }
}
console.log(missing.join('\n'));
