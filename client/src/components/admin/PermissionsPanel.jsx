import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api';
import { PageHeader, Card, Badge, Avatar } from '../ui';

const TYPES = [
  { name: 'Student', tone: 'blue', text: 'Submits requests from Services and follows them to the end. Sees only their own documents.' },
  { name: 'Staff', tone: 'gray', text: 'Reviews the documents sent to them, to their office or to a position they hold. Can be given any of the permissions below.' },
  { name: 'Administrator', tone: 'purple', text: 'Has every permission. Only an Administrator can make or remove another Administrator.' },
];

/** Account types, the permissions staff can be given, and who holds each one. */
const PermissionsPanel = ({ showToast = () => {}, onOpenPeople }) => {
  const [data, setData] = useState(null);
  const toast = useRef(showToast);
  toast.current = showToast;

  const load = useCallback(async () => {
    try {
      setData((await api.get('/people/permissions')).data);
    } catch (err) {
      toast.current('error', err.response?.data?.message || 'Could not load permissions.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permissions"
        subtitle="Every account has one account type. Staff can also be given individual permissions, so nobody needs full administrator access to do one job."
        actions={onOpenPeople && <button onClick={onOpenPeople} className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Change someone's access</button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TYPES.map((t) => (
          <Card key={t.name} className="p-5">
            <Badge tone={t.tone}>{t.name}</Badge>
            <p className="text-sm text-gray-600 mt-3">{t.text}</p>
          </Card>
        ))}
      </div>

      {!data ? <div className="p-8 text-center text-gray-500">Loading…</div> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {data.permissions.map((p) => (
            <Card key={p.key} className="overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-900">{p.label}</h3>
                <p className="text-sm text-gray-500">{p.description}</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {p.holders.length === 0 && (
                  <li className="px-5 py-3 text-sm text-gray-500">No staff hold this yet. Administrators always can.</li>
                )}
                {p.holders.map((h) => (
                  <li key={h.id} className="px-5 py-3 flex items-center gap-3">
                    <Avatar name={h.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">{h.name}</p>
                      <p className="text-xs text-gray-500 truncate">{h.email}</p>
                    </div>
                    <p className="text-xs text-gray-400 text-right">
                      {h.granted_by_name ? `Given by ${h.granted_by_name}` : 'Given'}<br />{new Date(h.granted_at).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          <Card className="overflow-hidden lg:col-span-2">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Administrators</h3>
              <p className="text-sm text-gray-500">Full access to everything.</p>
            </div>
            <div className="p-5 flex flex-wrap gap-3">
              {data.administrators.map((a) => (
                <div key={a.id} className="flex items-center gap-2 bg-purple-50 border border-purple-100 rounded-full pl-1 pr-3 py-1">
                  <Avatar name={a.name} size="sm" />
                  <span className="text-sm font-semibold text-purple-900">{a.name}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default PermissionsPanel;
