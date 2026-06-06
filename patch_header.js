const fs = require('fs');
let r = fs.readFileSync('client/src/components/WorkflowBuilder.jsx', 'utf8');

// 1. Rename states
r = r.replace(/const \[prerequisiteWorkflowId, setPrerequisiteWorkflowId\] = useState\(''\);/g, "const [prerequisiteWorkflowIds, setPrerequisiteWorkflowIds] = useState('');");
r = r.replace(/setPrerequisiteWorkflowId\(flowData\.metadata\?\.prerequisiteWorkflowId \|\| ''\);/g, "setPrerequisiteWorkflowIds(flowData.metadata?.prerequisiteWorkflowIds?.join(',') || '');");
r = r.replace(/prerequisiteWorkflowId: prerequisiteWorkflowId \|\| null,/g, "prerequisiteWorkflowIds: prerequisiteWorkflowIds ? prerequisiteWorkflowIds.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : null,");
r = r.replace(/setPrerequisiteWorkflowId\(''\);/g, "setPrerequisiteWorkflowIds('');");

// 2. Replace Prerequisite and Clearance UI
const newHeaderUI = `
        <MultiSelectDropdown
          label="Prerequisites"
          options={savedWorkflows.filter(w => w.id !== parseInt(selectedWorkflowId || 0))}
          selectedIds={prerequisiteWorkflowIds}
          onChange={setPrerequisiteWorkflowIds}
          title="Workflows that must be fully approved before a user can submit this document."
        />
        <MultiSelectDropdown
          label="Clearances"
          options={savedWorkflows.filter(w => w.id !== parseInt(selectedWorkflowId || 0))}
          selectedIds={clearanceWorkflowIds}
          onChange={setClearanceWorkflowIds}
          title="Sub-workflows spawned on submission that must be approved before this document can be completed."
        />
`;

r = r.replace(/        <div className="flex items-center gap-2 relative group hidden sm:flex">[\s\S]*?(?=        <button)/, newHeaderUI + "\n        ");

fs.writeFileSync('client/src/components/WorkflowBuilder.jsx', r);
console.log("Patched WorkflowBuilder header UI!");
