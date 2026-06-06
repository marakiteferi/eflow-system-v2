const fs = require('fs');
let r = fs.readFileSync('client/src/components/WorkflowBuilder.jsx', 'utf8');

const correctSection = `        <MultiSelectDropdown
          label="Clearances"
          options={savedWorkflows.filter(w => w.id !== parseInt(selectedWorkflowId || 0))}
          selectedIds={clearanceWorkflowIds}
          onChange={setClearanceWorkflowIds}
          title="Sub-workflows spawned on submission that must be approved before this document can be completed."
        />

        <div className="flex-grow"></div>

        <button onClick={toggleFullScreen} className="text-gray-500 hover:text-blue-600 p-1.5 rounded bg-gray-50 border border-gray-200 mr-2" title="Toggle Full Screen">
          {isFullScreen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 11lm0 0l-4-4m4 4v-3m0 3H6m6-6l4-4m-4 4h3m-3 0v-3m0 9l4 4m-4-4v3m0-3h3M9 15l-4 4m4-4h-3m3 0v3" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
          )}
        </button>

        {selectedWorkflowId && (
          <button onClick={handleDeleteWorkflow} className="text-gray-400 hover:text-red-500 p-1.5 rounded bg-gray-50 border border-gray-200 mr-2" title="Delete Workflow">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        )}`;

r = r.replace(/<MultiSelectDropdown[\s\S]*?label="Clearances"[\s\S]*?\/>[\s\S]*?<button onClick={handleClear}/, correctSection + '\n\n        <button onClick={handleClear}');
fs.writeFileSync('client/src/components/WorkflowBuilder.jsx', r);
console.log('Fixed syntax error!');
