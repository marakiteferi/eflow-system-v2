require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'eflow_demo',
  password: '1234',
  port: 5432
});

async function run() {
  try {
    // ---------------------------------------------------------
    // HELPER WORKFLOWS (For Prerequisite, Clearance, Spawn)
    // ---------------------------------------------------------
    const helper1 = {
      nodes: [{ id: 'task_1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Library Clearance Verification', assignee: '9' } }],
      edges: [],
      metadata: { isPublished: true, allowedSubmitters: [] }
    };
    const resH1 = await pool.query('INSERT INTO workflows (name, flow_structure) VALUES ($1, $2) RETURNING id', ['Library Book Clearance', JSON.stringify(helper1)]);
    const clearanceWfId = resH1.rows[0].id;

    const helper2 = {
      nodes: [{ id: 'task_1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Ethics Board Signoff', assignee: '8' } }],
      edges: [],
      metadata: { isPublished: true, allowedSubmitters: [] }
    };
    const resH2 = await pool.query('INSERT INTO workflows (name, flow_structure) VALUES ($1, $2) RETURNING id', ['Ethics Board Approval', JSON.stringify(helper2)]);
    const prereqWfId = resH2.rows[0].id;

    const helper3 = {
      nodes: [{ id: 'task_1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Create Alumni Account', assignee: '4' } }],
      edges: [],
      metadata: { isPublished: true, allowedSubmitters: [] }
    };
    const resH3 = await pool.query('INSERT INTO workflows (name, flow_structure) VALUES ($1, $2) RETURNING id', ['Alumni Network Setup', JSON.stringify(helper3)]);
    const spawnWfId = resH3.rows[0].id;

    // ---------------------------------------------------------
    // WORKFLOW 1: New Degree Program Proposal
    // ---------------------------------------------------------
    const wf1 = {
      nodes: [
        { id: 'task_1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Department Chair Review', assignee: '5' } },
        { id: 'parallel_1', type: 'parallel', position: {x: 400, y: 200}, data: { label: 'Distribute to Committees' } },
        { id: 'task_2', type: 'task', position: {x: 200, y: 300}, data: { label: 'Faculty Dean Review', assignee: '6' } },
        { id: 'task_3', type: 'task', position: {x: 400, y: 300}, data: { label: 'Library Resources Review', assignee: '9' } },
        { id: 'task_4', type: 'task', position: {x: 600, y: 300}, data: { label: 'IT Infrastructure Review', assignee: '4' } },
        { id: 'join_1', type: 'join', position: {x: 400, y: 450}, data: { label: 'Wait for All Committees' } },
        { id: 'task_5', type: 'task', position: {x: 400, y: 550}, data: { label: 'Registrar Office Verification', assignee: '7', allowedTags: 'accreditation_required,no_accreditation' } },
        { id: 'condition_1', type: 'condition', position: {x: 400, y: 650}, data: { label: 'Needs Accreditation?', conditionValue: 'accreditation_required' } },
        { id: 'task_6', type: 'task', position: {x: 200, y: 750}, data: { label: 'External Board Review', assignee: '8' } },
        { id: 'join_2', type: 'join', position: {x: 400, y: 850}, data: { label: 'Merge Conditional Paths' } },
        { id: 'task_7', type: 'task', position: {x: 400, y: 950}, data: { label: 'University Senate Final Approval', assignee: '2' } },
        { id: 'email_1', type: 'email', position: {x: 400, y: 1050}, data: { label: 'Approval Notification', recipient: '{{submitter_email}}', subject: 'Degree Program Approved', body: 'Dear {{submitter_name}}, Your proposed program {{document_title}} has been approved.' } }
      ],
      edges: [
        {id: 'e_t1_p1', source: 'task_1', target: 'parallel_1', type: 'smoothstep', animated: true},
        {id: 'e_p1_t2', source: 'parallel_1', target: 'task_2', type: 'smoothstep', animated: true},
        {id: 'e_p1_t3', source: 'parallel_1', target: 'task_3', type: 'smoothstep', animated: true},
        {id: 'e_p1_t4', source: 'parallel_1', target: 'task_4', type: 'smoothstep', animated: true},
        {id: 'e_t2_j1', source: 'task_2', target: 'join_1', type: 'smoothstep', animated: true},
        {id: 'e_t3_j1', source: 'task_3', target: 'join_1', type: 'smoothstep', animated: true},
        {id: 'e_t4_j1', source: 'task_4', target: 'join_1', type: 'smoothstep', animated: true},
        {id: 'e_j1_t5', source: 'join_1', target: 'task_5', type: 'smoothstep', animated: true},
        {id: 'e_t5_c1', source: 'task_5', target: 'condition_1', type: 'smoothstep', animated: true},
        {id: 'e_c1_t6', source: 'condition_1', target: 'task_6', type: 'smoothstep', animated: true, sourceHandle: 'true'},
        {id: 'e_c1_j2', source: 'condition_1', target: 'join_2', type: 'smoothstep', animated: true, sourceHandle: 'false'},
        {id: 'e_t6_j2', source: 'task_6', target: 'join_2', type: 'smoothstep', animated: true},
        {id: 'e_j2_t7', source: 'join_2', target: 'task_7', type: 'smoothstep', animated: true},
        {id: 'e_t7_e1', source: 'task_7', target: 'email_1', type: 'smoothstep', animated: true}
      ],
      metadata: { isPublished: true, allowedSubmitters: [] }
    };
    await pool.query('INSERT INTO workflows (name, flow_structure) VALUES ($1, $2)', ['New Degree Program Proposal', JSON.stringify(wf1)]);

    // ---------------------------------------------------------
    // WORKFLOW 2: Graduating Student Clearance Process
    // Features: clearanceWorkflowIds, spawn node
    // ---------------------------------------------------------
    const wf2 = {
      nodes: [
        { id: 'task_1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Academic Advisor Verification', assignee: '5' } },
        { id: 'task_2', type: 'task', position: {x: 400, y: 250}, data: { label: 'Thesis Format Checking', assignee: '3' } },
        { id: 'spawn_1', type: 'spawn', position: {x: 400, y: 400}, data: { label: 'Spawn Alumni Account Setup', workflowId: spawnWfId } },
        { id: 'task_3', type: 'task', position: {x: 400, y: 550}, data: { label: 'Faculty Dean Final Signoff', assignee: '6', allowedTags: 'has_unpaid_fees,cleared_fees' } },
        { id: 'condition_1', type: 'condition', position: {x: 400, y: 700}, data: { label: 'Has Unpaid Fees?', conditionValue: 'has_unpaid_fees' } },
        { id: 'task_4', type: 'task', position: {x: 200, y: 850}, data: { label: 'Finance Fee Collection', assignee: '8' } },
        { id: 'join_1', type: 'join', position: {x: 400, y: 950}, data: { label: 'Merge Fee Paths' } },
        { id: 'task_5', type: 'task', position: {x: 400, y: 1100}, data: { label: 'Registrar Graduation Approval', assignee: '7' } },
        { id: 'email_1', type: 'email', position: {x: 400, y: 1250}, data: { label: 'Notify Student', recipient: '{{submitter_email}}', subject: 'Congratulations on Graduating', body: 'Dear {{submitter_name}}, Your graduation clearance is complete.' } }
      ],
      edges: [
        {id: 'e_t1_t2', source: 'task_1', target: 'task_2', type: 'smoothstep', animated: true},
        {id: 'e_t2_s1', source: 'task_2', target: 'spawn_1', type: 'smoothstep', animated: true},
        {id: 'e_s1_t3', source: 'spawn_1', target: 'task_3', type: 'smoothstep', animated: true},
        {id: 'e_t3_c1', source: 'task_3', target: 'condition_1', type: 'smoothstep', animated: true},
        {id: 'e_c1_t4', source: 'condition_1', target: 'task_4', type: 'smoothstep', animated: true, sourceHandle: 'true'},
        {id: 'e_c1_j1', source: 'condition_1', target: 'join_1', type: 'smoothstep', animated: true, sourceHandle: 'false'},
        {id: 'e_t4_j1', source: 'task_4', target: 'join_1', type: 'smoothstep', animated: true},
        {id: 'e_j1_t5', source: 'join_1', target: 'task_5', type: 'smoothstep', animated: true},
        {id: 'e_t5_e1', source: 'task_5', target: 'email_1', type: 'smoothstep', animated: true}
      ],
      metadata: { isPublished: true, allowedSubmitters: [], clearanceWorkflowIds: [clearanceWfId] }
    };
    await pool.query('INSERT INTO workflows (name, flow_structure) VALUES ($1, $2)', ['Graduating Student Clearance Process', JSON.stringify(wf2)]);

    // ---------------------------------------------------------
    // WORKFLOW 3: Faculty Research Grant Application
    // Features: prerequisiteWorkflowId, parallel, condition
    // ---------------------------------------------------------
    const wf3 = {
      nodes: [
        { id: 'task_1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Head of Department Review', assignee: '5' } },
        { id: 'parallel_1', type: 'parallel', position: {x: 400, y: 200}, data: { label: 'Distribute for Peer Review' } },
        { id: 'task_2', type: 'task', position: {x: 200, y: 300}, data: { label: 'Peer Reviewer 1', assignee: '3' } },
        { id: 'task_3', type: 'task', position: {x: 600, y: 300}, data: { label: 'Peer Reviewer 2', assignee: '9' } },
        { id: 'join_1', type: 'join', position: {x: 400, y: 450}, data: { label: 'Wait for Peer Reviews' } },
        { id: 'task_4', type: 'task', position: {x: 400, y: 550}, data: { label: 'Faculty Dean Approval', assignee: '6', allowedTags: 'large_grant,standard_grant' } },
        { id: 'condition_1', type: 'condition', position: {x: 400, y: 700}, data: { label: 'Grant > $10,000?', conditionValue: 'large_grant' } },
        { id: 'task_5', type: 'task', position: {x: 200, y: 850}, data: { label: 'University President Signoff', assignee: '2' } },
        { id: 'join_2', type: 'join', position: {x: 400, y: 950}, data: { label: 'Merge Grant Paths' } },
        { id: 'task_6', type: 'task', position: {x: 400, y: 1100}, data: { label: 'Finance Disbursement', assignee: '4' } }
      ],
      edges: [
        {id: 'e_t1_p1', source: 'task_1', target: 'parallel_1', type: 'smoothstep', animated: true},
        {id: 'e_p1_t2', source: 'parallel_1', target: 'task_2', type: 'smoothstep', animated: true},
        {id: 'e_p1_t3', source: 'parallel_1', target: 'task_3', type: 'smoothstep', animated: true},
        {id: 'e_t2_j1', source: 'task_2', target: 'join_1', type: 'smoothstep', animated: true},
        {id: 'e_t3_j1', source: 'task_3', target: 'join_1', type: 'smoothstep', animated: true},
        {id: 'e_j1_t4', source: 'join_1', target: 'task_4', type: 'smoothstep', animated: true},
        {id: 'e_t4_c1', source: 'task_4', target: 'condition_1', type: 'smoothstep', animated: true},
        {id: 'e_c1_t5', source: 'condition_1', target: 'task_5', type: 'smoothstep', animated: true, sourceHandle: 'true'},
        {id: 'e_c1_j2', source: 'condition_1', target: 'join_2', type: 'smoothstep', animated: true, sourceHandle: 'false'},
        {id: 'e_t5_j2', source: 'task_5', target: 'join_2', type: 'smoothstep', animated: true},
        {id: 'e_j2_t6', source: 'join_2', target: 'task_6', type: 'smoothstep', animated: true}
      ],
      metadata: { isPublished: true, allowedSubmitters: [], prerequisiteWorkflowId: prereqWfId }
    };
    await pool.query('INSERT INTO workflows (name, flow_structure) VALUES ($1, $2)', ['Faculty Research Grant Application', JSON.stringify(wf3)]);

    console.log('Successfully created all 3 scenarios and their dependencies!');

  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
