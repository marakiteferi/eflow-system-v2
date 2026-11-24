import { useState, useEffect, useCallback, useRef, useContext, useMemo } from 'react';
import api from '../../api';
import { AuthContext } from '../../context/AuthContext';
import { ACCOUNT_TYPES, PERMISSIONS, isAdministrator } from '../../access';
import { PageHeader, Card, Modal, Badge, Button, Field, inputClass, EmptyState, Avatar } from '../ui';
import AdminCodeDialog from './AdminCodeDialog';

const TYPE_TONE = { 1: 'blue', 2: 'gray', 3: 'purple' };
const errorText = (err, fallback) => err.response?.data?.message || fallback;

/** People: every account, with search, filters, add, import, edit, deactivate and departments. */
const PeopleManager = ({ showToast = () => {} }) => {
  const { user } = useContext(AuthContext);
  const toast = useRef(showToast);
  toast.current = showToast;

  const [tab, setTab] = useState('people');
  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [offices, setOffices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', type: '', office: '', status: 'active' });

  const [editing, setEditing] = useState(null); // person being edited, or {} for a new person
  const [deactivating, setDeactivating] = useState(null);
  const [codeFor, setCodeFor] = useState(null); // { action, run(code) }
  const [newLink, setNewLink] = useState(null);

  const loadPeople = useCallback(async () => {
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const res = await api.get('/people', { params });
      setPeople(res.data);
    } catch (err) {
      toast.current('error', errorText(err, 'Could not load people.'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadLists = useCallback(async () => {
    const [d, o] = await Promise.all([
      api.get('/admin/departments').catch(() => ({ data: [] })),
      api.get('/offices').catch(() => ({ data: [] })),
    ]);
    setDepartments(d.data);
    setOffices(o.data);
  }, []);

  // Search as you type, a moment after the last key
  useEffect(() => {
    const t = setTimeout(loadPeople, 200);
    return () => clearTimeout(t);
  }, [loadPeople]);
  useEffect(() => { loadLists(); }, [loadLists]);

  const counts = useMemo(() => ({
    total: people.length,
    staff: people.filter((p) => p.role_id === 2).length,
    students: people.filter((p) => p.role_id === 1).length,
    admins: people.filter((p) => p.role_id === 3).length,
  }), [people]);

  const reactivate = async (p) => {
    try {
      const r = await api.post(`/people/${p.id}/reactivate`);
      toast.current('success', r.data.message);
      loadPeople();
    } catch (err) { toast.current('error', errorText(err, 'Could not reactivate.')); }
  };

  const sendLink = async (p) => {
    try {
      const r = await api.post(`/people/${p.id}/send-setup-link`);
      if (r.data.setPasswordLink) setNewLink({ name: p.name, link: r.data.setPasswordLink });
      else toast.current('success', r.data.message);
    } catch (err) { toast.current('error', errorText(err, 'Could not create a link.')); }
  };

  const tabs = [
    ['people', 'People'],
    ['import', 'Import from CSV'],
    ['departments', 'Departments'],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="People"
        subtitle="Everyone who can sign in. Give each person an account type, and give staff only the permissions they need."
        actions={<Button onClick={() => setEditing({})}>+ Add person</Button>}
      />

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'people' && (
        <>
          <Card className="p-4 flex flex-col lg:flex-row gap-3">
            <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Search by name or email" aria-label="Search people" className={`${inputClass} lg:flex-1`} />
            <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} className={`${inputClass} lg:w-44`} aria-label="Account type">
              <option value="">All account types</option>
              {Object.entries(ACCOUNT_TYPES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={filters.office} onChange={(e) => setFilters({ ...filters, office: e.target.value })} className={`${inputClass} lg:w-48`} aria-label="Office">
              <option value="">All offices</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={`${inputClass} lg:w-40`} aria-label="Status">
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
              <option value="">Everyone</option>
            </select>
          </Card>

          <p className="text-sm text-gray-500">
            {counts.total} {counts.total === 1 ? 'person' : 'people'} · {counts.students} {counts.students === 1 ? 'student' : 'students'} · {counts.staff} staff · {counts.admins} {counts.admins === 1 ? 'administrator' : 'administrators'}
          </p>

          {loading ? <div className="p-8 text-center text-gray-500">Loading people…</div> : people.length === 0 ? (
            <EmptyState>Nobody matches these filters.</EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3">Person</th>
                      <th className="px-5 py-3">Account type</th>
                      <th className="px-5 py-3">Offices</th>
                      <th className="px-5 py-3">Department</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {people.map((p) => (
                      <tr key={p.id} className={p.is_active ? 'hover:bg-gray-50' : 'bg-gray-50/60 text-gray-400'}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={p.name} size="sm" />
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900 truncate">{p.name} {p.id === user?.id && <span className="text-xs font-normal text-gray-400">(you)</span>}</p>
                              <p className="text-xs text-gray-500 truncate">{p.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1 items-center">
                            <Badge tone={TYPE_TONE[p.role_id]}>{p.account_type}</Badge>
                            {!p.is_active && <Badge tone="red">Deactivated</Badge>}
                            {p.role_id === 2 && p.permissions.map((perm) => (
                              <Badge key={perm} tone="indigo" title={PERMISSIONS[perm]?.description}>{PERMISSIONS[perm]?.label || perm}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {p.offices.length === 0 ? <span className="text-gray-400">—</span> : (
                            <div className="flex flex-col gap-0.5">
                              {p.offices.map((o) => (
                                <span key={o.id} className="text-xs">
                                  <span className="font-semibold text-gray-800">{o.name}</span>
                                  <span className="text-gray-500"> · {o.is_head ? 'Head' : (o.position || 'Officer')}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-600">{p.department_name || <span className="text-gray-400">—</span>}</td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-3 text-xs font-semibold whitespace-nowrap">
                            <button onClick={() => setEditing(p)} className="text-indigo-600 hover:underline">Edit</button>
                            <button onClick={() => sendLink(p)} className="text-gray-600 hover:underline" title="Create a new set-password link">Setup link</button>
                            {p.id !== user?.id && (p.is_active
                              ? <button onClick={() => setDeactivating(p)} className="text-red-600 hover:underline">Deactivate</button>
                              : <button onClick={() => reactivate(p)} className="text-green-700 hover:underline">Reactivate</button>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'import' && (
        <ImportPanel askCode={setCodeFor} showToast={(t, m) => toast.current(t, m)} onDone={() => { loadPeople(); setTab('people'); }} />
      )}

      {tab === 'departments' && (
        <DepartmentsPanel departments={departments} reload={loadLists} showToast={(t, m) => toast.current(t, m)} />
      )}

      {editing && (
        <PersonDialog person={editing} me={user} departments={departments} offices={offices}
          onClose={() => setEditing(null)} askCode={setCodeFor}
          onSaved={(link) => { setEditing(null); loadPeople(); if (link) setNewLink(link); }}
          showToast={(t, m) => toast.current(t, m)} />
      )}

      {deactivating && (
        <DeactivateDialog person={deactivating} people={people} onClose={() => setDeactivating(null)}
          onDone={(msg) => { setDeactivating(null); toast.current('success', msg); loadPeople(); }} />
      )}

      {codeFor && (
        <AdminCodeDialog action={codeFor.action} onClose={() => setCodeFor(null)}
          onConfirm={async (code) => { await codeFor.run(code); setCodeFor(null); }} />
      )}

      {newLink && (
        <Modal title={`Account ready for ${newLink.name}`} onClose={() => setNewLink(null)}
          footer={<Button onClick={() => setNewLink(null)}>Done</Button>}>
          <p className="text-sm text-gray-600 mb-3">
            Email is not set up on this server, so send this link to them yourself. It lets them choose a password and works for 24 hours.
          </p>
          <div className="flex gap-2">
            <input readOnly value={newLink.link} className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.target.select()} aria-label="Set-password link" />
            <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(newLink.link); toast.current('success', 'Link copied.'); }}>Copy</Button>
          </div>
        </Modal>
      )}
    </div>
  );
};

/** Add a person, or edit one. Account type and permission changes ask for the verification code. */
const PersonDialog = ({ person, me, departments, offices, onClose, onSaved, askCode, showToast }) => {
  const isNew = !person.id;
  const [form, setForm] = useState({
    name: person.name || '',
    email: person.email || '',
    role_id: person.role_id || 1,
    department_id: person.department_id || '',
    permissions: person.permissions && person.role_id === 2 ? person.permissions : [],
    office_id: '',
    position_id: '',
  });
  const [saving, setSaving] = useState(false);
  const isSelf = person.id === me?.id;
  const canMakeAdmins = isAdministrator(me);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const office = offices.find((o) => String(o.id) === String(form.office_id));

  const sensitive = isNew
    ? form.role_id === 3 || (form.role_id === 2 && form.permissions.length > 0)
    : form.role_id !== person.role_id
      || (form.role_id === 2 && JSON.stringify([...form.permissions].sort()) !== JSON.stringify([...(person.role_id === 2 ? person.permissions : [])].sort()));

  const save = async (code) => {
    const body = {
      name: form.name,
      role_id: Number(form.role_id),
      department_id: form.department_id || null,
      permissions: Number(form.role_id) === 2 ? form.permissions : [],
      ...(code ? { otp: code } : {}),
    };
    if (isNew) {
      Object.assign(body, { email: form.email, office_id: form.office_id || null, position_id: form.position_id || null });
      const r = await api.post('/people', body);
      showToast('success', r.data.message);
      onSaved(r.data.setPasswordLink ? { name: form.name, link: r.data.setPasswordLink } : null);
    } else {
      const r = await api.put(`/people/${person.id}`, body);
      showToast('success', r.data.message);
      onSaved(null);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (sensitive) {
      askCode({ action: isNew ? `Create an account for ${form.name || 'this person'}` : `Change ${person.name}'s access`, run: save });
      return;
    }
    setSaving(true);
    try { await save(); } catch (err) { showToast('error', errorText(err, 'Could not save.')); } finally { setSaving(false); }
  };

  const togglePermission = (key) => set({
    permissions: form.permissions.includes(key) ? form.permissions.filter((p) => p !== key) : [...form.permissions, key],
  });

  return (
    <Modal title={isNew ? 'Add a person' : `Edit ${person.name}`}
      subtitle={isNew ? 'They will get a link to choose their own password.' : person.email}
      onClose={onClose} wide
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving || !form.name || (isNew && !form.email)}>{saving ? 'Saving…' : isNew ? 'Add person' : 'Save changes'}</Button>
      </>}>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Full name">
          <input required value={form.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Email">
          <input required type="email" value={form.email} disabled={!isNew} onChange={(e) => set({ email: e.target.value })} className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-500`} />
        </Field>
        <Field label="Account type" hint={isSelf ? 'You cannot change your own account type.' : 'Students submit requests. Staff review them. Administrators can do everything.'}>
          <select value={form.role_id} disabled={isSelf} onChange={(e) => set({ role_id: Number(e.target.value) })} className={inputClass}>
            {Object.entries(ACCOUNT_TYPES).map(([id, name]) => (
              <option key={id} value={id} disabled={Number(id) === 3 && !canMakeAdmins && person.role_id !== 3}>{name}</option>
            ))}
          </select>
        </Field>
        <Field label="Department" hint="Used by steps that go to the student's department.">
          <select value={form.department_id || ''} onChange={(e) => set({ department_id: e.target.value })} className={inputClass}>
            <option value="">None</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>

        {isNew && Number(form.role_id) !== 1 && (
          <>
            <Field label="Office (optional)">
              <select value={form.office_id} onChange={(e) => set({ office_id: e.target.value, position_id: '' })} className={inputClass}>
                <option value="">Not in an office yet</option>
                {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="Position">
              <select value={form.position_id} disabled={!office} onChange={(e) => set({ position_id: e.target.value })} className={inputClass}>
                <option value="">Officer</option>
                {(office?.positions || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </>
        )}

        {Number(form.role_id) === 2 && (
          <div className="md:col-span-2">
            <p className="text-sm font-semibold text-gray-700 mb-2">Permissions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(PERMISSIONS).map(([key, def]) => (
                <label key={key} className={`flex gap-3 p-3 border rounded-lg cursor-pointer ${form.permissions.includes(key) ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'} ${isSelf ? 'opacity-60 cursor-not-allowed' : ''}`}>
                  <input type="checkbox" className="mt-1" disabled={isSelf} checked={form.permissions.includes(key)} onChange={() => togglePermission(key)} />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">{def.label}</span>
                    <span className="block text-xs text-gray-500">{def.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {Number(form.role_id) === 3 && (
          <p className="md:col-span-2 text-sm text-purple-800 bg-purple-50 border border-purple-100 rounded-lg p-3">
            Administrators have every permission.
          </p>
        )}
        {!isNew && person.offices?.length > 0 && (
          <p className="md:col-span-2 text-xs text-gray-500">
            Offices: {person.offices.map((o) => `${o.name} (${o.is_head ? 'Head' : o.position || 'Officer'})`).join(', ')}. Change these on the Offices page.
          </p>
        )}
        {sensitive && <p className="md:col-span-2 text-xs text-amber-700">Changing access asks for a verification code sent to your email.</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
};

/** Deactivate an account. If documents are waiting on them, pick who takes them over. */
const DeactivateDialog = ({ person, people, onClose, onDone }) => {
  const [pending, setPending] = useState(null);
  const [reassignTo, setReassignTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post(`/people/${person.id}/deactivate`, reassignTo ? { reassign_to: Number(reassignTo) } : {});
      onDone(r.data.message);
    } catch (err) {
      if (err.response?.status === 409 && err.response.data.pending) setPending(err.response.data.pending);
      setError(errorText(err, 'Could not deactivate.'));
    } finally {
      setBusy(false);
    }
  };

  const candidates = people.filter((p) => p.id !== person.id && p.role_id !== 1 && p.is_active);
  return (
    <Modal title={`Deactivate ${person.name}?`} subtitle="They will be signed out and cannot sign in again until reactivated. Their history is kept."
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={go} disabled={busy || (pending && !reassignTo)}>{busy ? 'Working…' : 'Deactivate'}</Button>
      </>}>
      {pending ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">These documents are waiting on {person.name}:</p>
          <ul className="text-sm list-disc pl-5 text-gray-600">{pending.map((d) => <li key={d.id}>{d.title}</li>)}</ul>
          <Field label="Hand them over to">
            <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className={inputClass}>
              <option value="">Choose someone…</option>
              {candidates.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
            </select>
          </Field>
          <p className="text-xs text-gray-500">Office documents they had claimed go back to the office queue.</p>
        </div>
      ) : (
        <p className="text-sm text-gray-600">Any office documents they had claimed go back to the office queue.</p>
      )}
      {error && !pending && <p className="text-sm text-red-600 mt-3">{error}</p>}
    </Modal>
  );
};

/** CSV import: check every row first, then create the valid ones. */
const ImportPanel = ({ askCode, showToast, onDone }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api.post('/people/import/preview', form);
      setPreview(r.data);
    } catch (err) {
      showToast('error', errorText(err, 'Could not read the file.'));
    } finally {
      setBusy(false);
    }
  };

  const valid = (preview || []).filter((r) => r.isValid);
  const commit = () => askCode({
    action: `Import ${valid.length} ${valid.length === 1 ? 'person' : 'people'}`,
    run: async (code) => {
      const r = await api.post('/people/import/commit', { rows: valid, otp: code });
      showToast('success', r.data.message);
      setPreview(null);
      setFile(null);
      onDone();
    },
  });

  const template = 'Name,Email,Type,Department,Office,Position\nLidya Tesfaye,lidya@example.com,Student,Computer Science,,\nSamuel Bekele,samuel@example.com,Staff,,Registrar\'s Office,Records Officer\n';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="font-bold text-gray-900">Upload a CSV file</h3>
          <p className="text-sm text-gray-500 mt-1">Columns: <span className="font-mono text-xs">Name, Email, Type, Department, Office, Position</span>. Type is Student, Staff or Administrator. Department, Office and Position are optional.</p>
        </div>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="people-template.csv" className="text-sm text-indigo-600 font-semibold hover:underline">Download a template</a>
        <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files[0] || null); setPreview(null); }}
          className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-semibold" />
        <Button onClick={check} disabled={!file || busy} className="w-full">{busy ? 'Checking…' : 'Check the file'}</Button>
        <p className="text-xs text-gray-500">Nothing is created until you confirm. Everyone imported gets an email with a link to set their password.</p>
      </Card>

      <div className="lg:col-span-2">
        {!preview ? (
          <EmptyState>Choose a file and check it to see each row here before anything is imported.</EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
              <p className="text-sm text-gray-700">
                <span className="font-semibold text-green-700">{valid.length} ready</span>
                {preview.length - valid.length > 0 && <> · <span className="font-semibold text-red-600">{preview.length - valid.length} with problems</span> (skipped)</>}
              </p>
              <Button onClick={commit} disabled={valid.length === 0}>Import {valid.length}</Button>
            </div>
            <div className="overflow-x-auto max-h-[28rem]">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase sticky top-0">
                  <tr><th className="px-4 py-2">Row</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Office</th><th className="px-4 py-2">Result</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.map((r) => (
                    <tr key={r.rowNumber} className={r.isValid ? '' : 'bg-red-50/60'}>
                      <td className="px-4 py-2 text-gray-400">{r.rowNumber}</td>
                      <td className="px-4 py-2">{r.name}</td>
                      <td className="px-4 py-2 text-gray-600">{r.email}</td>
                      <td className="px-4 py-2">{r.type}</td>
                      <td className="px-4 py-2 text-gray-600">{[r.office, r.position].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-4 py-2">{r.isValid ? <Badge tone="green">Ready</Badge> : <span className="text-xs text-red-700">{r.error}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

/** Departments are students' academic departments, used by "student's department" routing. */
const DepartmentsPanel = ({ departments, reload, showToast }) => {
  const [name, setName] = useState('');
  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin/departments', { name });
      showToast('success', `Department "${name}" added.`);
      setName('');
      reload();
    } catch (err) { showToast('error', errorText(err, 'Could not add the department.')); }
  };
  const remove = async (d) => {
    try {
      const r = await api.delete(`/admin/departments/${d.id}`);
      showToast('success', r.data.message);
      reload();
    } catch (err) { showToast('error', errorText(err, 'Could not remove the department.')); }
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="p-5">
        <h3 className="font-bold text-gray-900">Add a department</h3>
        <p className="text-sm text-gray-500 mt-1 mb-4">Academic departments such as Computer Science. Steps can be sent to a reviewer in the student's own department.</p>
        <form onSubmit={add} className="flex gap-2">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Department name" className={inputClass} aria-label="Department name" />
          <Button type="submit">Add</Button>
        </form>
      </Card>
      <Card className="lg:col-span-2 overflow-hidden">
        {departments.length === 0 ? <div className="p-8 text-center text-gray-500">No departments yet.</div> : (
          <ul className="divide-y divide-gray-100">
            {departments.map((d) => (
              <li key={d.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{d.name}</p>
                  <p className="text-xs text-gray-500">{d.people} {d.people === 1 ? 'person' : 'people'}</p>
                </div>
                <button onClick={() => remove(d)} className="text-xs font-semibold text-red-600 hover:underline">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default PeopleManager;
