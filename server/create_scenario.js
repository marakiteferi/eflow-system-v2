require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD),
  port: process.env.DB_PORT
});

const workflow = {
  nodes: [
    { id: 'task_1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Department Chair Review', assignee: '6' } },
    { id: 'parallel_1', type: 'parallel', position: {x: 400, y: 200}, data: { label: 'Distribute to Committees' } },
    { id: 'task_2', type: 'task', position: {x: 200, y: 300}, data: { label: 'Academic Affairs Review', assignee: '7' } },
    { id: 'task_3', type: 'task', position: {x: 400, y: 300}, data: { label: 'Budget & Finance Review', assignee: '8' } },
    { id: 'task_4', type: 'task', position: {x: 600, y: 300}, data: { label: 'Library Resources Review', assignee: '13' } },
    { id: 'join_1', type: 'join', position: {x: 400, y: 450}, data: { label: 'Wait for All Committees' } },
    { id: 'task_5', type: 'task', position: {x: 400, y: 550}, data: { label: 'College Dean Review', assignee: '15', allowedTags: 'accreditation_required,no_accreditation' } },
    { id: 'condition_1', type: 'condition', position: {x: 400, y: 650}, data: { label: 'Needs Accreditation?', conditionValue: 'accreditation_required' } },
    { id: 'task_6', type: 'task', position: {x: 200, y: 750}, data: { label: 'Accreditation Board Review', assignee: '9' } },
    { id: 'join_2', type: 'join', position: {x: 400, y: 850}, data: { label: 'Merge Conditional Paths' } },
    { id: 'task_7', type: 'task', position: {x: 400, y: 950}, data: { label: 'University Senate Final Approval', assignee: '2' } },
    { id: 'email_1', type: 'email', position: {x: 400, y: 1050}, data: { label: 'Approval Notification', recipient: '{{submitter_email}}', subject: 'Course Approved', body: 'Dear {{submitter_name}},\n\nYour course proposal {{document_title}} has been fully approved by the University Senate and will be added to the catalog.' } }
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
  metadata: { isPublished: true, allowedSubmitters: [], prerequisiteWorkflowId: null }
};

pool.query('INSERT INTO workflows (name, flow_structure) VALUES ($1, $2) RETURNING id', ['New Course Curriculum Approval', JSON.stringify(workflow)])
  .then(res => { 
    console.log('Inserted Workflow ID:', res.rows[0].id); 
    return pool.query('INSERT INTO audit_logs (user_id, action) VALUES ($1, $2)', [9, `Created new workflow: 'New Course Curriculum Approval'`]);
  })
  .then(() => {
    process.exit(0); 
  })
  .catch(console.error);
