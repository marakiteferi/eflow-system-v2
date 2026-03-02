import api from '../api';
import { useCallback, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// The default starting point for any new workflow
const initialNodes = [
  { 
    id: '1', 
    position: { x: 250, y: 50 }, 
    data: { label: 'Start: Document Submitted' }, 
    type: 'input',
    style: { backgroundColor: '#e0f2fe', border: '2px solid #0284c7', borderRadius: '8px', padding: '10px' }
  },
];

const initialEdges = [];

let idCounter = 2;
const getId = () => `${idCounter++}`;

const WorkflowBuilder = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [workflowName, setWorkflowName] = useState('');

  // Handles drawing lines between nodes
  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  // Adds a new step to the canvas
  const handleAddNode = () => {
    const newNode = {
      id: getId(),
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: { label: `New Step ${idCounter - 1}` },
      style: { backgroundColor: '#ffffff', border: '2px solid #64748b', borderRadius: '8px', padding: '10px' }
    };
    setNodes((nds) => nds.concat(newNode));
  };

  // Extracts the JSON to send to the backend
 const handleSaveWorkflow = async () => {
    if (!workflowName) {
      alert('Please enter a name for this workflow.');
      return;
    }
    
    const workflowData = {
      name: workflowName,
      flow_structure: { nodes, edges }
    };
    
    try {
      // This is where the 'api' variable is actually used
     await api.post('/workflows', workflowData);
      alert('Workflow successfully saved to the database!');
      setWorkflowName('');
    } catch (error) {
      console.error('Failed to save workflow:', error);
      alert('Error saving workflow. Check console for details.');
    }
  };
  return (
    <div className="flex flex-col h-[600px] border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Builder Toolbar */}
      <div className="p-4 bg-gray-50 border-b border-gray-300 flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <input 
            type="text" 
            placeholder="Workflow Name (e.g., Leave Request)" 
            className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
          />
          <button 
            onClick={handleAddNode}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 text-sm font-medium transition-colors"
          >
            + Add Step
          </button>
        </div>
        <button 
          onClick={handleSaveWorkflow}
          className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-sm font-medium transition-colors"
        >
          Save Workflow
        </button>
      </div>

      {/* Drag and Drop Canvas */}
      <div className="flex-grow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Controls />
          <MiniMap />
          <Background variant="dots" gap={12} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
};

export default WorkflowBuilder;