import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';

/**
 * Offices, their heads and officers.
 *  mode="admin": create offices, appoint heads, remove offices, and manage everyone.
 *  mode="mine":  the offices I work in. Heads add or remove officers and set who covers for whom.
 */
const OfficeManager = ({ mode = 'admin', showToast = () => {} }) => {
  const [offices, setOffices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newOffice, setNewOffice] = useState({ name: '', description: '', head_id: '' });
  const [addingTo, setAddingTo] = useState({});
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
    } catch (err) {
      toast.current('error', err.response?.data?.message || 'Something went wrong.');
    }
  };

  const createOffice = (e) => {
    e.preventDefault();
    run(() => api.post('/offices', newOffice), `Office "${newOffice.name}" created.`).then(() =>
      setNewOffice({ name: '', description: '', head_id: '' }));
  };

  const nameOf = (id) => staff.find((s) => s.id === id)?.name || '—';

  if (loading) return <div className="p-8 text-center text-gray-500">Loading offices…</div>;

  return (
    <div className="space-y-6">
      {isAdmin && (
        <form onSubmit={createOffice} className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-5">
          <h3 className="font-bold text-gray-900">New office</h3>
          <p className="text-sm text-gray-500 mb-4">Create an office such as Registrar or Library and appoint its head. The head then manages their own officers.</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input required value={newOffice.name} onChange={(e) => setNewOffice({ ...newOffice, name: e.target.value })}
              placeholder="Office name" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <input value={newOffice.description} onChange={(e) => setNewOffice({ ...newOffice, description: e.target.value })}
              placeholder="What it handles (optional)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm md:col-span-2" />
            <select value={newOffice.head_id} onChange={(e) => setNewOffice({ ...newOffice, head_id: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">Head of office…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button type="submit" className="mt-3 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700">Create office</button>
        </form>
      )}

      {offices.length === 0 && (
        <div className="p-10 text-center text-gray-500 border border-dashed border-gray-200 rounded-xl">
          {isAdmin ? 'No offices yet. Create the first one above.' : 'You are not part of any office yet.'}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {offices.map((o) => {
          const canManage = isAdmin || o.i_am_head;
          const people = [
            ...(o.head_id ? [{ id: o.head_id, name: o.head_name, is_out_of_office: o.head_out_of_office, delegate_id: o.head_delegate_id, isHead: true }] : []),
            ...o.members.filter((m) => m.id !== o.head_id),
          ];
          const candidates = staff.filter((s) => !people.some((p) => p.id === s.id));
          return (
            <div key={o.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">{o.name}</h3>
                  {o.description && <p className="text-sm text-gray-500">{o.description}</p>}
                  <p className="text-xs text-gray-500 mt-1">
                    <span className="font-semibold text-gray-700">{o.waiting}</span> waiting · <span className="font-semibold text-amber-700">{o.unclaimed}</span> unclaimed
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex flex-col items-end gap-2">
                    <select value={o.head_id || ''} title="Head of office"
                      onChange={(e) => run(() => api.put(`/offices/${o.id}`, { head_id: e.target.value || null }), 'Head of office updated.')}
                      className="text-xs px-2 py-1 border border-gray-300 rounded bg-white">
                      <option value="">No head</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>Head: {s.name}</option>)}
                    </select>
                    <button onClick={() => run(() => api.delete(`/offices/${o.id}`))} className="text-xs text-red-600 hover:underline">Remove office</button>
                  </div>
                )}
              </div>

              <ul className="divide-y divide-gray-100">
                {people.length === 0 && <li className="px-5 py-4 text-sm text-gray-500">No officers yet.</li>}
                {people.map((p) => (
                  <li key={p.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[10rem]">
                      <p className="text-sm font-semibold text-gray-900">
                        {p.name}
                        <span className={`ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${p.isHead ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>{p.isHead ? 'Head' : 'Officer'}</span>
                      </p>
                      <p className={`text-xs ${p.is_out_of_office ? 'text-amber-700' : 'text-green-700'}`}>
                        {p.is_out_of_office ? `Away · covered by ${p.delegate_id ? nameOf(p.delegate_id) : 'nobody'}` : 'In office'}
                      </p>
                    </div>
                    {canManage && (
                      <>
                        <select
                          value={p.is_out_of_office ? String(p.delegate_id || '') : 'in'}
                          onChange={(e) => {
                            const v = e.target.value;
                            run(() => api.put(`/offices/${o.id}/cover/${p.id}`, v === 'in'
                              ? { is_out_of_office: false }
                              : { is_out_of_office: true, delegate_id: v ? parseInt(v, 10) : null }));
                          }}
                          className="text-xs px-2 py-1 border border-gray-300 rounded bg-white" title="Who covers while away">
                          <option value="in">In office</option>
                          <option value="">Away, no cover</option>
                          {people.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>Away, covered by {x.name}</option>)}
                        </select>
                        {!p.isHead && (
                          <button onClick={() => run(() => api.delete(`/offices/${o.id}/members/${p.id}`), `${p.name} removed.`)}
                            className="text-xs text-red-600 hover:underline">Remove</button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>

              {canManage && (
                <div className="px-5 py-3 bg-gray-50 flex gap-2">
                  <select value={addingTo[o.id] || ''} onChange={(e) => setAddingTo({ ...addingTo, [o.id]: e.target.value })}
                    className="flex-1 text-sm px-2 py-1.5 border border-gray-300 rounded bg-white">
                    <option value="">Add an officer…</option>
                    {candidates.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.email})</option>)}
                  </select>
                  <button disabled={!addingTo[o.id]}
                    onClick={() => run(() => api.post(`/offices/${o.id}/members`, { user_id: parseInt(addingTo[o.id], 10) }), 'Officer added.').then(() => setAddingTo({ ...addingTo, [o.id]: '' }))}
                    className="px-3 py-1.5 text-sm font-semibold rounded bg-indigo-600 text-white disabled:opacity-40">Add</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OfficeManager;
