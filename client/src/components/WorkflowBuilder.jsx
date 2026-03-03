import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, { addEdge, applyNodeChanges, applyEdgeChanges, Background, Controls, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import api from '../api';

// --- Custom Node Component ---
const AssignableNode = ({ id, data }) => {
  return (
    <div className="bg-white border-2 border-indigo-500 rounded-lg p-3 shadow-md min-w-[180px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-indigo-500" />
      <div className="font-bold text-sm text-gray-800 border-b pb-1 mb-2">
         <input 
           type="text" 
           value={data.label} 
           onChange={(e) => data.onLabelChange(id, e.target.value)}
           className="w-full outline-none nodrag bg-transparent"
           placeholder="Step Name"
         />
      </div>
      <div className="text-xs text-gray-500 mb-1">Assign to:</div>
      <select 
        className="w-full text-xs border border-gray-300 rounded p-1 nodrag bg-white"
        value={data.assignee || ''}
        onChange={(e) => data.onAssign(id, e.target.value)}
      >
        <option value="">-- Any Staff --</option>
        {data.staffList && data.staffList.map(staff => (
          <option key={staff.id} value={staff.id}>{staff.name}</option>
        ))}
      </select>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-indigo-500" />
    </div>
  );
};

const WorkflowBuilder = () => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [workflowName, setWorkflowName] = useState('');
  const [staffList, setStaffList] = useState([]);
  
  // Register the custom node type
  const nodeTypes = useMemo(() => ({ assignable: AssignableNode }), []);

  useEffect(() => {
    // Fetch only Staff members for the dropdowns
    const fetchStaff = async () => {
      try {
        const res = await api.get('/admin/users');
        setStaffList(res.data.filter(u => u.role_id === 2 || u.role_name === 'Staff'));
      } catch (err) {
        console.error(err);
      }
    };
    fetchStaff();
  }, []);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), []);

  const onLabelChange = (id, newLabel) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === id) node.data = { ...node.data, label: newLabel };
      return node;
    }));
  };

  const onAssign = (id, newAssignee) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === id) node.data = { ...node.data, assignee: newAssignee };
      return node;
    }));
  };

  const addNode = () => {
    const newNode = {
      id: `node_${Date.now()}`,
      type: 'assignable',
      position: { x: 250, y: nodes.length * 100 + 50 },
      data: { label: `Step ${nodes.length + 1}`, staffList, onAssign, onLabelChange, assignee: '' },
    };
    setNodes((nds) => nds.concat(newNode));
  };

  // Re-inject functions into nodes if the staff list updates
  useEffect(() => {
    setNodes((nds) => nds.map(node => ({
      ...node,
      data: { ...node.data, staffList, onAssign, onLabelChange }
    })));
  }, [staffList]);

  const saveWorkflow = async () => {
    if (!workflowName) return alert('Enter a workflow name');
    try {
      const flowData = JSON.stringify({ nodes, edges });
      await api.post('/workflows', { name: workflowName, flow_structure: flowData });
      alert('Workflow saved successfully!');
      setNodes([]); setEdges([]); setWorkflowName('');
    } catch (err) {
      console.error(err);
      alert('Failed to save workflow');
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
      <div className="flex gap-4 mb-4">
        <input 
          type="text" 
          placeholder="Workflow Name (e.g., Clearance Form)" 
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          className="flex-grow px-3 py-2 border rounded-md"
        />
        <button onClick={addNode} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">Add Step</button>
        <button onClick={saveWorkflow} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700">Save Workflow</button>
      </div>
      <div className="h-[500px] border border-gray-200 rounded-md bg-gray-50">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes}>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
};

export default WorkflowBuilder;