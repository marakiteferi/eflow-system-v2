import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import { Card, Badge, Button, inputClass, EmptyState, Avatar } from './ui';

/**
 * Offices, their heads, positions and officers.
 *  mode="admin": create offices, appoint heads, remove offices, and manage every office.
 *  mode="mine":  the offices I work in. Heads manage positions, officers and who covers for whom.
 */
const OfficeManager = ({ mode = 'admin', showToast = () => {} }) => {
  const [offices, setOffices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newOffice, setNewOffice] = useState({ name: '', description: '', head_id: '' });
  const isAdmin = mode === 'admin';
  // The parent recreates showToast on every render; keep the latest without reloading
  const toast = useRef(showToast);
  toast.current = showToast;

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([
        api.get(isAdmin ? '/offices' : '/offices/mine'),
        api.get('/offices/staff-directory'),
      ]);
      setOffices(o.data);
      setStaff(s.data);
    } catch (err) {
      toast.current('error', err.response?.data?.message || 'Could not load offices.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, success) => {
    try {
      const res = await fn();
      toast.current('success', success || res.data?.message || 'Saved.');
      await load();
      return true;
    } catch (err) {
      toast.current('error', err.response?.data?.message || 'Something went wrong.');
      return false;
    }
  };

  const createOffice = async (e) => {
    e.preventDefault();
    if (await run(() => api.post('/offices', newOffice), `Office "${newOffice.name}" created.`)) {
      setNewOffice({ name: '', description: '', head_id: '' });
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading offices…</div>;

  return (
    <div className="space-y-6">
      {isAdmin && (
        <Card className="p-5 bg-gradient-to-br from-indigo-50/80 to-white">
          <form onSubmit={createOffice}>
            <h3 className="font-bold text-gray-900">New office</h3>
            <p className="text-sm text-gray-500 mb-4">Create an office such as Registrar or Library and appoint its head. The head then sets up positions and officers.</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input required value={newOffice.name} onChange={(e) => setNewOffice({ ...newOffice, name: e.target.value })}
                placeholder="Office name" aria-label="Office name" className={inputClass} />
              <input value={newOffice.description} onChange={(e) => setNewOffice({ ...newOffice, description: e.target.value })}
                placeholder="What it handles (optional)" aria-label="Description" className={`${inputClass} md:col-span-2`} />
              <select value={newOffice.head_id} onChange={(e) => setNewOffice({ ...newOffice, head_id: e.target.value })} aria-label="Head of office" className={inputClass}>
                <option value="">Head of office…</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <Button type="submit" className="mt-3">Create office</Button>
          </form>
        </Card>
      )}

      {offices.length === 0 && (
        <EmptyState>{isAdmin ? 'No offices yet. Create the first one above.' : 'You are not part of any office yet.'}</EmptyState>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {offices.map((o) => (
          <OfficeCard key={o.id} office={o} staff={staff} isAdmin={isAdmin} canManage={isAdmin || o.i_am_head} run={run} />
        ))}
      </div>
    </div>
  );
};

const OfficeCard = ({ office: o, staff, isAdmin, canManage, run }) => {
  const [adding, setAdding] = useState({ user_id: '', position_id: '' });
  const [newPosition, setNewPosition] = useState({ name: '', reports_to_id: '' });
  const people = [
    ...(o.head_id ? [{ id: o.head_id, name: o.head_name, email: o.head_email, is_out_of_office: o.head_out_of_office, delegate_id: o.head_delegate_id, isHead: true }] : []),
    ...o.members.filter((m) => m.id !== o.head_id),
  ];
  const nameOf = (id) => people.find((p) => p.id === id)?.name || staff.find((s) => s.id === id)?.name || 'someone';
  const candidates = staff.filter((s) => !people.some((p) => p.id === s.id));
  const positions = o.positions || [];

  const addPosition = async (e) => {
    e.preventDefault();
    if (await run(() => api.post(`/offices/${o.id}/positions`, { name: newPosition.name, reports_to_id: newPosition.reports_to_id || null }), `Position "${newPosition.name}" added.`)) {
      setNewPosition({ name: '', reports_to_id: '' });
    }
  };

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-gray-900 text-lg">{o.name}</h3>
          {o.description && <p className="text-sm text-gray-500">{o.description}</p>}
          <div className="flex gap-2 mt-2">
            <Badge tone="indigo">{o.waiting} waiting</Badge>
            <Badge tone={o.unclaimed ? 'amber' : 'gray'}>{o.unclaimed} unclaimed</Badge>
            <Badge>{people.length} {people.length === 1 ? 'person' : 'people'}</Badge>
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-col items-end gap-2">
            <select value={o.head_id || ''} aria-label="Head of office"
              onChange={(e) => run(() => api.put(`/offices/${o.id}`, { head_id: e.target.value || null }), 'Head of office updated.')}
              className="text-xs px-2 py-1 border border-gray-300 rounded-lg bg-white max-w-[12rem]">
              <option value="">No head</option>
              {staff.map((s) => <option key={s.id} value={s.id}>Head: {s.name}</option>)}
            </select>
            <button onClick={() => run(() => api.delete(`/offices/${o.id}`))} className="text-xs text-red-600 hover:underline">Remove office</button>
          </div>
        )}
      </div>

      {/* Positions and who they report to */}
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Positions</p>
        {positions.length === 0 && <p className="text-sm text-gray-500">No positions yet. Every officer can take any office step.</p>}
        <ul className="space-y-2">
          {positions.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-gray-900">{p.name}</span>
              <span className="text-xs text-gray-500">{p.holders} {p.holders === 1 ? 'holder' : 'holders'}</span>
              {canManage ? (
                <select value={p.reports_to_id || ''} aria-label={`${p.name} reports to`}
                  onChange={(e) => run(() => api.put(`/offices/${o.id}/positions/${p.id}`, { reports_to_id: e.target.value || null }), 'Reporting line updated.')}
                  className="text-xs px-2 py-1 border border-gray-300 rounded bg-white ml-auto">
                  <option value="">Reports to the head</option>
                  {positions.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>Reports to {x.name}</option>)}
                </select>
              ) : (
                <span className="text-xs text-gray-500 ml-auto">Reports to {p.reports_to_name || 'the head'}</span>
              )}
              {canManage && (
                <button onClick={() => run(() => api.delete(`/offices/${o.id}/positions/${p.id}`))} className="text-xs text-red-600 hover:underline">Remove</button>
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          <form onSubmit={addPosition} className="flex flex-col sm:flex-row gap-2 mt-3">
            <input required value={newPosition.name} onChange={(e) => setNewPosition({ ...newPosition, name: e.target.value })}
              placeholder="New position, e.g. Deputy or Cashier" aria-label="New position name" className={`${inputClass} sm:flex-1`} />
            <select value={newPosition.reports_to_id} onChange={(e) => setNewPosition({ ...newPosition, reports_to_id: e.target.value })} aria-label="Reports to" className={`${inputClass} sm:w-48`}>
              <option value="">Reports to the head</option>
              {positions.map((x) => <option key={x.id} value={x.id}>Reports to {x.name}</option>)}
            </select>
            <Button type="submit" variant="secondary">Add</Button>
          </form>
        )}
        {positions.length > 0 && <p className="text-xs text-gray-500 mt-2">Late work goes to the position it reports to, then to the head.</p>}
      </div>

      {/* People */}
      <ul className="divide-y divide-gray-100 flex-1">
        {people.length === 0 && <li className="px-5 py-4 text-sm text-gray-500">No officers yet.</li>}
        {people.map((p) => (
          <li key={p.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
            <Avatar name={p.name} size="sm" />
            <div className="flex-1 min-w-[10rem]">
              <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                {p.name}
                {p.isHead ? <Badge tone="indigo">Head</Badge> : <Badge>{p.position_name || 'Officer'}</Badge>}
              </p>
              <p className={`text-xs ${p.is_out_of_office ? 'text-amber-700' : 'text-green-700'}`}>
                {p.is_out_of_office ? `Away · covered by ${p.delegate_id ? nameOf(p.delegate_id) : 'nobody'}` : 'In office'}
              </p>
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                {!p.isHead && positions.length > 0 && (
                  <select value={p.position_id || ''} aria-label={`${p.name}'s position`}
                    onChange={(e) => run(() => api.put(`/offices/${o.id}/members/${p.id}`, { position_id: e.target.value || null }))}
                    className="text-xs px-2 py-1 border border-gray-300 rounded bg-white">
                    <option value="">Officer</option>
                    {positions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                )}
                <select value={p.is_out_of_office ? String(p.delegate_id || '') : 'in'} aria-label={`Cover for ${p.name}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    run(() => api.put(`/offices/${o.id}/cover/${p.id}`, v === 'in'
                      ? { is_out_of_office: false }
                      : { is_out_of_office: true, delegate_id: v ? parseInt(v, 10) : null }));
                  }}
                  className="text-xs px-2 py-1 border border-gray-300 rounded bg-white">
                  <option value="in">In office</option>
                  <option value="">Away, no cover</option>
                  {people.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>Away, covered by {x.name}</option>)}
                </select>
                {!p.isHead && (
                  <button onClick={() => run(() => api.delete(`/offices/${o.id}/members/${p.id}`), `${p.name} removed.`)}
                    className="text-xs text-red-600 hover:underline">Remove</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row gap-2">
          <select value={adding.user_id} onChange={(e) => setAdding({ ...adding, user_id: e.target.value })} aria-label="Add an officer"
            className={`${inputClass} sm:flex-1`}>
            <option value="">Add an officer…</option>
            {candidates.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.email})</option>)}
          </select>
          {positions.length > 0 && (
            <select value={adding.position_id} onChange={(e) => setAdding({ ...adding, position_id: e.target.value })} aria-label="Position" className={`${inputClass} sm:w-44`}>
              <option value="">As officer</option>
              {positions.map((x) => <option key={x.id} value={x.id}>As {x.name}</option>)}
            </select>
          )}
          <Button disabled={!adding.user_id}
            onClick={async () => {
              const ok = await run(() => api.post(`/offices/${o.id}/members`, { user_id: parseInt(adding.user_id, 10), position_id: adding.position_id || null }), 'Officer added.');
              if (ok) setAdding({ user_id: '', position_id: '' });
            }}>Add</Button>
        </div>
      )}
    </Card>
  );
};

export default OfficeManager;
