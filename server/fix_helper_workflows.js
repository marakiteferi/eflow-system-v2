const { Client } = require('pg');

async function fix() {
    const client = new Client({ user: 'postgres', password: '1234', host: 'localhost', port: 5432, database: 'eflow_demo' });
    await client.connect();

    // 1. Fetch workflow IDs by name
    const getWf = async (name) => {
        const res = await client.query('SELECT id FROM workflows WHERE name = $1', [name]);
        return res.rows[0]?.id;
    };

    const alumniId = await getWf('Alumni Network Setup');
    const ethicsId = await getWf('Ethics Board Approval');
    const libraryId = await getWf('Library Book Clearance');
    const gradId = await getWf('Graduating Student Clearance Process');

    if (alumniId) {
        const alumniFlow = {
            nodes: [
                { id: 't1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Verify Student Identity', assignee: '7' } },
                { id: 't2', type: 'task', position: {x: 400, y: 250}, data: { label: 'Provision Alumni Email', assignee: '4' } },
                { id: 't3', type: 'task', position: {x: 400, y: 400}, data: { label: 'Send Welcome Packet', assignee: '3' } },
                { id: 'e1', type: 'email', position: {x: 400, y: 550}, data: { label: 'Notify Alumni', recipient: '{{submitter_email}}', subject: 'Welcome to Alumni Network!', body: 'Dear {{submitter_name}}, Your alumni account is ready.' } }
            ],
            edges: [
                {id: 'e_t1_t2', source: 't1', target: 't2', type: 'smoothstep', animated: true},
                {id: 'e_t2_t3', source: 't2', target: 't3', type: 'smoothstep', animated: true},
                {id: 'e_t3_e1', source: 't3', target: 'e1', type: 'smoothstep', animated: true}
            ],
            metadata: { isPublished: true, allowedSubmitters: [] }
        };
        await client.query('UPDATE workflows SET flow_structure = $1 WHERE id = $2', [JSON.stringify(alumniFlow), alumniId]);
    }

    if (ethicsId) {
        const ethicsFlow = {
            nodes: [
                { id: 't1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Initial Protocol Review', assignee: '5' } },
                { id: 't2', type: 'task', position: {x: 400, y: 250}, data: { label: 'Full Board Evaluation', assignee: '8' } },
                { id: 'c1', type: 'condition', position: {x: 400, y: 400}, data: { label: 'Requires Revisions?', conditionValue: 'needs_revision' } },
                { id: 't3', type: 'task', position: {x: 200, y: 550}, data: { label: 'Review Revised Protocol', assignee: '6' } },
                { id: 'j1', type: 'join', position: {x: 400, y: 700}, data: { label: 'Merge Paths' } },
                { id: 't4', type: 'task', position: {x: 400, y: 850}, data: { label: 'Final Ethics Certification', assignee: '2' } }
            ],
            edges: [
                {id: 'e1', source: 't1', target: 't2', type: 'smoothstep', animated: true},
                {id: 'e2', source: 't2', target: 'c1', type: 'smoothstep', animated: true},
                {id: 'e3', source: 'c1', target: 't3', type: 'smoothstep', animated: true, sourceHandle: 'true'},
                {id: 'e4', source: 'c1', target: 'j1', type: 'smoothstep', animated: true, sourceHandle: 'false'},
                {id: 'e5', source: 't3', target: 'j1', type: 'smoothstep', animated: true},
                {id: 'e6', source: 'j1', target: 't4', type: 'smoothstep', animated: true}
            ],
            metadata: { isPublished: true, allowedSubmitters: [] }
        };
        await client.query('UPDATE workflows SET flow_structure = $1 WHERE id = $2', [JSON.stringify(ethicsFlow), ethicsId]);
    }

    if (libraryId) {
        const libraryFlow = {
            nodes: [
                { id: 't1', type: 'task', position: {x: 400, y: 100}, data: { label: 'Check Overdue Books', assignee: '9' } },
                { id: 't2', type: 'task', position: {x: 400, y: 250}, data: { label: 'Assess Late Fines', assignee: '3' } },
                { id: 't3', type: 'task', position: {x: 400, y: 400}, data: { label: 'Library Final Signoff', assignee: '8' } }
            ],
            edges: [
                {id: 'e1', source: 't1', target: 't2', type: 'smoothstep', animated: true},
                {id: 'e2', source: 't2', target: 't3', type: 'smoothstep', animated: true}
            ],
            metadata: { isPublished: true, allowedSubmitters: [] }
        };
        await client.query('UPDATE workflows SET flow_structure = $1 WHERE id = $2', [JSON.stringify(libraryFlow), libraryId]);
    }

    // Fix the Graduating Student Clearance spawnIds issue
    if (gradId && alumniId) {
        const gradRes = await client.query('SELECT flow_structure FROM workflows WHERE id = $1', [gradId]);
        if (gradRes.rows.length > 0) {
            let flow = gradRes.rows[0].flow_structure;
            if (typeof flow === 'string') flow = JSON.parse(flow);
            
            const spawnNode = flow.nodes.find(n => n.type === 'spawn');
            if (spawnNode && spawnNode.data) {
                // Remove wrong property and add the right one expected by backend and frontend
                delete spawnNode.data.workflowId;
                spawnNode.data.spawnIds = alumniId.toString();
                
                await client.query('UPDATE workflows SET flow_structure = $1 WHERE id = $2', [JSON.stringify(flow), gradId]);
            }
        }
    }

    console.log('Fixed helper workflows and spawn IDs!');
    await client.end();
}
fix();
