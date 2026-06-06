const fs = require('fs');
let r = fs.readFileSync('client/src/components/WorkflowBuilder.jsx', 'utf8');

// 1. Rename states
r = r.replace(/const \[prerequisiteWorkflowId, setPrerequisiteWorkflowId\] = useState\(''\);/g, "const [prerequisiteWorkflowIds, setPrerequisiteWorkflowIds] = useState('');");
r = r.replace(/setPrerequisiteWorkflowId\(flowData\.metadata\?\.prerequisiteWorkflowId \|\| ''\);/g, "setPrerequisiteWorkflowIds(flowData.metadata?.prerequisiteWorkflowIds?.join(',') || '');");
r = r.replace(/prerequisiteWorkflowId: prerequisiteWorkflowId \|\| null,/g, "prerequisiteWorkflowIds: prerequisiteWorkflowIds ? prerequisiteWorkflowIds.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : null,");
r = r.replace(/setPrerequisiteWorkflowId\(''\);/g, "setPrerequisiteWorkflowIds('');");

// 2. Replace the UI block with MultiSelectDropdown for Applies To Roles, Prerequisites, and Clearances
const startMatch = '<div className="flex items-center gap-2 relative group hidden sm:flex">\n          <span className="text-xs font-bold text-gray-500">Allowed Roles:</span>';
const endMatch = '</div>\n          )}';

const newHeaderUI = `
        <MultiSelectDropdown
          label="Applies To Roles"
          options={rolesList}
          selectedIds={allowedSubmitters.join(',')}
          onChange={(val) => setAllowedSubmitters(val ? val.split(',').filter(Boolean).map(Number) : [])}
          title="Roles that are allowed to start this workflow."
        />

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
        />`;

const startIndex = r.indexOf(startMatch);
if (startIndex !== -1) {
  // Find the closing div of the Clearances block. Let's find the toggleFullScreen button to anchor it.
  const buttonAnchor = '<button onClick={toggleFullScreen}';
  const endIndex = r.indexOf(buttonAnchor, startIndex);
  if (endIndex !== -1) {
    // Replace the chunk
    r = r.slice(0, startIndex) + newHeaderUI + '\n\n        <div className="flex-grow"></div>\n\n        ' + r.slice(endIndex);
  }
} else {
  console.log("Could not find start block");
}

fs.writeFileSync('client/src/components/WorkflowBuilder.jsx', r);
console.log("Patched WorkflowBuilder header UI successfully!");
