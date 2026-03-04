require('dotenv').config();
const cron = require('node-cron');
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

// Helper: Calculate if time has expired
const isSlaBreached = (updatedAt, slaHours) => {
    if (!slaHours) return false;
    const updateTime = new Date(updatedAt).getTime();
    const currentTime = new Date().getTime();
    const hoursPassed = (currentTime - updateTime) / (1000 * 60 * 60);
    return hoursPassed > parseFloat(slaHours);
};

// The Monitoring Engine
const startSlaMonitor = () => {
    console.log('⏳ SLA Monitor activated. Scanning for breached deadlines every 5 minutes...');

    // Runs every 5 minutes (Change to '0 * * * *' for every hour in production)
    cron.schedule('*/5 * * * *', async () => {
        try {
            // 1. Get all pending documents
            const pendingDocs = await pool.query("SELECT id, title, workflow_id, current_node_id, current_assignee_id, updated_at FROM documents WHERE status = 'Pending'");
            
            for (let doc of pendingDocs.rows) {
                if (!doc.workflow_id || !doc.current_node_id) continue;

                // 2. Load the workflow to check the SLA limit
                const wfQuery = await pool.query('SELECT flow_structure FROM workflows WHERE id = $1', [doc.workflow_id]);
                if (wfQuery.rows.length === 0) continue;

                const flowData = typeof wfQuery.rows[0].flow_structure === 'string' ? JSON.parse(wfQuery.rows[0].flow_structure) : wfQuery.rows[0].flow_structure;
                const currentNode = (flowData.nodes || []).find(n => n.id === doc.current_node_id);

                if (currentNode && currentNode.data?.slaHours) {
                    if (isSlaBreached(doc.updated_at, currentNode.data.slaHours)) {
                        console.log(`🚨 SLA BREACH DETECTED: Document "${doc.title}" exceeded ${currentNode.data.slaHours} hours! Auto-escalating...`);

                        // 3. Auto-Escalate Logic (Routing to next node)
                        const edges = flowData.edges || [];
                        let nextNodeId = null;
                        let nextAssigneeId = null;
                        let isFinalStep = true;

                        let outgoingEdges = edges.filter(e => e.source === doc.current_node_id);
                        if (outgoingEdges.length > 0) {
                            let edgeToFollow = outgoingEdges[0]; // Assuming standard linear flow for escalations
                            let targetNode = flowData.nodes.find(n => n.id === edgeToFollow.target);
                            
                            if (targetNode) {
                                nextNodeId = targetNode.id;
                                nextAssigneeId = targetNode.data?.assignee ? parseInt(targetNode.data.assignee, 10) : null;
                                isFinalStep = false;
                            }
                        }

                        await pool.query('BEGIN');

                        if (isFinalStep) {
                            // If it breaches on the final step, we just auto-approve it (or you could route it to an Admin queue!)
                            await pool.query("UPDATE documents SET status = 'Approved', current_node_id = NULL, current_assignee_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [doc.id]);
                            await pool.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'System Auto-Approved due to SLA Breach')", [doc.id, doc.current_assignee_id]);
                        } else {
                            // Escalate to next step
                            await pool.query("UPDATE documents SET current_node_id = $1, current_assignee_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3", [nextNodeId, nextAssigneeId, doc.id]);
                            await pool.query("INSERT INTO audit_logs (document_id, user_id, action) VALUES ($1, $2, 'System Auto-Escalated to next step due to SLA Breach')", [doc.id, doc.current_assignee_id]);
                        }

                        // Log the failure against the person who missed the deadline
                        await pool.query("INSERT INTO approvals (document_id, approver_id, node_id, status, comments) VALUES ($1, $2, $3, 'Auto-Escalated', 'SLA Breached - System override')", [doc.id, doc.current_assignee_id, doc.current_node_id]);

                        await pool.query('COMMIT');
                    }
                }
            }
        } catch (err) {
            console.error('SLA Monitor Error:', err);
        }
    });
};

module.exports = startSlaMonitor;