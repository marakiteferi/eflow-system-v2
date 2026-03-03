import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, { addEdge, applyNodeChanges, applyEdgeChanges, Background, Controls, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import api from '../api';

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
  
  // NEW: State for managing existing workflows
  const [savedWorkflows, setSavedWorkflows] = useState([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');

  const nodeTypes = useMemo(() => ({ assignable: AssignableNode }), []);

  const fetchWorkflows = async () => {
    try {
      const res = await api.get('/workflows');
      setSavedWorkflows(res.data);
    } catch (err) {
      console.error('Failed to load workflows', err);
    }
  };

  useEffect(() => {
    const fetchStaff = async () => {
      try {
        const res = await api.get('/admin/users');
        setStaffList(res.data.filter(u => u.role_id === 2 || u.role_name === 'Staff'));
      } catch (err) {
        console.error(err);
      }
    };
    fetchStaff();
    fetchWorkflows();
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

  useEffect(() => {
    setNodes((nds) => nds.map(node => ({
      ...node,
      data: { ...node.data, staffList, onAssign, onLabelChange }
    })));
  }, [staffList]);

  // NEW: Load a workflow onto the canvas
  const handleLoadWorkflow = (e) => {
    const wfId = e.target.value;
    setSelectedWorkflowId(wfId);

    if (!wfId) {
      // Clear canvas if "Create New" is selected
      setNodes([]); setEdges([]); setWorkflowName('');
      return;
    }

    const wf = savedWorkflows.find(w => w.id === parseInt(wfId));
    if (wf) {
      setWorkflowName(wf.name);
      const flowData = typeof wf.flow_structure === 'string' ? JSON.parse(wf.flow_structure) : wf.flow_structure;
      
      const loadedNodes = (flowData.nodes || []).map(node => ({
        ...node,
        data: { ...node.data, staffList, onAssign, onLabelChange }
      }));
      
      setNodes(loadedNodes);
      setEdges(flowData.edges || []);
    }
  };

  // UPDATED: Handle both Create and Update
  const saveWorkflow = async () => {
    if (!workflowName) return alert('Enter a workflow name');
    try {
      const flowData = JSON.stringify({ nodes, edges });
      
      if (selectedWorkflowId) {
        // Update existing
        await api.put(`/workflows/${selectedWorkflowId}`, { name: workflowName, flow_structure: flowData });
        alert('Workflow updated successfully!');
      } else {
        // Create new
        await api.post('/workflows', { name: workflowName, flow_structure: flowData });
        alert('New workflow created successfully!');
      }
      
      fetchWorkflows(); // Refresh the dropdown list
    } catch (err) {
      console.error(err);
      alert('Failed to save workflow');
    }
  };

  // NEW: Delete Workflow Handler
  const deleteWorkflow = async () => {
    if (!selectedWorkflowId) return;
    const confirmDelete = window.confirm('Are you sure you want to delete this workflow?');
    if (!confirmDelete) return;

    try {
      await api.delete(`/workflows/${selectedWorkflowId}`);
      alert('Workflow deleted!');
      setNodes([]); setEdges([]); setWorkflowName(''); setSelectedWorkflowId('');
      fetchWorkflows();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Failed to delete workflow.');
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      
      {/* Top Bar: Workflow Selector */}
      <div className="flex gap-4 mb-6 pb-4 border-b border-gray-200 items-center">
        <span className="text-sm font-bold text-gray-700">Manage:</span>
        <select 
          value={selectedWorkflowId} 
          onChange={handleLoadWorkflow}
          className="flex-grow px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500"
        >
          <option value="">+ Create New Workflow</option>
          {savedWorkflows.map(wf => (
            <option key={wf.id} value={wf.id}>{wf.name}</option>
          ))}
        </select>
        
        {selectedWorkflowId && (
          <button onClick={deleteWorkflow} className="bg-red-50 text-red-600 px-4 py-2 rounded-md hover:bg-red-100 font-bold transition-colors">
            Delete Flow
          </button>
        )}
      </div>

      {/* Builder Tools */}
      <div className="flex gap-4 mb-4">
        <input 
          type="text" 
          placeholder="Workflow Name" 
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          className="flex-grow px-3 py-2 border border-gray-300 rounded-md"
        />
        <button onClick={addNode} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium shadow-sm">
          Add Step
        </button>
        <button onClick={saveWorkflow} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 font-medium shadow-sm">
          {selectedWorkflowId ? 'Update Workflow' : 'Save New Workflow'}
        </button>
      </div>

      {/* Canvas */}
      <div className="h-[500px] border-2 border-dashed border-gray-300 rounded-md bg-gray-50 relative overflow-hidden">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes}>
          <Background color="#ccc" gap={16} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
};

export default WorkflowBuilder;