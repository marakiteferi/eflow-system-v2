import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  addEdge, applyNodeChanges, applyEdgeChanges, Background, Controls, MiniMap,
  Handle, Position, MarkerType, ReactFlowProvider, useReactFlow
} from 'reactflow';
import 'reactflow/dist/style.css';
import api from '../api';

// ==========================================
// 1. NODE DEFINITIONS (COMPACT CARDS)
// ==========================================

// Base Node Wrapper for consistent styling
const BaseNode = ({ id, typeName, icon, bgColor, borderColor, textColor, title, badge, selected }) => (
  <div className={`rounded-md shadow-sm border-2 ${selected ? 'border-blue-600 shadow-md ring-2 ring-blue-300' : borderColor} bg-white flex overflow-hidden w-[180px]`}>
    {/* Colored left strip */}
    <div className={`w-2 ${bgColor}`}></div>
    <div className="flex-1 p-2 bg-white flex flex-col justify-center">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{icon}</span>
        <span className={`text-[10px] uppercase font-bold tracking-wider ${textColor}`}>{typeName}</span>
      </div>
      <div className="text-xs font-bold text-gray-800 truncate">{title || 'Untitled Node'}</div>
      {badge && (
        <div className="mt-1.5 bg-gray-100 text-[9px] text-gray-600 px-1.5 py-0.5 rounded uppercase font-bold truncate">
          {badge}
        </div>
      )}
    </div>
  </div>
);

// 1. Task (Approval) Node
const TaskNode = ({ id, data, selected }) => {
  let badgeText = '⚠️ Unassigned';

  if (data.assignmentStrategy === 'role_based') {
    const roleName = data.rolesList?.find(r => r.id === parseInt(data.roleId))?.name || 'Role';
    if (data.routingType === 'ANY') badgeText = `👥 Any ${roleName}`;
    else if (data.routingType === 'INITIATOR_DEPT') badgeText = `🏢 Dept ${roleName}`;
    else if (data.routingType === 'SPECIFIC') {
      const deptName = data.departments?.find(d => d.id === parseInt(data.targetDepartmentId))?.name || 'Dept';
      badgeText = `🏢 ${deptName} ${roleName}`;
    }
  } else if (data.assignee) {
    badgeText = `👤 ${data.staffList?.find(s => s.id === parseInt(data.assignee))?.name || 'User'}`;
  }

  return (
    <>
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-blue-500" />
      <BaseNode id={id} typeName="Approval" icon="🟦" bgColor="bg-blue-500" borderColor="border-blue-200" textColor="text-blue-600" title={data.label} badge={badgeText} selected={selected} />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-blue-500" />
    </>
  );
};

// 2. Condition Node (If/Else)
const ConditionNode = ({ id, data, selected }) => (
  <>
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-amber-500" />
    <BaseNode id={id} typeName="Condition" icon="🔀" bgColor="bg-amber-500" borderColor="border-amber-200" textColor="text-amber-600" title={data.label || 'If/Else'} badge={data.conditionValue ? `Tags: ${data.conditionValue}` : 'No tags set'} selected={selected} />
    <Handle type="source" position={Position.Bottom} id="true" style={{ left: '25%', background: '#22c55e', width: '10px', height: '10px' }} />
    <div className="absolute -bottom-4 left-[15%] text-[9px] font-bold text-green-600">TRUE</div>
    <Handle type="source" position={Position.Bottom} id="false" style={{ left: '75%', background: '#ef4444', width: '10px', height: '10px' }} />
    <div className="absolute -bottom-4 left-[65%] text-[9px] font-bold text-red-600">FALSE</div>
  </>
);

// 3. Email Notification Node
const EmailNode = ({ id, data, selected }) => (
  <>
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-green-500" />
    <BaseNode id={id} typeName="Email" icon="📧" bgColor="bg-green-500" borderColor="border-green-200" textColor="text-green-600" title={data.label || 'Send Email'} badge={data.recipient ? `To: ${data.recipient}` : 'No recipient'} selected={selected} />
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-green-500" />
  </>
);

// 4. Delay / Timer Node
const DelayNode = ({ id, data, selected }) => (
  <>
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-purple-500" />
    <BaseNode id={id} typeName="Delay" icon="⏳" bgColor="bg-purple-500" borderColor="border-purple-200" textColor="text-purple-600" title={data.label || 'Wait'} badge={data.delayHours ? `⏳ ${data.delayHours} hrs` : 'No delay set'} selected={selected} />
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-purple-500" />
  </>
);

// 5. Parallel Split Node
const ParallelNode = ({ id, data, selected }) => (
  <>
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-orange-500" />
    <BaseNode id={id} typeName="Parallel" icon="⑂" bgColor="bg-orange-500" borderColor="border-orange-200" textColor="text-orange-600" title={data.label || 'Split Paths'} badge="Run concurrently" selected={selected} />
    {/* Multiple outgoing standard handles (could be custom, but basic allows many connections) */}
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-orange-500" />
  </>
);


// 6. Spawn Node
const SpawnNode = ({ id, data, selected }) => (
  <>
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-pink-500" />
    <BaseNode id={id} typeName="Spawn" icon="🚀" bgColor="bg-pink-500" borderColor="border-pink-200" textColor="text-pink-600" title={data.label || 'Spawn Workflows'} badge={data.spawnIds ? `${data.spawnIds.split(',').length} Flows` : 'Unconfigured'} selected={selected} />
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-pink-500" />
  </>
);

// ==========================================
// 2b. EMAIL PROPERTIES SUB-COMPONENT
// ==========================================
const EMAIL_VARS = ['{{submitter_email}}', '{{submitter_name}}', '{{document_title}}'];

const EmailProperties = ({ data, onChange }) => {
  const recipientRef = useRef(null);
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const [activeField, setActiveField] = useState(null);
  const [activeRef, setActiveRef] = useState(null);

  const insertVariable = (varText) => {
    const field = activeField || 'body';
    const ref = activeRef || bodyRef;
    const el = ref.current;
    if (!el) {
      onChange(field, (data[field] || '') + varText);
      return;
    }
    const start = el.selectionStart ?? (data[field] || '').length;
    const end = el.selectionEnd ?? start;
    const current = data[field] || '';
    onChange(field, current.slice(0, start) + varText + current.slice(end));
    requestAnimationFrame(() => {
      if (el) {
        el.selectionStart = start + varText.length;
        el.selectionEnd = start + varText.length;
        el.focus();
      }
    });
  };

  return (
    <>
      <div className="bg-green-50 border border-green-200 rounded p-2">
        <p className="text-[10px] font-bold text-green-800 mb-1.5">⚡ Click to Insert Variable</p>
        <div className="flex flex-wrap gap-1">
          {EMAIL_VARS.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariable(v)}
              className="text-[10px] bg-green-100 hover:bg-green-200 active:bg-green-300 text-green-800 border border-green-300 px-1.5 py-0.5 rounded font-mono cursor-pointer transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-[9px] text-green-600 mt-1">Click a field first, then click a variable to insert it at your cursor.</p>
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-700 mb-1">Recipient Address</label>
        <input
          ref={recipientRef}
          type="text" value={data.recipient || ''}
          onChange={e => onChange('recipient', e.target.value)}
          onFocus={() => { setActiveField('recipient'); setActiveRef(recipientRef); }}
          className="w-full text-sm border rounded p-2"
          placeholder="{{submitter_email}} or user@domain.com"
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-700 mb-1">Subject</label>
        <input
          ref={subjectRef}
          type="text" value={data.subject || ''}
          onChange={e => onChange('subject', e.target.value)}
          onFocus={() => { setActiveField('subject'); setActiveRef(subjectRef); }}
          className="w-full text-sm border rounded p-2"
          placeholder="Update on document"
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-700 mb-1">Body Template</label>
        <textarea
          ref={bodyRef}
          value={data.body || ''}
          onChange={e => onChange('body', e.target.value)}
          onFocus={() => { setActiveField('body'); setActiveRef(bodyRef); }}
          className="w-full text-sm border rounded p-2 h-28"
          placeholder="Dear {{submitter_name}}, your application for '{{document_title}}' has been reviewed..."
        />
      </div>
    </>
  );
};

// ==========================================
// 2. RIGHT INSPECTOR PANEL
// ==========================================
const PropertyInspector = ({ selectedNode, updateNodeData, closePanel, staffList = [], rolesList = [], departments = [], savedWorkflows = [], selectedWorkflowId = '' }) => {
  // Hooks MUST be called before any early returns (React rules of hooks)
  const [newCheckItem, setNewCheckItem] = useState('');

  if (!selectedNode) return null;

  const data = selectedNode.data;
  const onChange = (field, value) => updateNodeData(selectedNode.id, field, value);

  const addChecklistItem = () => {
    if (newCheckItem.trim()) {
      onChange('checklist', [...(data.checklist || []), newCheckItem.trim()]);
      setNewCheckItem('');
    }
  };
  const removeChecklistItem = (idx) => {
    onChange('checklist', (data.checklist || []).filter((_, i) => i !== idx));
  };

  return (
    <div className="w-72 bg-white border-l border-gray-200 shadow-xl h-full flex flex-col fixed right-0 top-0 z-50 pt-16">
      <div className="flex justify-between items-center px-4 py-3 border-b bg-gray-50">
        <h3 className="font-bold text-gray-800 text-sm">Node Properties</h3>
        <button onClick={closePanel} className="text-gray-400 hover:text-gray-700 font-bold">&times;</button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-5">

        {/* Common: Label */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">Node Name</label>
          <input
            type="text" value={data.label || ''} onChange={(e) => onChange('label', e.target.value)}
            className="w-full text-sm border-gray-300 rounded p-2 focus:ring-blue-500 focus:border-blue-500 border bg-white"
          />
        </div>

        {/* 1. TASK PROPERTIES */}
        {selectedNode.type === 'task' && (
          <>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Who Should Complete This Step?</label>
              <select
                value={data.assignmentStrategy || 'specific_user'}
                onChange={(e) => {
                  onChange('assignmentStrategy', e.target.value);
                  if (e.target.value === 'specific_user') {
                    onChange('roleId', null);
                    onChange('routingType', null);
                    onChange('targetDepartmentId', null);
                  } else {
                    onChange('assignee', null);
                    onChange('routingType', 'ANY');
                  }
                }}
                className="w-full text-sm border-gray-300 rounded p-2 border bg-white mb-3"
              >
                <option value="specific_user">A Specific Person</option>
                <option value="role_based">By Role & Department</option>
              </select>

              {(data.assignmentStrategy === 'specific_user' || !data.assignmentStrategy) ? (
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Select Person</label>
                  <select
                    value={data.assignee || ''} onChange={(e) => onChange('assignee', e.target.value)}
                    className="w-full text-sm border-gray-300 rounded p-2 border bg-white mb-2"
                  >
                    <option value="">-- Any System User --</option>
                    {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-100 p-3 rounded-md mb-2">
                  <div className="mb-3">
                    <label className="block text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1">Select Role</label>
                    <select
                      value={data.roleId || ''} onChange={(e) => onChange('roleId', e.target.value)}
                      className="w-full text-sm border-blue-200 rounded p-1.5 focus:ring-blue-500 border bg-white"
                    >
                      <option value="">-- Select Role (e.g. Head of Dept) --</option>
                      {rolesList.filter(r => r.is_active || r.id <= 3).map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>

                  {data.roleId && (
                    <div className="mb-3">
                      <label className="block text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1">Department Routing</label>
                      <select
                        value={data.routingType || 'ANY'} onChange={(e) => onChange('routingType', e.target.value)}
                        className="w-full text-sm border-blue-200 rounded p-1.5 focus:ring-blue-500 border bg-white"
                      >
                        <option value="ANY">Any Department (Global)</option>
                        <option value="INITIATOR_DEPT">Applicant's Department</option>
                        <option value="SPECIFIC">A Specific Department</option>
                      </select>
                      {data.routingType === 'INITIATOR_DEPT' && (
                        <p className="text-[9px] text-blue-600 mt-1 leading-tight">Routes to a user holding this role in the submitter's department.</p>
                      )}
                    </div>
                  )}

                  {data.roleId && data.routingType === 'SPECIFIC' && (
                    <div>
                      <label className="block text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1">Select Specific Department</label>
                      <select
                        value={data.targetDepartmentId || ''} onChange={(e) => onChange('targetDepartmentId', e.target.value)}
                        className="w-full text-sm border-blue-200 rounded p-1.5 focus:ring-blue-500 border bg-white"
                      >
                        <option value="">-- Select Department --</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-red-50 p-3 rounded border border-red-100">
              <label className="block text-[10px] uppercase tracking-wider font-bold text-red-800 mb-2 border-b border-red-200 pb-1">SLA Timers (Hours)</label>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-red-900">Reminder</span>
                  <input type="number" value={data.reminderHours || ''} onChange={e => onChange('reminderHours', e.target.value)} className="w-16 text-xs p-1 border rounded" />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-amber-900">Warning</span>
                  <input type="number" value={data.warningHours || ''} onChange={e => onChange('warningHours', e.target.value)} className="w-16 text-xs p-1 border rounded" />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-red-700">Breach</span>
                  <input type="number" value={data.escalationHours || ''} onChange={e => onChange('escalationHours', e.target.value)} className="w-16 text-xs p-1 border border-red-400 rounded" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Checklist Items</label>
              <ul className="mb-2 space-y-1">
                {(data.checklist || []).map((item, idx) => (
                  <li key={idx} className="flex justify-between text-xs bg-gray-50 p-1.5 rounded border border-gray-200">
                    <span className="truncate">{item}</span>
                    <button onClick={() => removeChecklistItem(idx)} className="text-red-500 hover:text-red-700 font-bold px-1">&times;</button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-1">
                <input type="text" value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addChecklistItem()} className="flex-1 text-xs border rounded p-1.5" placeholder="Add mandatory step..." />
                <button onClick={addChecklistItem} className="bg-blue-600 text-white px-2 rounded text-xs">+</button>
              </div>
            </div>

            <div className="bg-indigo-50 p-3 rounded border border-indigo-200">
              <label className="block text-[10px] uppercase tracking-wider font-bold text-indigo-800 mb-1">Allowed Tags</label>
              <input
                type="text"
                value={data.allowedTags || ''}
                onChange={(e) => onChange('allowedTags', e.target.value)}
                className="w-full text-xs border-indigo-200 bg-white rounded p-1.5 focus:ring-indigo-400 border"
                placeholder="e.g. accepted, rejected"
              />
              <p className="text-[10px] text-indigo-600 mt-1">Comma-separated. Staff will see these as a dropdown when tagging this document.</p>
            </div>
          </>
        )}

        {/* 2. CONDITION PROPERTIES */}
        {selectedNode.type === 'condition' && (
          <div>
            <label className="block text-xs font-bold text-amber-800 mb-1">If Tag Equals</label>
            <input
              type="text" value={data.conditionValue || ''} onChange={(e) => onChange('conditionValue', e.target.value)}
              className="w-full text-sm border-amber-300 bg-amber-50 rounded p-2 focus:ring-amber-500 focus:border-amber-500 border" placeholder="e.g. Finance"
            />
            <p className="text-[10px] text-gray-500 mt-1">Routes to TRUE if it matches perfectly, otherwise FALSE.</p>
          </div>
        )}

        {/* 3. EMAIL PROPERTIES */}
        {selectedNode.type === 'email' && (
          <EmailProperties data={data} onChange={onChange} />
        )}

        {/* 4. DELAY PROPERTIES */}
        {selectedNode.type === 'delay' && (
          <div>
            <label className="block text-xs font-bold text-purple-800 mb-1">Delay Duration (Hours)</label>
            <input type="number" min="0" value={data.delayHours || ''} onChange={e => onChange('delayHours', e.target.value)} className="w-full text-sm border-purple-300 bg-purple-50 rounded p-2 focus:ring-purple-500 border" placeholder="e.g. 48" />
            <p className="text-[10px] text-gray-500 mt-1">Flow auto-resumes after this interval.</p>
          </div>
        )}

        {/* 5. PARALLEL PROPERTIES */}
        {selectedNode.type === 'parallel' && (
          <div className="bg-orange-50 p-3 rounded border border-orange-200 text-xs text-orange-800">
            Connect multiple outputs to this node. The document will route to all connected paths simultaneously.
          </div>
        )}

        {/* 6. SPAWN PROPERTIES */}
        {selectedNode.type === 'spawn' && (
          <div>
            <label className="block text-xs font-bold text-pink-800 mb-1">Workflows to Spawn</label>
            <div className="max-h-32 overflow-y-auto border border-pink-200 rounded text-sm bg-white p-1">
              {savedWorkflows.filter(w => w.id !== parseInt(selectedWorkflowId || 0)).map(wf => {
                const isSelected = (data.spawnIds || '').split(',').includes(wf.id.toString());
                return (
                  <label key={wf.id} className="flex items-center gap-2 p-1.5 hover:bg-pink-50 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={isSelected}
                      onChange={(e) => {
                        let ids = (data.spawnIds || '').split(',').filter(Boolean);
                        if (e.target.checked) ids.push(wf.id.toString());
                        else ids = ids.filter(id => id !== wf.id.toString());
                        onChange('spawnIds', ids.join(','));
                      }}
                      className="text-pink-600 focus:ring-pink-500 rounded"
                    />
                    <span className="truncate text-xs text-gray-700" title={wf.name}>{wf.name}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-500 mt-1">Spawns new detached document workflows automatically.</p>
          </div>
        )}

      </div>
    </div>
  );
};


// ==========================================
// 3. LEFT PALETTE SIDEBAR
// ==========================================
const Sidebar = () => {
  const onDragStart = (event, nodeType, defaultLabel) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/reactflow-label', defaultLabel);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-56 bg-gray-50 border-r border-gray-200 h-full flex flex-col pt-1">
      <div className="p-3 border-b border-gray-200 font-bold text-xs uppercase tracking-wider text-gray-500">Node Palette</div>
      <div className="p-3 space-y-3 overflow-y-auto">
        <div className="text-[10px] font-bold text-gray-400 uppercase">Interactive</div>
        <div className="bg-white border hover:border-blue-400 p-2 text-xs rounded cursor-grab flex items-center gap-2 shadow-sm" onDragStart={(e) => onDragStart(e, 'task', 'Approval Step')} draggable>
          <span className="text-blue-500">🟦</span> Approval Step
        </div>

        <div className="text-[10px] font-bold text-gray-400 uppercase mt-4">Logic</div>
        <div className="bg-white border hover:border-amber-400 p-2 text-xs rounded cursor-grab flex items-center gap-2 shadow-sm" onDragStart={(e) => onDragStart(e, 'condition', 'If Tag Match')} draggable>
          <span className="text-amber-500">🔀</span> Condition (If/Else)
        </div>
        <div className="bg-white border hover:border-orange-400 p-2 text-xs rounded cursor-grab flex items-center gap-2 shadow-sm" onDragStart={(e) => onDragStart(e, 'parallel', 'Parallel Split')} draggable>
          <span className="text-orange-500">⑂</span> Parallel Split
        </div>

        <div className="text-[10px] font-bold text-gray-400 uppercase mt-4">Automation</div>
        <div className="bg-white border hover:border-green-400 p-2 text-xs rounded cursor-grab flex items-center gap-2 shadow-sm" onDragStart={(e) => onDragStart(e, 'email', 'Send Email')} draggable>
          <span className="text-green-500">📧</span> Email Notify
        </div>
        <div className="bg-white border hover:border-purple-400 p-2 text-xs rounded cursor-grab flex items-center gap-2 shadow-sm" onDragStart={(e) => onDragStart(e, 'delay', 'Wait Timer')} draggable>
          <span className="text-purple-500">⏳</span> Delay Timer
        </div>
        <div className="bg-white border hover:border-pink-400 p-2 text-xs rounded cursor-grab flex items-center gap-2 shadow-sm" onDragStart={(e) => onDragStart(e, 'spawn', 'Spawn Flows')} draggable>
          <span className="text-pink-500">🚀</span> Spawn Flows
        </div>
      </div>
      <div className="p-3 mt-auto border-t border-gray-200 text-[10px] text-gray-400">
        Drag nodes onto the canvas. Press <kbd className="bg-gray-200 px-1 py-0.5 rounded text-gray-600">Del</kbd> to remove.
      </div>
    </div>
  );
};


// ==========================================
// 4. MAIN BUILDER COMPONENT (INTERNAL)
// ==========================================
const WorkflowBuilderInner = () => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [workflowName, setWorkflowName] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');

  const [savedWorkflows, setSavedWorkflows] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [allowedSubmitters, setAllowedSubmitters] = useState([]);
  const [prerequisiteWorkflowId, setPrerequisiteWorkflowId] = useState('');
  const [clearanceWorkflowIds, setClearanceWorkflowIds] = useState('');

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [panelForceClosed, setPanelForceClosed] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const builderContainerRef = useRef(null);

  const reactFlowWrapper = useRef(null);
  const { project } = useReactFlow();

  const nodeTypes = useMemo(() => ({
    task: TaskNode,
    condition: ConditionNode,
    email: EmailNode,
    delay: DelayNode,
    parallel: ParallelNode,
    spawn: SpawnNode
  }), []);

  // Fetch init data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [wfRes, staffRes, rolesRes, deptRes] = await Promise.all([
          api.get('/workflows'),
          api.get('/admin/users'),
          api.get('/admin/roles'),
          api.get('/admin/departments')
        ]);
        setSavedWorkflows(wfRes.data);
        setStaffList(staffRes.data.filter(u => u.role_id === 2 || u.role_name === 'Staff' || u.role_id > 3));
        setRolesList(rolesRes.data);
        setDepartments(deptRes.data || []);
      } catch (err) { console.error('Failed to load builder data', err); }
    };
    fetchData();
  }, []);

  // React Flow Handlers
  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);

  const onConnect = useCallback((params) => {
    let edgeStyle = { stroke: '#64748b', strokeWidth: 2 };
    let animated = true;

    // Custom styling for logic outputs
    if (params.sourceHandle === 'true') { edgeStyle.stroke = '#22c55e'; }
    if (params.sourceHandle === 'false') { edgeStyle.stroke = '#ef4444'; }

    const newEdge = {
      ...params,
      type: 'smoothstep',
      style: edgeStyle,
      animated,
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeStyle.stroke }
    };
    setEdges((eds) => addEdge(newEdge, eds));
  }, []);

  // Selection
  const onSelectionChange = ({ nodes }) => {
    if (nodes.length > 0) {
      // A new node was explicitly clicked — always show the panel
      setSelectedNodeId(nodes[0].id);
      setPanelForceClosed(false);
    } else {
      setSelectedNodeId(null);
    }
  };

  // Property Update Handler
  const updateNodeData = useCallback((id, field, value) => {
    setNodes(nds => nds.map(n => {
      if (n.id === id) {
        return { ...n, data: { ...n.data, [field]: value } };
      }
      return n;
    }));
  }, []);

  // Ensure staffList is available in node data (for the badges in TaskNode)
  // Ensure context lists are available in node data (for the badges in TaskNode)
  useEffect(() => {
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, staffList, rolesList, departments } })));
  }, [staffList, rolesList, departments]);

  // Drag and Drop Handlers
  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();

    const type = event.dataTransfer.getData('application/reactflow');
    const label = event.dataTransfer.getData('application/reactflow-label');

    if (typeof type === 'undefined' || !type) return;

    const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = project({
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top,
    });

    const newNode = {
      id: `${type}_${Date.now()}`,
      type,
      position,
      data: { label, staffList, rolesList, departments },
    };

    setNodes((nds) => nds.concat(newNode));
    setSelectedNodeId(newNode.id); // Auto-select on drop
  }, [project, staffList, rolesList, departments]);


  // Load/Save
  const handleLoadWorkflow = (e) => {
    const wfId = e.target.value;
    setSelectedWorkflowId(wfId);
    setSelectedNodeId(null);
    if (!wfId) { setNodes([]); setEdges([]); setWorkflowName(''); setAllowedSubmitters([]); return; }

    const wf = savedWorkflows.find(w => w.id === parseInt(wfId));
    if (wf) {
      setWorkflowName(wf.name);
      const flowData = typeof wf.flow_structure === 'string' ? JSON.parse(wf.flow_structure) : wf.flow_structure;

      const loadedNodes = (flowData.nodes || []).map(node => ({
        ...node,
        data: { ...node.data, staffList, rolesList, departments }
      }));
      setNodes(loadedNodes); setEdges(flowData.edges || []);
      setAllowedSubmitters(flowData.metadata?.allowedSubmitters || []);
      setPrerequisiteWorkflowId(flowData.metadata?.prerequisiteWorkflowId || '');
      setClearanceWorkflowIds(flowData.metadata?.clearanceWorkflowIds?.join(',') || '');
    }
  };

  const [isValidating, setIsValidating] = useState(false);
  const validateAndSave = async () => {
    if (!workflowName) return alert('Enter a workflow name');

    // Validation
    const errors = [];
    nodes.forEach(n => {
      if (n.type === 'task' && !n.data.assignee) errors.push(`Approval node "${n.data.label}" has no assignee.`);
      if (n.type === 'email' && !n.data.recipient) errors.push(`Email node "${n.data.label}" has no recipient.`);
    });
    // Check for orphaned nodes
    const connectedNodeIds = new Set();
    edges.forEach(e => { connectedNodeIds.add(e.source); connectedNodeIds.add(e.target); });
    if (nodes.length > 1) { // Single node is an exception
      nodes.forEach(n => {
        if (!connectedNodeIds.has(n.id)) errors.push(`Node "${n.data.label}" is disconnected.`);
      });
    }

    if (errors.length > 0) {
      if (!window.confirm("Validation Warnings:\n\n" + errors.join('\n') + "\n\nSave anyway?")) return;
    }

    setIsValidating(true);
    try {
      const cleanedNodes = nodes.map(n => {
        const cleanData = { ...n.data };
        delete cleanData.staffList; // strip large redundant arrays before saving
        return { ...n, data: cleanData };
      });
      const metadataObj = { allowedSubmitters, prerequisiteWorkflowId: prerequisiteWorkflowId || null };
      if (clearanceWorkflowIds) {
        metadataObj.clearanceWorkflowIds = clearanceWorkflowIds.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      }

      const flowData = JSON.stringify({
        nodes: cleanedNodes,
        edges,
        metadata: metadataObj
      });

      if (selectedWorkflowId) {
        await api.put(`/workflows/${selectedWorkflowId}`, { name: workflowName, flow_structure: flowData });
        alert('Workflow updated successfully!');
      } else {
        await api.post('/workflows', { name: workflowName, flow_structure: flowData });
        alert('New workflow created successfully!');
      }
      // Re-fetch list
      const wfRes = await api.get('/workflows');
      setSavedWorkflows(wfRes.data);
    } catch (err) {
      alert('Failed to save workflow');
    } finally {
      setIsValidating(false);
    }
  };

  const handleClear = () => {
    if (window.confirm('Clear canvas?')) {
      setNodes([]); setEdges([]); setSelectedNodeId(null); setAllowedSubmitters([]); setPrerequisiteWorkflowId(''); setClearanceWorkflowIds('');
    }
  }

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      if (builderContainerRef.current) {
        builderContainerRef.current.requestFullscreen().catch(err => {
          alert(`Error attempting to enable full-screen mode: ${err.message}`);
        });
      }
      setIsFullScreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullScreen(false);
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  const handleRoleToggle = (roleId) => {
    setAllowedSubmitters(prev =>
      prev.includes(roleId) ? prev.filter(r => r !== roleId) : [...prev, roleId]
    );
  };

  return (
    <div ref={builderContainerRef} className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-140px)] min-h-[700px] w-full">

      {/* TOP BAR */}
      <div className="flex px-4 py-3 border-b border-gray-200 bg-white items-center gap-4 z-10 shrink-0 flex-wrap">
        <select value={selectedWorkflowId} onChange={handleLoadWorkflow} className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48">
          <option value="">+ New Flow</option>
          {savedWorkflows.map(wf => <option key={wf.id} value={wf.id}>{wf.name}</option>)}
        </select>

        <div className="h-5 w-px bg-gray-300"></div>

        <input
          type="text" placeholder="Enter Workflow Name..." value={workflowName} onChange={(e) => setWorkflowName(e.target.value)}
          className="flex-grow max-w-[200px] px-3 py-1.5 border-none text-lg font-bold text-gray-800 placeholder-gray-400 focus:ring-0 outline-none"
        />

        <div className="h-5 w-px bg-gray-300 hidden sm:block"></div>

        <div className="flex items-center gap-2 relative group hidden sm:flex">
          <span className="text-xs font-bold text-gray-500">Allowed Roles:</span>
          <div className="relative cursor-pointer">
            <div className="px-3 py-1.5 border border-gray-300 rounded text-xs bg-white text-gray-700 font-medium hover:border-blue-400 transition-colors flex items-center gap-2">
              <span>{allowedSubmitters.length === 0 ? 'All Roles (Global)' : `${allowedSubmitters.length} Roles Selected`}</span>
              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </div>
            {/* Dropdown Menu */}
            <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 shadow-xl rounded-lg py-2 hidden group-hover:block z-50">
              <div className="px-3 pb-2 border-b border-gray-100 mb-1">
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Select Roles</p>
              </div>
              <div className="max-h-56 overflow-y-auto">
                <label className="flex items-center gap-3 px-3 py-1.5 hover:bg-blue-50 cursor-pointer transition-colors group/item">
                  <input type="checkbox" checked={allowedSubmitters.includes(1)} onChange={() => handleRoleToggle(1)} className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer" />
                  <span className={`text-sm ${allowedSubmitters.includes(1) ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>Student (Legacy)</span>
                </label>
                <label className="flex items-center gap-3 px-3 py-1.5 hover:bg-blue-50 cursor-pointer transition-colors group/item">
                  <input type="checkbox" checked={allowedSubmitters.includes(2)} onChange={() => handleRoleToggle(2)} className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer" />
                  <span className={`text-sm ${allowedSubmitters.includes(2) ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>Staff (Legacy)</span>
                </label>
                {rolesList.filter(r => r.is_active).map(role => (
                  <label key={role.id} className="flex items-center gap-3 px-3 py-1.5 hover:bg-blue-50 cursor-pointer transition-colors group/item">
                    <input type="checkbox" checked={allowedSubmitters.includes(role.id)} onChange={() => handleRoleToggle(role.id)} className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer" />
                    <span className={`text-sm ${allowedSubmitters.includes(role.id) ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>{role.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 relative group hidden sm:flex">
          <span className="text-xs font-bold text-gray-500">Prerequisite:</span>
          <select 
            value={prerequisiteWorkflowId} 
            onChange={(e) => setPrerequisiteWorkflowId(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded text-xs bg-white text-gray-700 hover:border-blue-400 focus:outline-none focus:border-blue-500 max-w-[150px]"
          >
            <option value="">None</option>
            {savedWorkflows.filter(w => w.id !== parseInt(selectedWorkflowId || 0)).map(wf => (
              <option key={wf.id} value={wf.id}>{wf.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 relative group hidden lg:flex">
          <span className="text-xs font-bold text-gray-500" title="Workflow IDs that must be approved before this document can be fully completely routed.">Clearances:</span>
          <div className="relative">
            <select 
              className="px-3 py-1.5 border border-gray-300 rounded text-xs bg-white text-gray-700 hover:border-blue-400 focus:outline-none focus:border-blue-500 max-w-[150px] appearance-none"
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                let ids = clearanceWorkflowIds ? clearanceWorkflowIds.split(',').filter(Boolean) : [];
                if (!ids.includes(val)) ids.push(val);
                setClearanceWorkflowIds(ids.join(','));
                e.target.value = "";
              }}
            >
              <option value="">+ Add Clearance</option>
              {savedWorkflows.filter(w => w.id !== parseInt(selectedWorkflowId || 0)).map(wf => (
                <option key={wf.id} value={wf.id}>{wf.name}</option>
              ))}
            </select>
          </div>
          {clearanceWorkflowIds && (
             <div className="flex gap-1 flex-wrap max-w-[200px]">
               {clearanceWorkflowIds.split(',').filter(Boolean).map(id => {
                  const wf = savedWorkflows.find(w => w.id === parseInt(id));
                  return (
                    <span key={id} className="bg-gray-100 border border-gray-200 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
                      <span className="truncate max-w-[80px]" title={wf?.name}>{wf?.name || `ID:${id}`}</span>
                      <button onClick={() => setClearanceWorkflowIds(clearanceWorkflowIds.split(',').filter(x => x !== id).join(','))} className="text-red-500 font-bold">&times;</button>
                    </span>
                  );
               })}
             </div>
          )}
        </div>

        <div className="flex-grow"></div>

        <button onClick={toggleFullScreen} className="text-gray-500 hover:text-blue-600 p-1.5 rounded bg-gray-50 border border-gray-200 mr-2" title="Toggle Full Screen">
          {isFullScreen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 11lm0 0l-4-4m4 4v-3m0 3H6m6-6l4-4m-4 4h3m-3 0v-3m0 9l4 4m-4-4v3m0-3h3M9 15l-4 4m4-4h-3m3 0v3" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
          )}
        </button>

        <button onClick={handleClear} className="text-gray-500 hover:text-red-500 font-medium text-sm px-3">Clear</button>
        <button onClick={validateAndSave} disabled={isValidating} className={`bg-indigo-600 text-white px-5 py-2 rounded font-bold shadow-sm transition-colors ${isValidating ? 'opacity-70' : 'hover:bg-indigo-700'}`}>
          {selectedWorkflowId ? 'Update Workflow' : 'Save Workflow'}
        </button>
      </div>

      {/* MAIN WORKSPACE AREA */}
      <div className="flex flex-1 relative overflow-hidden bg-slate-900">
        {/* Left Sidebar Palette */}
        <Sidebar onDragStart={() => { }} />

        {/* Canvas */}
        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            onDrop={onDrop}
            onDragOver={onDragOver}
            snapToGrid={true}
            snapGrid={[15, 15]}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background color="#334155" gap={24} size={2} />
            <Controls className="bg-white rounded border border-gray-300 shadow-sm" />
            <MiniMap nodeStrokeColor="#94a3b8" nodeColor="#f1f5f9" maskColor="rgba(15, 23, 42, 0.7)" className="rounded border-2 border-slate-700 bg-slate-800" />
          </ReactFlow>
        </div>

        {/* Right Inspector Panel */}
        {selectedNodeId && !panelForceClosed && (
          <PropertyInspector
            selectedNode={selectedNode}
            updateNodeData={updateNodeData}
            closePanel={() => { setSelectedNodeId(null); setPanelForceClosed(true); }}
            staffList={staffList}
            rolesList={rolesList}
            departments={departments}
            savedWorkflows={savedWorkflows}
            selectedWorkflowId={selectedWorkflowId}
          />
        )}
      </div>
    </div>
  );
};

// Wrap in provider
export default function WorkflowBuilder() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderInner />
    </ReactFlowProvider>
  );
}