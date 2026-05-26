const fs = require('fs');
const path = require('path');

const filePath = path.join('c:', 'Users', 'maraki', 'Desktop', 'final year project with antigravity', 'eflow-system', 'server', 'src', 'routes', 'approvalRoutes.js');
let content = fs.readFileSync(filePath, 'utf8');

// We need to replace pool.query with client.query in the try block of /approve and /reject.
// To be safe, we will do string replacements with exact boundaries.

// 1. Fix /reject
content = content.replace(
    /try \{\r?\n\s*await pool\.query\('BEGIN'\);\r?\n\s*await pool\.query\("UPDATE documents SET status = 'Rejected'/g,
    `let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query("UPDATE documents SET status = 'Rejected'`
);

content = content.replace(
    /await pool\.query\('SELECT title, submitter_id/g,
    `await client.query('SELECT title, submitter_id`
);

content = content.replace(
    /await pool\.query\("INSERT INTO approvals/g,
    `await client.query("INSERT INTO approvals`
);

content = content.replace(
    /await pool\.query\("INSERT INTO audit_logs/g,
    `await client.query("INSERT INTO audit_logs`
);

content = content.replace(
    /await pool\.query\('COMMIT'\);\r?\n\r?\n\s*await sendNotificationEmail\(\r?\n\s*doc\.submitter_id,\r?\n\s*'Action Required: Document Rejected'/g,
    `await client.query('COMMIT');

        await sendNotificationEmail(
            doc.submitter_id,
            'Action Required: Document Rejected'`
);

content = content.replace(
    /\} catch \(err\) \{\r?\n\s*await pool\.query\('ROLLBACK'\);\r?\n\s*console\.error\(err\);\r?\n\s*res\.status\(500\)\.json\(\{ message: 'Database error during rejection' \}\);\r?\n\s*\}/g,
    `} catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Database error during rejection' });
    } finally {
        if (client) client.release();
    }`
);

// 2. Fix /approve
content = content.replace(
    /try \{\r?\n\s*await pool\.query\('BEGIN'\);\r?\n\r?\n\s*\/\/ Fetch doc details including file_path/g,
    `let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Fetch doc details including file_path`
);

// Replace all remaining pool.query with client.query BETWEEN the start of /approve's try block and its catch block.
// We can find the start of the try block by finding `let client;\n    try {\n        client = await pool.connect();`
// But an easier way is to just use a regular expression to match the /approve function body.

const approveStartIndex = content.indexOf('router.post(\'/approve\'');
const approveEndIndex = content.indexOf('router.post(\'/reject\'');

let approveBody = content.substring(approveStartIndex, approveEndIndex);

approveBody = approveBody.replace(/pool\.query/g, 'client.query');

// But wait, the executeEmailNode and executeSpawnNode inside /approve might need to use `pool.query` or `client.query`.
// It is perfectly fine for them to use `client.query`.
// But wait, there is `await appendSignatureCertificate(doc.file_path, documentId, doc.title, pool);`
// It should still pass `pool` because the signature cert logic runs AFTER COMMIT and has its own isolated queries!
approveBody = approveBody.replace(/await appendSignatureCertificate\(doc\.file_path, documentId, doc\.title, client\)/g, 'await appendSignatureCertificate(doc.file_path, documentId, doc.title, pool)');

content = content.substring(0, approveStartIndex) + approveBody + content.substring(approveEndIndex);

// Fix the catch block of /approve
content = content.replace(
    /\} catch \(err\) \{\r?\n\s*await client\.query\('ROLLBACK'\);\r?\n\s*console\.error\(err\);\r?\n\s*res\.status\(500\)\.json\(\{ message: 'Database error' \}\);\r?\n\s*\}/g,
    `} catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'Database error' });
    } finally {
        if (client) client.release();
    }`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully refactored approvalRoutes.js');
