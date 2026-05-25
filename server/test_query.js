const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER, 
    host: process.env.DB_HOST, 
    database: process.env.DB_NAME, 
    password: process.env.DB_PASSWORD, 
    port: process.env.DB_PORT,
});

async function run() {
    try {
        const query = `
            SELECT d.*
            FROM documents d 
            WHERE 
                (d.status = 'Pending' AND (
                    d.current_assignee_id = $1 
                    OR (
                        d.current_assignee_id IS NULL 
                        AND d.current_role_id = $2
                        AND (d.current_department_id IS NULL OR d.current_department_id = $3)
                    )
                    OR (
                        d.parallel_branch_data IS NOT NULL AND EXISTS (
                            SELECT 1 FROM jsonb_array_elements(d.parallel_branch_data::jsonb) AS b
                            WHERE b->>'status' = 'Pending'
                            AND (
                                (b->>'assigneeId')::numeric = $1
                                OR (
                                    (b->>'assigneeId') IS NULL
                                    AND (b->>'roleId')::numeric = $2
                                    AND ((b->>'departmentId') IS NULL OR (b->>'departmentId')::numeric = $3)
                                )
                            )
                        )
                    )
                ))
            ORDER BY d.created_at DESC
        `;
        const res = await pool.query(query, [1, 2, 3]);
        console.log("Success, rows:", res.rows.length);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
