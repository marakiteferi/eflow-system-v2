import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  addEdge, applyNodeChanges, applyEdgeChanges, Background, BackgroundVariant, Controls, MiniMap,
  Handle, Position, MarkerType, ReactFlowProvider, useReactFlow
} from 'reactflow';
import 'reactflow/dist/style.css';
import api from '../api';

// ==========================================
// 0. SHARED BITS: icons, step types, durations
// ==========================================

const ICON_PATHS = {
  task: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  condition: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
  email: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  delay: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  parallel: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2',
  join: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  spawn: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
  office: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  checklist: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  outcome: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  close: 'M6 18L18 6M6 6l12 12',
  back: 'M10 19l-7-7m0 0l7-7m-7 7h18',
  folder: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  plus: 'M12 4v16m8-8H4',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  expand: 'M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4',
  shrink: 'M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
};

const Icon = ({ name, className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={ICON_PATHS[name]} />
  </svg>
);

// Every step type with its colours (full class names so Tailwind keeps them) and a plain description
const STEP_TYPES = {
  task:      { name: 'Approval', label: 'Approval step', hint: 'An office or person reviews and signs', tile: 'bg-indigo-100 text-indigo-700', ring: 'ring-indigo-400', bar: 'bg-indigo-500', handle: '#6366f1' },
  condition: { name: 'Branch', label: 'Branch on outcome', hint: 'Route by the decision made earlier', tile: 'bg-amber-100 text-amber-700', ring: 'ring-amber-400', bar: 'bg-amber-500', handle: '#f59e0b' },
  parallel:  { name: 'Parallel', label: 'Parallel review', hint: 'Send to several offices at once', tile: 'bg-orange-100 text-orange-700', ring: 'ring-orange-400', bar: 'bg-orange-500', handle: '#f97316' },
  join:      { name: 'Merge', label: 'Wait for all', hint: 'Continue once every branch is done', tile: 'bg-teal-100 text-teal-700', ring: 'ring-teal-400', bar: 'bg-teal-500', handle: '#14b8a6' },
  email:     { name: 'Email', label: 'Send email', hint: 'Notify the applicant or anyone else', tile: 'bg-emerald-100 text-emerald-700', ring: 'ring-emerald-400', bar: 'bg-emerald-500', handle: '#10b981' },
  delay:     { name: 'Wait', label: 'Wait', hint: 'Pause for a set time, then continue', tile: 'bg-violet-100 text-violet-700', ring: 'ring-violet-400', bar: 'bg-violet-500', handle: '#8b5cf6' },
  spawn:     { name: 'Start services', label: 'Start other services', hint: 'Open follow-up requests automatically', tile: 'bg-pink-100 text-pink-700', ring: 'ring-pink-400', bar: 'bg-pink-500', handle: '#ec4899' },
};

const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);

const UNITS = [
  { id: 'weeks', hours: 168, one: 'week', many: 'weeks' },
  { id: 'days', hours: 24, one: 'day', many: 'days' },
  { id: 'hours', hours: 1, one: 'hour', many: 'hours' },
];
const bestUnit = (hours) => UNITS.find((u) => hours > 0 && hours % u.hours === 0) || UNITS[2];

/** "4 hours", "3 days", "1 week" (the engine stores every duration in hours) */
const formatDuration = (hours) => {
  const h = parseFloat(hours);
  if (!h || h <= 0) return '';
  const u = bestUnit(h);
  const n = h / u.hours;
  return `${n} ${n === 1 ? u.one : u.many}`;
};

// ==========================================
// 1. STEP CARDS ON THE CANVAS
// ==========================================

const Chip = ({ icon, children, tone = 'gray' }) => (
  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold max-w-full ${tone === 'warn' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
    {icon && <Icon name={icon} className="w-3 h-3 shrink-0" />}
    <span className="truncate">{children}</span>
  </span>
);

const StepCard = ({ type, title, subtitle, warn, chips, selected }) => {
  const t = STEP_TYPES[type];
  return (
    <div className={`w-[260px] rounded-xl bg-white border border-gray-200 shadow-sm transition-shadow ${selected ? `ring-2 ${t.ring} shadow-lg` : 'hover:shadow-md'}`}>
      <div className="flex items-start gap-2.5 p-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${t.tile}`}><Icon name={type} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t.name}</div>
          <div className="text-sm font-semibold text-gray-900 truncate">{title || t.label}</div>
          {subtitle && (
            <div className={`text-xs truncate mt-0.5 flex items-center gap-1 ${warn ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              {warn && <Icon name="warning" className="w-3 h-3 shrink-0" />}{subtitle}
            </div>
          )}
        </div>
      </div>
      {chips && chips.length > 0 && (
        <div className="px-3 pb-2.5 -mt-1 flex flex-wrap gap-1">{chips}</div>
      )}
    </div>
  );
};

const handleStyle = (type) => ({ background: STEP_TYPES[type].handle, width: 10, height: 10, border: '2px solid white' });

/** Who an approval step goes to, in words, plus whether it still needs setting up */
const describeAssignee = (data) => {
  if (data.assignmentStrategy === 'office') {
    const office = data.officesList?.find((o) => o.id === parseInt(data.officeId));
    if (!office) return { text: 'Choose an office', warn: true };
    if (data.officePosition === 'head') return { text: `${office.name} · Head` };
    if (data.officePosition === 'position') {
      const pos = office.positions?.find((p) => p.id === parseInt(data.positionId));
      return pos ? { text: `${office.name} · ${pos.name}` } : { text: 'Choose a position', warn: true };
    }
    return { text: `${office.name} · Any officer` };
  }
  if (data.assignmentStrategy === 'role_based' && data.roleId) {
    const roleName = data.rolesList?.find((r) => r.id === parseInt(data.roleId))?.name || 'Role';
    if (data.routingType === 'INITIATOR_DEPT') return { text: `Applicant's department · ${roleName}` };
    if (data.routingType === 'SPECIFIC') {
      const deptName = data.departments?.find((d) => d.id === parseInt(data.targetDepartmentId))?.name || 'Department';
      return { text: `${deptName} · ${roleName}` };
    }
    return { text: `Any ${roleName}` };
  }
  if (data.assignee) return { text: data.staffList?.find((s) => s.id === parseInt(data.assignee))?.name || 'A person' };
  return { text: 'Choose who reviews', warn: true };
};

const TaskNode = ({ data, selected }) => {
  const who = describeAssignee(data);
  const deadline = formatDuration(data.escalationHours || data.slaHours);
  const checks = listOf(data.checklist).length;
  const outcomes = listOf(data.allowedTags);
  const chips = [
    deadline && <Chip key="d" icon="delay">{deadline}{data.workingDaysOnly ? ' (working)' : ''}</Chip>,
    checks > 0 && <Chip key="c" icon="checklist">{checks} check{checks > 1 ? 's' : ''}</Chip>,
    outcomes.length > 0 && <Chip key="o" icon="outcome">{outcomes.join(' / ')}</Chip>,
  ].filter(Boolean);
  return (
    <>
      <Handle type="target" position={Position.Top} style={handleStyle('task')} />
      <StepCard type="task" title={data.label} subtitle={who.text} warn={who.warn} chips={chips} selected={selected} />
      <Handle type="source" position={Position.Bottom} style={handleStyle('task')} />
    </>
  );
};

const ConditionNode = ({ data, selected }) => {
  const values = listOf(data.conditionValue);
  return (
    <>
      <Handle type="target" position={Position.Top} style={handleStyle('condition')} />
      <StepCard type="condition" title={data.label} selected={selected}
        subtitle={values.length ? `Outcome is ${values.join(' or ')}` : 'Choose the outcome to match'} warn={!values.length} />
      <Handle type="source" position={Position.Bottom} id="true" style={{ ...handleStyle('condition'), left: '28%', background: '#16a34a' }} />
      <div className="absolute -bottom-5 left-[28%] -translate-x-1/2 text-[10px] font-bold text-green-700">Yes</div>
      <Handle type="source" position={Position.Bottom} id="false" style={{ ...handleStyle('condition'), left: '72%', background: '#9ca3af' }} />
      <div className="absolute -bottom-5 left-[72%] -translate-x-1/2 text-[10px] font-bold text-gray-500">No</div>
    </>
  );
};

const simpleNode = (type, describe) => ({ data, selected }) => {
  const { text, warn } = describe(data);
  return (
    <>
      <Handle type="target" position={Position.Top} style={handleStyle(type)} />
      <StepCard type={type} title={data.label} subtitle={text} warn={warn} selected={selected} />
      <Handle type="source" position={Position.Bottom} style={handleStyle(type)} />
    </>
  );
};

const EmailNode = simpleNode('email', (d) => (d.recipient ? { text: `To ${d.recipient}` } : { text: 'Add a recipient', warn: true }));
const DelayNode = simpleNode('delay', (d) => (parseFloat(d.delayHours) > 0 ? { text: `For ${formatDuration(d.delayHours)}` } : { text: 'Set how long to wait', warn: true }));
const ParallelNode = simpleNode('parallel', () => ({ text: 'All connected steps start together' }));
const JoinNode = simpleNode('join', () => ({ text: 'Continues when every branch is done' }));
const SpawnNode = simpleNode('spawn', (d) => {
  const n = listOf(d.spawnIds).length;
  return n ? { text: `${n} service${n > 1 ? 's' : ''}` } : { text: 'Choose services', warn: true };
});

// ==========================================
// 2. SETTINGS PANEL BUILDING BLOCKS
// ==========================================

const fieldClass = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500';

const Section = ({ icon, title, summary, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-gray-100 last:border-b-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-5 py-3.5 text-left hover:bg-gray-50">
        {icon && <Icon name={icon} className="w-4 h-4 text-gray-400" />}
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        {!open && summary && <span className="ml-auto text-xs text-gray-500 truncate max-w-[55%]">{summary}</span>}
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${!open && summary ? '' : 'ml-auto'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && <div className="px-5 pb-5 space-y-4">{children}</div>}
    </section>
  );
};

const Label = ({ children, hint }) => (
  <div className="mb-1.5">
    <div className="text-xs font-semibold text-gray-700">{children}</div>
    {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
  </div>
);

const Toggle = ({ checked, onChange, label, description }) => (
  <label className="flex items-start justify-between gap-3 cursor-pointer">
    <span>
      <span className="block text-sm text-gray-800">{label}</span>
      {description && <span className="block text-xs text-gray-500 mt-0.5">{description}</span>}
    </span>
    <span className="relative shrink-0 mt-0.5">
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="block w-9 h-5 rounded-full bg-gray-300 peer-checked:bg-indigo-600 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-300" />
      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
    </span>
  </label>
);

/** A duration typed as a number and a unit; the value is kept in hours */
const DurationInput = ({ hours, onChange, ariaLabel, allowEmpty = true }) => {
  const h = parseFloat(hours) || 0;
  const [unit, setUnit] = useState(bestUnit(h).id);
  const u = UNITS.find((x) => x.id === unit);
  const amount = h ? +(h / u.hours).toFixed(2) : '';
  return (
    <div className="flex gap-2">
      <input type="number" min="0" step="any" aria-label={ariaLabel} value={amount}
        placeholder={allowEmpty ? 'Off' : '0'}
        onChange={(e) => { const n = Math.max(0, parseFloat(e.target.value) || 0); onChange(n ? +(n * u.hours).toFixed(4) : ''); }}
        className={`${fieldClass.replace('w-full', 'w-24')} shrink-0`} />
      <select value={unit} aria-label={`${ariaLabel} unit`}
        onChange={(e) => { const next = UNITS.find((x) => x.id === e.target.value); setUnit(next.id); if (h) onChange(+((h / u.hours) * next.hours).toFixed(4)); }}
        className={`${fieldClass.replace('w-full', 'min-w-0')} flex-1`}>
        {UNITS.slice().reverse().map((x) => <option key={x.id} value={x.id}>{x.many}</option>)}
      </select>
    </div>
  );
};

/** Values as removable chips, with suggestions to add in one click and free typing (Enter or comma adds) */
const ChipsInput = ({ values, onChange, placeholder, suggestions = [], tone = 'indigo' }) => {
  const [text, setText] = useState('');
  const has = (v) => values.some((x) => x.toLowerCase() === v.toLowerCase());
  const add = (v) => {
    const clean = v.trim().replace(/,/g, '');
    if (clean && !has(clean)) onChange([...values, clean]);
    setText('');
  };
  const chipTone = tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800';
  const open = suggestions.filter((s) => !has(s));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 p-2 border border-gray-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-indigo-200 focus-within:border-indigo-500">
        {values.map((v) => (
          <span key={v} className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs font-semibold ${chipTone}`}>
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="opacity-60 hover:opacity-100 p-0.5">
              <Icon name="close" className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
            if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => text && add(text)}
          placeholder={values.length ? '' : placeholder}
          className="flex-1 min-w-[90px] text-sm outline-none bg-transparent py-0.5" />
      </div>
      {open.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {open.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              className="px-2 py-0.5 rounded-md text-xs font-medium border border-dashed border-gray-300 text-gray-600 hover:border-indigo-400 hover:text-indigo-700">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ==========================================
// 2b. EMAIL SETTINGS
// ==========================================
const EMAIL_VARS = [
  { token: '{{submitter_name}}', label: 'Applicant name' },
  { token: '{{submitter_email}}', label: 'Applicant email' },
  { token: '{{document_title}}', label: 'Document title' },
];

const EmailProperties = ({ data, onChange }) => {
  const refs = { recipient: useRef(null), subject: useRef(null), body: useRef(null) };
  const [activeField, setActiveField] = useState('body');

  const insertVariable = (varText) => {
    const field = activeField;
    const el = refs[field].current;
    const current = data[field] || '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? start;
    onChange(field, current.slice(0, start) + varText + current.slice(end));
    requestAnimationFrame(() => {
      if (el) { el.selectionStart = el.selectionEnd = start + varText.length; el.focus(); }
    });
  };

  return (
    <>
      <div>
        <Label hint="Use the applicant's address, or type any email.">To</Label>
        <input ref={refs.recipient} type="text" value={data.recipient || ''}
          onChange={(e) => onChange('recipient', e.target.value)} onFocus={() => setActiveField('recipient')}
          className={fieldClass} placeholder="{{submitter_email}}" />
      </div>
      <div>
        <Label>Subject</Label>
        <input ref={refs.subject} type="text" value={data.subject || ''}
          onChange={(e) => onChange('subject', e.target.value)} onFocus={() => setActiveField('subject')}
          className={fieldClass} placeholder="Update on your request" />
      </div>
      <div>
        <Label>Message</Label>
        <textarea ref={refs.body} value={data.body || ''}
          onChange={(e) => onChange('body', e.target.value)} onFocus={() => setActiveField('body')}
          className={`${fieldClass} h-28`} placeholder="Dear {{submitter_name}}, your request '{{document_title}}' has been reviewed..." />
      </div>
      <div>
        <Label hint="Inserted where your cursor is.">Insert a detail</Label>
        <div className="flex flex-wrap gap-1.5">
          {EMAIL_VARS.map((v) => (
            <button key={v.token} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVariable(v.token)}
              className="px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100">
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

// ==========================================
// 2c. RIGHT SETTINGS PANEL
// ==========================================
const DEADLINE_PRESETS = [4, 24, 72, 168];

const PropertyInspector = ({ selectedNode, allNodes = [], updateNodeData, closePanel, deleteNode, staffList = [], rolesList = [], departments = [], officesList = [], savedWorkflows = [], selectedWorkflowId = '' }) => {
  // Hooks MUST be called before any early returns (React rules of hooks)
  const [newCheckItem, setNewCheckItem] = useState('');
  const [rolePreviewUsers, setRolePreviewUsers] = useState([]);
  const [rolePreviewLoading, setRolePreviewLoading] = useState(false);

  const data = selectedNode?.data || {};
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Open the advanced (person / role) options when the step already uses them
  useEffect(() => {
    setShowAdvanced(['specific_user', 'role_based'].includes(selectedNode?.data?.assignmentStrategy) || Boolean(selectedNode?.data?.assignee && !selectedNode?.data?.assignmentStrategy));
    setNewCheckItem('');
    // Only when another step is selected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);

  // Live preview: fetch matching users whenever role + department filter changes
  useEffect(() => {
    if (!selectedNode || selectedNode.type !== 'task') return;
    if (data.assignmentStrategy !== 'role_based' || !data.roleId) {
      setRolePreviewUsers([]);
      return;
    }
    // For INITIATOR_DEPT we can't know the department at design time — show all in role
    const deptId = data.routingType === 'SPECIFIC' ? data.targetDepartmentId : null;

    setRolePreviewLoading(true);
    const params = new URLSearchParams({ roleId: data.roleId });
    if (deptId) params.append('departmentId', deptId);

    api.get(`/admin/users/by-role?${params.toString()}`)
      .then(res => setRolePreviewUsers(res.data))
      .catch(() => setRolePreviewUsers([]))
      .finally(() => setRolePreviewLoading(false));
    // Re-run only when the routing settings change, not on every edit to the node
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id, data.assignmentStrategy, data.roleId, data.routingType, data.targetDepartmentId]);

  if (!selectedNode) return null;

  const type = STEP_TYPES[selectedNode.type] || STEP_TYPES.task;
  const onChange = (field, value) => updateNodeData(selectedNode.id, field, value);

  const checklist = listOf(data.checklist);
  const addChecklistItem = () => {
    if (newCheckItem.trim()) {
      onChange('checklist', [...checklist, newCheckItem.trim()]);
      setNewCheckItem('');
    }
  };
  const removeChecklistItem = (idx) => onChange('checklist', checklist.filter((_, i) => i !== idx));
  const moveChecklistItem = (idx, dir) => {
    const next = [...checklist];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange('checklist', next);
  };

  const getSmartDropdownValue = () => {
    if (data.assignmentStrategy === 'specific_user' && data.assignee) return `USER:${data.assignee}`;
    if (data.assignmentStrategy === 'role_based' && data.roleId) {
      if (data.routingType === 'INITIATOR_DEPT') return `ROLE:INITIATOR_DEPT:${data.roleId}`;
      if (data.routingType === 'SPECIFIC' && data.targetDepartmentId) return `ROLE:SPECIFIC:${data.roleId}:${data.targetDepartmentId}`;
      if (data.routingType === 'ANY') return `ROLE:ANY:${data.roleId}`;
    }
    return '';
  };

  const handleSmartDropdownChange = (val) => {
    if (!val) {
      onChange('assignmentStrategy', null);
      onChange('assignee', null);
      onChange('roleId', null);
      onChange('routingType', null);
      onChange('targetDepartmentId', null);
      return;
    }
    const parts = val.split(':');
    onChange('officeId', null);
    onChange('officePosition', null);
    onChange('positionId', null);
    if (parts[0] === 'USER') {
      onChange('assignmentStrategy', 'specific_user');
      onChange('assignee', parts[1]);
      onChange('roleId', null);
      onChange('routingType', null);
      onChange('targetDepartmentId', null);
    } else if (parts[0] === 'ROLE') {
      onChange('assignmentStrategy', 'role_based');
      onChange('assignee', null);
      onChange('roleId', parts[2]);
      onChange('routingType', parts[1]);
      onChange('targetDepartmentId', parts[1] === 'SPECIFIC' ? parts[3] : null);
    }
  };

  const deadlineHours = parseFloat(data.escalationHours || data.slaHours) || 0;
  const setDeadline = (h) => { onChange('escalationHours', h || ''); if (data.slaHours) onChange('slaHours', ''); };
  const actions = Array.isArray(data.allowedActions) ? data.allowedActions : ['approve', 'reject'];
  const toggleAction = (action, on) => onChange('allowedActions', on ? [...new Set([...actions, action])] : actions.filter((a) => a !== action));
  const outcomes = listOf(data.allowedTags);
  // Outcomes defined by the approval steps in this workflow, offered to "Branch on outcome"
  const knownOutcomes = [...new Set(allNodes.filter((n) => n.type === 'task').flatMap((n) => listOf(n.data?.allowedTags)))];

  return (
    <aside className="w-full sm:w-[380px] bg-white border-l border-gray-200 shadow-xl h-full flex flex-col absolute right-0 top-0 z-20" aria-label="Step settings">
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${type.tile}`}><Icon name={selectedNode.type} className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{type.label}</div>
            <input type="text" value={data.label || ''} onChange={(e) => onChange('label', e.target.value)} aria-label="Step name"
              placeholder="Name this step"
              className="w-full text-base font-semibold text-gray-900 bg-transparent border-0 border-b border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none px-0 py-0.5" />
          </div>
          <button onClick={() => deleteNode(selectedNode.id)} title="Delete step" aria-label="Delete step" className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Icon name="trash" /></button>
          <button onClick={closePanel} title="Close" aria-label="Close settings" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Icon name="close" /></button>
        </div>
        <p className="text-xs text-gray-500 mt-2">{type.hint}.</p>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* 1. APPROVAL STEP */}
        {selectedNode.type === 'task' && (
          <>
            <Section icon="office" title="Who reviews" summary={describeAssignee({ ...data, officesList, rolesList, staffList, departments }).text}>
              {!showAdvanced ? (
                <>
                  <div>
                    <Label>Office</Label>
                    <select
                      value={data.assignmentStrategy === 'office' ? (data.officeId || '') : ''}
                      onChange={(e) => {
                        onChange('assignmentStrategy', 'office');
                        onChange('officeId', e.target.value || null);
                        // A position belongs to one office, so a new office starts from "any officer"
                        onChange('officePosition', 'officer');
                        onChange('positionId', null);
                        onChange('assignee', null); onChange('roleId', null); onChange('routingType', null); onChange('targetDepartmentId', null);
                      }}
                      className={fieldClass}
                    >
                      <option value="">Choose an office</option>
                      {officesList.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  {data.assignmentStrategy === 'office' && data.officeId && (() => {
                    const office = officesList.find(o => o.id === parseInt(data.officeId));
                    const value = data.officePosition === 'position' ? `pos:${data.positionId || ''}` : (data.officePosition || 'officer');
                    const options = [
                      { value: 'officer', title: 'Any officer', text: 'Shared queue; whoever is free claims it.' },
                      { value: 'head', title: 'Head of office', text: 'For sign-offs; goes to whoever covers when they are away.' },
                      ...(office?.positions || []).map(p => ({ value: `pos:${p.id}`, title: p.name, text: 'Only holders of this position can claim it.' })),
                    ];
                    return (
                      <div>
                        <Label>Who in the office</Label>
                        <div className="space-y-1.5" role="radiogroup" aria-label="Who in the office">
                          {options.map(o => (
                            <label key={o.value} className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer ${value === o.value ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                              <input type="radio" name="who-in-office" className="mt-0.5 text-indigo-600 focus:ring-indigo-500" checked={value === o.value}
                                onChange={() => {
                                  if (o.value.startsWith('pos:')) { onChange('officePosition', 'position'); onChange('positionId', o.value.slice(4)); }
                                  else { onChange('officePosition', o.value); onChange('positionId', null); }
                                }} />
                              <span>
                                <span className="block text-sm font-medium text-gray-900">{o.title}</span>
                                <span className="block text-xs text-gray-500">{o.text}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {officesList.length === 0 && <p className="text-xs text-amber-700">No offices yet. Create them on the Offices &amp; Positions page.</p>}
                  <button type="button" onClick={() => setShowAdvanced(true)} className="text-xs font-medium text-gray-500 hover:text-indigo-700">Advanced: a specific person or role instead</button>
                </>
              ) : (
                <>
                  <div>
                    <Label hint="For steps that don't belong to an office.">Person or role</Label>
                    <select value={getSmartDropdownValue()} onChange={(e) => handleSmartDropdownChange(e.target.value)} className={fieldClass}>
                      <option value="">Choose who reviews</option>
                      <optgroup label="Applicant's department (decided per request)">
                        {rolesList.filter(r => r.id !== 1 && staffList.some(s => s.role_id === r.id)).map(r => (
                          <option key={`dyn-${r.id}`} value={`ROLE:INITIATOR_DEPT:${r.id}`}>Applicant's {r.name}</option>
                        ))}
                      </optgroup>
                      {departments.map(d => {
                        const validCombos = rolesList.filter(r => r.id !== 1 && staffList.some(s => s.role_id === r.id && s.department_id === d.id));
                        if (validCombos.length === 0) return null;
                        return (
                          <optgroup key={`dept-${d.id}`} label={d.name}>
                            {validCombos.map(r => <option key={`spec-${r.id}-${d.id}`} value={`ROLE:SPECIFIC:${r.id}:${d.id}`}>{d.name}: {r.name}</option>)}
                          </optgroup>
                        );
                      })}
                      <optgroup label="Any department">
                        {rolesList.filter(r => r.id !== 1 && staffList.some(s => s.role_id === r.id)).map(r => (
                          <option key={`any-${r.id}`} value={`ROLE:ANY:${r.id}`}>Any {r.name}</option>
                        ))}
                      </optgroup>
                      <optgroup label="A specific person">
                        {staffList.filter(s => s.role_id !== 1).map(s => (
                          <option key={`user-${s.id}`} value={`USER:${s.id}`}>{s.name}{s.department_name ? ` (${s.department_name})` : ''}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  {data.roleId && (
                    <div>
                      <Label>Who will receive it{data.routingType === 'INITIATOR_DEPT' ? ' (everyone in the role)' : ''}</Label>
                      {rolePreviewLoading ? (
                        <p className="text-xs text-gray-400">Loading...</p>
                      ) : rolePreviewUsers.length === 0 ? (
                        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">Nobody matches this yet, so the step could not be picked up.</p>
                      ) : (
                        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                          {rolePreviewUsers.map(u => (
                            <li key={u.id} className="flex items-center justify-between px-3 py-1.5">
                              <span className="text-sm text-gray-800">{u.name}{u.department_name && <span className="text-xs text-gray-400"> · {u.department_name}</span>}</span>
                              {data.routingType === 'SPECIFIC' && (
                                <button onClick={() => { onChange('assignmentStrategy', 'specific_user'); onChange('assignee', u.id); onChange('roleId', null); onChange('routingType', null); onChange('targetDepartmentId', null); }}
                                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">Only them</button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <button type="button" onClick={() => setShowAdvanced(false)} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">Use an office instead</button>
                </>
              )}
            </Section>

            <Section icon="delay" title="Deadline" summary={deadlineHours ? `${formatDuration(deadlineHours)}${data.workingDaysOnly ? ', working days' : ''}` : 'None'}>
              <div>
                <Label hint="Counted from when the step reaches the reviewer.">Complete within</Label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {DEADLINE_PRESETS.map(h => (
                    <button key={h} type="button" onClick={() => setDeadline(h)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${deadlineHours === h ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-gray-700 hover:border-indigo-400'}`}>
                      {formatDuration(h)}
                    </button>
                  ))}
                  <button type="button" onClick={() => setDeadline('')}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${!deadlineHours ? 'bg-gray-800 border-gray-800 text-white' : 'border-gray-300 text-gray-700 hover:border-gray-500'}`}>
                    No deadline
                  </button>
                </div>
                <DurationInput key={`dl-${selectedNode.id}`} hours={deadlineHours} onChange={setDeadline} ariaLabel="Deadline" />
              </div>
              {deadlineHours > 0 && (
                <>
                  <Toggle checked={!!data.workingDaysOnly} onChange={(v) => onChange('workingDaysOnly', v)}
                    label="Count working days only" description="Saturdays and Sundays don't count towards the deadline." />
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <Label hint="A gentle nudge to the reviewer, this long before the deadline.">Reminder</Label>
                      <DurationInput key={`rm-${selectedNode.id}`} hours={data.reminderHours} onChange={(h) => onChange('reminderHours', h)} ariaLabel="Reminder" />
                    </div>
                    <div>
                      <Label hint="A last warning, this long before the deadline.">Final warning</Label>
                      <DurationInput key={`wn-${selectedNode.id}`} hours={data.warningHours} onChange={(h) => onChange('warningHours', h)} ariaLabel="Final warning" />
                    </div>
                  </div>
                  <div>
                    <Label hint="Late work moves up the office automatically: to the position this one reports to, then the head.">If it runs late</Label>
                    <select value={data.escalationUserId || ''} onChange={(e) => onChange('escalationUserId', e.target.value)} className={fieldClass}>
                      <option value="">Escalate up the office (automatic)</option>
                      {staffList.filter(s => s.role_id !== 1).map(s => (
                        <option key={s.id} value={s.id}>Hand to {s.name}{s.department_name ? ` (${s.department_name})` : ''}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </Section>

            <Section icon="checklist" title="Before approving" summary={[checklist.length && `${checklist.length} check${checklist.length > 1 ? 's' : ''}`, outcomes.length && `${outcomes.length} outcomes`].filter(Boolean).join(', ') || 'Nothing required'}>
              <div>
                <Label hint="The reviewer ticks each item before they can sign. Their confirmations are saved with the signature.">Required checks</Label>
                {checklist.length > 0 && (
                  <ol className="mb-2 space-y-1.5">
                    {checklist.map((item, idx) => (
                      <li key={`${idx}-${item}`} className="group flex items-center gap-2 text-sm bg-gray-50 border border-gray-200 rounded-lg pl-3 pr-1 py-1.5">
                        <span className="w-4 h-4 rounded border border-gray-300 bg-white shrink-0" aria-hidden="true" />
                        <span className="flex-1 text-gray-800">{item}</span>
                        <button type="button" onClick={() => moveChecklistItem(idx, -1)} disabled={idx === 0} aria-label="Move up" className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30">↑</button>
                        <button type="button" onClick={() => moveChecklistItem(idx, 1)} disabled={idx === checklist.length - 1} aria-label="Move down" className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30">↓</button>
                        <button type="button" onClick={() => removeChecklistItem(idx)} aria-label={`Remove ${item}`} className="p-1 text-gray-400 hover:text-red-600"><Icon name="close" className="w-3.5 h-3.5" /></button>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="flex gap-2">
                  <input type="text" value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } }}
                    className={fieldClass} placeholder="e.g. Fee receipt is attached" />
                  <button type="button" onClick={addChecklistItem} className="px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">Add</button>
                </div>
              </div>

              <div>
                <Label hint="The reviewer picks one when approving. A later Branch step can route on it.">Decision outcomes</Label>
                <ChipsInput values={outcomes} onChange={(vals) => onChange('allowedTags', vals.join(', '))}
                  placeholder="e.g. Undergraduate, Postgraduate" suggestions={outcomes.length ? [] : ['Complete', 'Incomplete']} />
              </div>
            </Section>

            <Section icon="settings" title="Reviewer can" summary={[actions.includes('approve') && 'Approve', actions.includes('reject') && 'Send back', actions.includes('attach_documents') && 'Attach'].filter(Boolean).join(', ') || 'Nothing'} defaultOpen={false}>
              <Toggle checked={actions.includes('approve')} onChange={(v) => toggleAction('approve', v)} label="Approve and sign" description="Moves the request on to the next step." />
              <Toggle checked={actions.includes('reject')} onChange={(v) => toggleAction('reject', v)} label="Send back to the applicant" description="With a reason; the applicant can fix it and resubmit." />
              <Toggle checked={actions.includes('attach_documents')} onChange={(v) => toggleAction('attach_documents', v)} label="Attach files" description="For example a receipt or a signed letter." />
            </Section>
          </>
        )}

        {/* 2. BRANCH ON OUTCOME */}
        {selectedNode.type === 'condition' && (
          <Section icon="condition" title="Route by outcome">
            <div>
              <Label hint="Follows Yes when the outcome chosen earlier is one of these; otherwise No.">Go down Yes when the outcome is</Label>
              <ChipsInput tone="amber" values={listOf(data.conditionValue)} onChange={(vals) => onChange('conditionValue', vals.join(', '))}
                placeholder={knownOutcomes.length ? 'Pick below or type one' : 'Type an outcome'} suggestions={knownOutcomes} />
              {knownOutcomes.length === 0 && (
                <p className="text-xs text-amber-700 mt-2">Tip: give an approval step some decision outcomes first, then pick them here.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-green-50 border border-green-200 p-2.5"><span className="font-semibold text-green-800">Yes</span><span className="block text-green-700 mt-0.5">{listOf(data.conditionValue).join(' or ') || 'Not set'}</span></div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-2.5"><span className="font-semibold text-gray-700">No</span><span className="block text-gray-500 mt-0.5">Any other outcome</span></div>
            </div>
          </Section>
        )}

        {/* 3. EMAIL */}
        {selectedNode.type === 'email' && (
          <Section icon="email" title="Message"><EmailProperties data={data} onChange={onChange} /></Section>
        )}

        {/* 4. WAIT */}
        {selectedNode.type === 'delay' && (
          <Section icon="delay" title="How long to wait">
            <div>
              <Label hint="The request continues on its own afterwards.">Wait for</Label>
              <DurationInput key={`delay-${selectedNode.id}`} hours={data.delayHours} onChange={(h) => onChange('delayHours', h)} ariaLabel="Wait" />
            </div>
          </Section>
        )}

        {/* 5. PARALLEL / 6. MERGE */}
        {(selectedNode.type === 'parallel' || selectedNode.type === 'join') && (
          <Section icon={selectedNode.type} title="How it works">
            <p className="text-sm text-gray-600">
              {selectedNode.type === 'parallel'
                ? 'Connect this to two or more steps. They all start at the same time, for example Library, Finance and Dean of Students clearing a student together.'
                : 'Connect every parallel branch into this step. The request waits here until all of them are approved, then continues.'}
            </p>
          </Section>
        )}

        {/* 7. START OTHER SERVICES */}
        {selectedNode.type === 'spawn' && (
          <Section icon="spawn" title="Services to start">
            <p className="text-xs text-gray-500">Each one opens as a new request for the same applicant.</p>
            <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {savedWorkflows.filter(w => w.id !== parseInt(selectedWorkflowId || 0)).map(wf => {
                const isSelected = listOf(data.spawnIds).includes(wf.id.toString());
                return (
                  <label key={wf.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={isSelected}
                      onChange={(e) => {
                        let ids = listOf(data.spawnIds);
                        if (e.target.checked) ids.push(wf.id.toString());
                        else ids = ids.filter(id => id !== wf.id.toString());
                        onChange('spawnIds', ids.join(','));
                      }}
                      className="text-indigo-600 focus:ring-indigo-500 rounded" />
                    <span className="truncate text-sm text-gray-800" title={wf.name}>{wf.name}</span>
                  </label>
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
};


/** A short checkbox list for the service settings dialog */
const CheckList = ({ options, selected, onToggle, empty }) => (
  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
    {options.length === 0 && <p className="text-sm text-gray-500 px-3 py-2">{empty}</p>}
    {options.map(o => (
      <label key={o.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
        <input type="checkbox" checked={selected.includes(String(o.id))} onChange={(e) => onToggle(String(o.id), e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
        <span className="text-sm text-gray-800">{o.name}</span>
      </label>
    ))}
  </div>
);

// ==========================================
// 3. LEFT PALETTE
// ==========================================
const PALETTE = [
  { group: 'Review', types: ['task'] },
  { group: 'Routing', types: ['condition', 'parallel', 'join'] },
  { group: 'Automation', types: ['email', 'delay', 'spawn'] },
];

const Sidebar = ({ onAdd }) => {
  const onDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/reactflow-label', STEP_TYPES[nodeType].label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-60 bg-white border-r border-gray-200 h-full hidden md:flex flex-col">
      <div className="px-4 pt-4 pb-2">
        <div className="text-sm font-semibold text-gray-900">Add a step</div>
        <div className="text-xs text-gray-500">Drag onto the canvas, or click to add.</div>
      </div>
      <div className="px-3 pb-3 space-y-4 overflow-y-auto">
        {PALETTE.map(({ group, types }) => (
          <div key={group}>
            <div className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group}</div>
            <div className="space-y-1.5">
              {types.map((t) => (
                <button key={t} type="button" draggable onDragStart={(e) => onDragStart(e, t)} onClick={() => onAdd(t)}
                  className="w-full flex items-start gap-2.5 p-2 rounded-lg border border-gray-200 bg-white text-left hover:border-indigo-300 hover:shadow-sm cursor-grab active:cursor-grabbing">
                  <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${STEP_TYPES[t].tile}`}><Icon name={t} /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{STEP_TYPES[t].label}</span>
                    <span className="block text-[11px] text-gray-500 leading-snug">{STEP_TYPES[t].hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 py-3 mt-auto border-t border-gray-100 text-[11px] text-gray-500 leading-relaxed">
        Connect steps by dragging from the dot under a step to the next one. Select a step or line and press <kbd className="bg-gray-100 border border-gray-200 px-1 rounded">Delete</kbd> to remove it.
      </div>
    </div>
  );
};


// ==========================================
// 4. MAIN BUILDER COMPONENT (INTERNAL)
// ==========================================
const WorkflowBuilderInner = ({ onExit }) => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [workflowName, setWorkflowName] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');

  const [savedWorkflows, setSavedWorkflows] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [officesList, setOfficesList] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [allowedSubmitters, setAllowedSubmitters] = useState([]);
  const [prerequisiteWorkflowIds, setPrerequisiteWorkflowIds] = useState('');
  const [clearanceWorkflowIds, setClearanceWorkflowIds] = useState('');

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toast, setToast] = useState({ type: '', text: '' });
  const builderContainerRef = useRef(null);

  // Custom confirm modal state (replaces native window.confirm)
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', messages: [], onConfirm: null, confirmText: 'Confirm', type: 'warning' });
  const showConfirm = (title, messages, onConfirm, confirmText = 'Confirm', type = 'warning') => setConfirmModal({ open: true, title, messages, onConfirm, confirmText, type });
  const closeConfirm = () => setConfirmModal({ open: false, title: '', messages: [], onConfirm: null, confirmText: 'Confirm', type: 'warning' });

  const showToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast({ type: '', text: '' }), 4000);
  };

  const reactFlowWrapper = useRef(null);
  const { screenToFlowPosition, fitView, getViewport } = useReactFlow();

  const nodeTypes = useMemo(() => ({
    task: TaskNode,
    condition: ConditionNode,
    email: EmailNode,
    delay: DelayNode,
    parallel: ParallelNode,
    spawn: SpawnNode,
    join: JoinNode
  }), []);

  // Fetch init data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [wfRes, staffRes, rolesRes, deptRes, officeRes] = await Promise.all([
          api.get('/workflows'),
          api.get('/admin/users'),
          api.get('/admin/roles'),
          api.get('/admin/departments'),
          api.get('/offices').catch(() => ({ data: [] })),
        ]);
        setOfficesList(officeRes.data || []);
        setSavedWorkflows(wfRes.data);
        setStaffList(staffRes.data); // All system users can be manually assigned as approvers
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
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, staffList, rolesList, departments, officesList } })));
  }, [staffList, rolesList, departments, officesList]);

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

    // Centre the node on the cursor (nodes are about 240 x 90 px)
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const position = { x: point.x - 120, y: point.y - 45 };

    const newNode = {
      id: `${type}_${Date.now()}`,
      type,
      position,
      selected: true,
      // New approval steps go to an office by default; a named person is the advanced option
      data: { label, staffList, rolesList, departments, officesList, ...(type === 'task' ? { assignmentStrategy: 'office', officePosition: 'officer' } : {}) },
    };

    // Select the new node (and only it) so its settings panel opens straight away
    setNodes((nds) => nds.map(n => ({ ...n, selected: false })).concat(newNode));
    setSelectedNodeId(newNode.id);
  }, [screenToFlowPosition, staffList, rolesList, departments, officesList]);


  // Clicking a palette item adds the step in the middle of what is on screen
  const addNodeAtCenter = useCallback((type) => {
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    const { x, y, zoom } = getViewport();
    const cx = bounds ? (bounds.width / 2 - x) / zoom : 200;
    const cy = bounds ? (bounds.height / 3 - y) / zoom : 120;
    const offset = (nodes.length % 5) * 20;
    const newNode = {
      id: `${type}_${Date.now()}`,
      type,
      position: { x: cx - 120 + offset, y: cy - 40 + offset },
      selected: true,
      data: { label: STEP_TYPES[type].label, staffList, rolesList, departments, officesList, ...(type === 'task' ? { assignmentStrategy: 'office', officePosition: 'officer' } : {}) },
    };
    setNodes((nds) => nds.map(n => ({ ...n, selected: false })).concat(newNode));
    setSelectedNodeId(newNode.id);
  }, [getViewport, nodes.length, staffList, rolesList, departments, officesList]);

  const deleteNode = useCallback((id) => {
    setNodes((nds) => nds.filter(n => n.id !== id));
    setEdges((eds) => eds.filter(e => e.source !== id && e.target !== id));
    setSelectedNodeId(null);
  }, []);

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
        data: { ...node.data, staffList, rolesList, departments, officesList }
      }));
      setNodes(loadedNodes); setEdges(flowData.edges || []);
      // Frame the loaded workflow once React Flow has measured the nodes
      setTimeout(() => fitView({ padding: 0.2, maxZoom: 1, duration: 300 }), 50);
      setAllowedSubmitters(flowData.metadata?.allowedSubmitters || []);
      setPrerequisiteWorkflowIds(flowData.metadata?.prerequisiteWorkflowIds?.join(',') || '');
      setClearanceWorkflowIds(flowData.metadata?.clearanceWorkflowIds?.join(',') || '');
    }
  };

  const [isValidating, setIsValidating] = useState(false);

  // Checks validation rules and returns an array of error messages.
  const getValidationErrors = () => {
    const errors = [];
    if (nodes.length === 0) {
      errors.push("Workflow is empty. Please add at least one step.");
      return errors;
    }
    nodes.forEach(n => {
      if (n.type === 'task') {
        const hasAssignee = !!n.data.assignee;
        const hasRole = n.data.assignmentStrategy === 'role_based' && !!n.data.roleId;
        const hasOffice = n.data.assignmentStrategy === 'office' && !!n.data.officeId;
        if (!hasAssignee && !hasRole && !hasOffice) {
          errors.push(n.data.assignmentStrategy === 'office'
            ? `Approval step "${n.data.label}" has no office selected.`
            : `Approval step "${n.data.label}" has no reviewer set.`);
        }
      }
      if (n.type === 'task' && n.data.assignmentStrategy === 'office' && n.data.officePosition === 'position' && !n.data.positionId) {
        errors.push(`Approval step "${n.data.label}" needs a position.`);
      }
      if (n.type === 'condition' && listOf(n.data.conditionValue).length === 0) errors.push(`Branch "${n.data.label}" has no outcome to match.`);
      if (n.type === 'email' && !n.data.recipient) errors.push(`Email step "${n.data.label}" has no recipient.`);
    });
    
    const connectedNodeIds = new Set();
    edges.forEach(e => { connectedNodeIds.add(e.source); connectedNodeIds.add(e.target); });
    if (nodes.length > 1) {
      nodes.forEach(n => {
        if (!connectedNodeIds.has(n.id)) errors.push(`Step "${n.data.label}" is not connected to anything.`);
      });
    }

    // 3. Circular dependency (Deadlock) check using DFS
    const adj = {};
    nodes.forEach(n => { adj[n.id] = []; });
    edges.forEach(e => {
      if (adj[e.source]) {
        adj[e.source].push(e.target);
      }
    });

    const visited = {};
    const recStack = {};
    let cycleFound = false;

    const dfs = (nodeId) => {
      if (!visited[nodeId]) {
        visited[nodeId] = true;
        recStack[nodeId] = true;

        const neighbors = adj[nodeId] || [];
        for (let i = 0; i < neighbors.length; i++) {
          const nextNode = neighbors[i];
          if (!visited[nextNode] && dfs(nextNode)) {
            return true;
          } else if (recStack[nextNode]) {
            return true;
          }
        }
      }
      recStack[nodeId] = false;
      return false;
    };

    for (let i = 0; i < nodes.length; i++) {
      if (!visited[nodes[i].id]) {
        if (dfs(nodes[i].id)) {
          cycleFound = true;
          break;
        }
      }
    }

    if (cycleFound) {
      errors.push("Workflow contains circular paths (deadlocks / infinite loops). Please resolve them to prevent execution failure.");
    }

    return errors;
  };

  const saveDraft = () => {
    if (!workflowName) { showToast('error', 'Please enter a workflow name before saving.'); return; }
    doSave(false); // drafts are explicitly unpublished
  };

  const publishWorkflow = () => {
    if (!workflowName) { showToast('error', 'Please enter a workflow name before publishing.'); return; }

    const errors = getValidationErrors();
    if (errors.length > 0) {
      showConfirm(
        'Fix these before publishing',
        [...errors, "You can still save your progress as a draft."],
        null,
        'Understood',
        'error'
      );
      return;
    }
    doSave(true);
  };

  const doSave = async (isPublished) => {
    closeConfirm();

    setIsValidating(true);
    try {
      const cleanedNodes = nodes.map(n => {
        const cleanData = { ...n.data };
        delete cleanData.staffList; // strip large redundant arrays before saving
        delete cleanData.rolesList;
        delete cleanData.departments;
        delete cleanData.officesList;
        return { ...n, data: cleanData };
      });
      const metadataObj = { allowedSubmitters, prerequisiteWorkflowIds: prerequisiteWorkflowIds ? prerequisiteWorkflowIds.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : null, isPublished };
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
        showToast('success', 'Workflow updated successfully!');
      } else {
        const res = await api.post('/workflows', { name: workflowName, flow_structure: flowData });
        setSelectedWorkflowId(res.data.id.toString());
        showToast('success', 'New workflow created successfully!');
      }
      // Re-fetch list
      const wfRes = await api.get('/workflows');
      setSavedWorkflows(wfRes.data);
      return true;
    } catch (err) {
      const data = err.response?.data;
      if (data?.problems?.length) {
        // The server checks the workflow too; show exactly what needs fixing
        showConfirm('Could not save the workflow', data.problems, null, 'Understood', 'error');
      } else {
        showToast('error', data?.message || 'Failed to save workflow. Please try again.');
      }
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  const handleCreateNew = async () => {
    if (nodes.length > 0) {
      if (!workflowName) {
        showToast('error', 'Please enter a workflow name to save current progress before creating a new one.');
        return;
      }
      let isPublished = false;
      if (selectedWorkflowId) {
        const loadedWorkflow = savedWorkflows.find(w => w.id === parseInt(selectedWorkflowId));
        if (loadedWorkflow) {
          const meta = (typeof loadedWorkflow.flow_structure === 'string' ? JSON.parse(loadedWorkflow.flow_structure) : loadedWorkflow.flow_structure).metadata;
          isPublished = meta?.isPublished === true || (meta?.isPublished === undefined && meta?.isComplete !== false);
        }
      }
      const saved = await doSave(isPublished);
      if (!saved) return;
    }
    
    setNodes([]); 
    setEdges([]); 
    setSelectedNodeId(null); 
    setAllowedSubmitters([]); 
    setPrerequisiteWorkflowIds(''); 
    setClearanceWorkflowIds(''); 
    setSelectedWorkflowId(''); 
    setWorkflowName('');
    showToast('success', 'Started a new workflow.');
  };

  const handleClear = () => {
    showConfirm(
      'Clear the canvas?',
      ['This removes every step and connection. It cannot be undone.'],
      () => { setNodes([]); setEdges([]); setSelectedNodeId(null); setAllowedSubmitters([]); setPrerequisiteWorkflowIds(''); setClearanceWorkflowIds(''); },
      'Clear Canvas',
      'danger'
    );
  }

  const handleDeleteWorkflow = () => {
    if (!selectedWorkflowId) return;
    showConfirm(
      'Delete this workflow?',
      ['It will be permanently deleted. This cannot be undone.', 'Workflows that already have requests cannot be deleted; unpublish them instead.'],
      async () => {
        try {
          await api.delete(`/workflows/${selectedWorkflowId}`);
          showToast('success', 'Workflow deleted successfully!');
          // Clear current
          setNodes([]); setEdges([]); setSelectedNodeId(null); setAllowedSubmitters([]); setPrerequisiteWorkflowIds(''); setClearanceWorkflowIds(''); setSelectedWorkflowId(''); setWorkflowName('');
          // Refetch
          const wfRes = await api.get('/workflows');
          setSavedWorkflows(wfRes.data);
        } catch (err) {
          if (err.response && err.response.status === 400) {
            showConfirm(
              'This workflow cannot be deleted',
              [err.response.data.message || 'Cannot delete a workflow with active or historical records.', 'Please Unpublish (Take Down) the workflow instead to preserve analytics and history.'],
              null,
              'Understood',
              'error'
            );
          } else {
            showToast('error', 'An error occurred while deleting the workflow.');
          }
        }
      },
      'Delete Permanently',
      'danger'
    );
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      if (builderContainerRef.current) {
        builderContainerRef.current.requestFullscreen().catch(err => {
          showToast('error', `Could not enter full-screen: ${err.message}`);
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




  const publishedOf = (wf) => {
    if (!wf) return false;
    const meta = (typeof wf.flow_structure === 'string' ? JSON.parse(wf.flow_structure) : (wf.flow_structure || {})).metadata;
    return meta?.isPublished === true || (meta?.isPublished === undefined && meta?.isComplete !== false);
  };
  const loadedWorkflow = savedWorkflows.find(w => w.id === parseInt(selectedWorkflowId));
  const isLoadedWorkflowPublished = publishedOf(loadedWorkflow);
  const settingsCount = allowedSubmitters.length + listOf(prerequisiteWorkflowIds).length + listOf(clearanceWorkflowIds).length;
  const otherWorkflows = savedWorkflows.filter(w => w.id !== parseInt(selectedWorkflowId || 0));
  const danger = confirmModal.type === 'error' || confirmModal.type === 'danger';

  const toggleIn = (csv, id, on) => {
    const ids = listOf(csv).filter(x => x !== id);
    return (on ? [...ids, id] : ids).join(',');
  };

  return (
    <div ref={builderContainerRef} className="fixed inset-0 z-40 bg-white flex flex-col">
      {/* Toast Notification */}
      {toast.text && (
        <div className="fixed top-20 right-6 z-[80]" role="status">
          <div className={`px-4 py-3 rounded-lg shadow-xl border text-sm font-medium flex items-center gap-2 bg-white ${toast.type === 'error' ? 'border-red-200 text-red-700' : 'border-green-200 text-green-700'}`}>
            <span className={`w-2 h-2 rounded-full ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`} />
            {toast.text}
          </div>
        </div>
      )}

      {/* Confirm / problems dialog */}
      {confirmModal.open && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-[100] p-4">
          <div role="dialog" aria-modal="true" aria-label={confirmModal.title} className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 pt-5 pb-3 flex items-start gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${danger ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}><Icon name="warning" className="w-5 h-5" /></div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">{confirmModal.title}</h3>
                <ul className="mt-2 space-y-1.5">
                  {confirmModal.messages.map((msg, i) => <li key={i} className="text-sm text-gray-600">{msg}</li>)}
                </ul>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
              {confirmModal.onConfirm && (
                <button onClick={closeConfirm} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50">Cancel</button>
              )}
              <button
                onClick={() => { if (confirmModal.onConfirm) confirmModal.onConfirm(); closeConfirm(); }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >{confirmModal.confirmText}</button>
            </div>
          </div>
        </div>
      )}

      {/* WORKFLOW LIBRARY */}
      {isBrowserOpen && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-[100] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setIsBrowserOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Workflows" className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Workflows</h2>
                <p className="text-sm text-gray-500">Open a service to edit it, or start a new one.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setIsBrowserOpen(false); handleCreateNew(); }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"><Icon name="plus" /> New workflow</button>
                <button onClick={() => setIsBrowserOpen(false)} aria-label="Close" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Icon name="close" className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {[{ title: 'Live services', live: true }, { title: 'Drafts', live: false }].map(({ title, live }) => {
                const list = savedWorkflows.filter(wf => publishedOf(wf) === live);
                return (
                  <div key={title}>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-gray-400'}`} /> {title} <span className="text-gray-400 font-normal normal-case">({list.length})</span>
                    </h3>
                    {list.length === 0 ? (
                      <div className="py-6 text-center text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">{live ? 'Nothing published yet.' : 'No drafts.'}</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {list.map(wf => {
                          const flow = typeof wf.flow_structure === 'string' ? JSON.parse(wf.flow_structure) : (wf.flow_structure || {});
                          const steps = (flow.nodes || []).filter(n => n.type === 'task').length;
                          return (
                            <button key={wf.id} onClick={() => { handleLoadWorkflow({ target: { value: wf.id } }); setIsBrowserOpen(false); }}
                              className={`text-left bg-white border rounded-xl p-4 hover:shadow-md transition-shadow ${String(wf.id) === String(selectedWorkflowId) ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-gray-200 hover:border-indigo-300'}`}>
                              <div className="flex justify-between items-start gap-2">
                                <h4 className="font-semibold text-gray-900 leading-snug">{wf.name}</h4>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase shrink-0 ${live ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{live ? 'Live' : 'Draft'}</span>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">{steps} approval step{steps === 1 ? '' : 's'} · {(flow.nodes || []).length} in total</p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SERVICE SETTINGS */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-[100] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setIsSettingsOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Service settings" className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Service settings</h2>
                <p className="text-sm text-gray-500">Who can request this service, and what they need first.</p>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} aria-label="Close" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Icon name="close" className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto">
              <div>
                <Label hint="Leave empty to let everyone submit.">Who can submit</Label>
                <CheckList options={rolesList} selected={allowedSubmitters.map(String)} empty="No account types."
                  onToggle={(id, on) => setAllowedSubmitters(listOf(toggleIn(allowedSubmitters.join(','), id, on)).map(Number))} />
              </div>
              <div>
                <Label hint="Services the applicant must have completed before they can submit this one.">Must be approved first</Label>
                <CheckList options={otherWorkflows} selected={listOf(prerequisiteWorkflowIds)} empty="No other services yet."
                  onToggle={(id, on) => setPrerequisiteWorkflowIds(toggleIn(prerequisiteWorkflowIds, id, on))} />
              </div>
              <div>
                <Label hint="Opened automatically on submission; this request can't finish until they are approved.">Clearances opened alongside</Label>
                <CheckList options={otherWorkflows} selected={listOf(clearanceWorkflowIds)} empty="No other services yet."
                  onToggle={(id, on) => setClearanceWorkflowIds(toggleIn(clearanceWorkflowIds, id, on))} />
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <span className="text-xs text-gray-500">Saved with the workflow.</span>
              <button onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* TOP BAR */}
      <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-14 border-b border-gray-200 bg-white shrink-0">
        {onExit && (
          <>
            <button onClick={onExit} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100" title="Back to the dashboard">
              <Icon name="back" /> <span className="hidden lg:inline">Dashboard</span>
            </button>
            <div className="h-6 w-px bg-gray-200" />
          </>
        )}
        <button onClick={() => setIsBrowserOpen(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100" title="Open a workflow">
          <Icon name="folder" /> <span className="hidden sm:inline">Workflows</span>
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <input
            type="text" placeholder="Untitled workflow" value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} aria-label="Workflow name"
            className="min-w-0 w-full max-w-sm px-2 py-1 rounded-md text-base font-semibold text-gray-900 placeholder-gray-400 bg-transparent hover:bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {selectedWorkflowId && loadedWorkflow && (
            <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full flex items-center gap-1 shrink-0 ${isLoadedWorkflowPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isLoadedWorkflowPublished ? 'bg-emerald-500' : 'bg-gray-400'}`} />
              {isLoadedWorkflowPublished ? 'Live' : 'Draft'}
            </span>
          )}
        </div>

        <button onClick={() => setIsSettingsOpen(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100" title="Who can submit, prerequisites and clearances">
          <Icon name="settings" /> <span className="hidden md:inline">Settings</span>
          {settingsCount > 0 && <span className="text-[11px] font-semibold bg-indigo-100 text-indigo-700 rounded-full px-1.5">{settingsCount}</span>}
        </button>
        <button onClick={handleCreateNew} disabled={isValidating} className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-50" title="New workflow"><Icon name="plus" /></button>
        <button onClick={handleClear} className="px-2 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 hidden sm:block" title="Remove every step from the canvas">Clear</button>
        {selectedWorkflowId && (
          <button onClick={handleDeleteWorkflow} className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 hidden sm:block" title="Delete workflow"><Icon name="trash" /></button>
        )}
        <button onClick={toggleFullScreen} className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 hidden sm:block" title={isFullScreen ? 'Exit presentation mode' : 'Presentation mode (hide the browser bars)'}>
          <Icon name={isFullScreen ? 'shrink' : 'expand'} />
        </button>
        <div className="h-6 w-px bg-gray-200 hidden sm:block" />
        <button onClick={saveDraft} disabled={isValidating}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-60 ${isLoadedWorkflowPublished ? 'text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100' : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'}`}
          title={isLoadedWorkflowPublished ? 'Take it down and keep it as a draft' : 'Save without publishing'}>
          {isLoadedWorkflowPublished ? 'Unpublish' : 'Save draft'}
        </button>
        <button onClick={publishWorkflow} disabled={isValidating} className="px-3 sm:px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60">
          {selectedWorkflowId ? 'Publish changes' : 'Publish'}
        </button>
      </header>

      {/* MAIN WORKSPACE */}
      <div className="flex flex-1 relative overflow-hidden">
        <Sidebar onAdd={addNodeAtCenter} />

        <div className="flex-1 relative bg-slate-50" ref={reactFlowWrapper}>
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
            defaultViewport={{ x: 40, y: 40, zoom: 0.85 }}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            minZoom={0.25}
            maxZoom={1.5}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} color="#cbd5e1" gap={20} size={1.5} />
            <Controls showInteractive={false} className="!shadow-md !rounded-lg overflow-hidden !border !border-gray-200" />
            <MiniMap pannable zoomable nodeColor="#c7d2fe" nodeStrokeColor="#6366f1" maskColor="rgba(241, 245, 249, 0.7)" className="!rounded-lg !border !border-gray-200 !shadow-md hidden md:block" />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
              <div className="text-center max-w-sm bg-white/90 border border-dashed border-gray-300 rounded-2xl px-8 py-10 pointer-events-auto">
                <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center mx-auto mb-3"><Icon name="task" className="w-6 h-6" /></div>
                <h3 className="font-semibold text-gray-900">{workflowName ? 'Add the first step' : 'Design a service'}</h3>
                <p className="text-sm text-gray-500 mt-1">Drag an approval step from the left, or open one of the existing workflows.</p>
                <div className="flex justify-center gap-2 mt-4">
                  <button onClick={() => addNodeAtCenter('task')} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">Add approval step</button>
                  <button onClick={() => setIsBrowserOpen(true)} className="px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50">Open a workflow</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {selectedNodeId && (
          <PropertyInspector
            selectedNode={selectedNode}
            allNodes={nodes}
            updateNodeData={updateNodeData}
            deleteNode={deleteNode}
            closePanel={() => {
              setNodes(nds => nds.map(n => ({ ...n, selected: false })));
              setSelectedNodeId(null);
            }}
            staffList={staffList}
            rolesList={rolesList}
            departments={departments}
            officesList={officesList}
            savedWorkflows={savedWorkflows}
            selectedWorkflowId={selectedWorkflowId}
          />
        )}
      </div>
    </div>
  );
};

// Wrap in provider
export default function WorkflowBuilder({ onExit }) {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderInner onExit={onExit} />
    </ReactFlowProvider>
  );
}
