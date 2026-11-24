import { useState, useEffect } from 'react';
import api from '../../api';
import { Card } from '../ui';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

const STATUS = [
  { key: 'approved', name: 'Approved', color: '#10B981' },
  { key: 'pending', name: 'Pending', color: '#F59E0B' },
  { key: 'rejected', name: 'Rejected', color: '#EF4444' },
];

const Stat = ({ label, value, tone, hint }) => (
  <Card className="p-5">
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
    <p className={`text-3xl font-bold mt-1 ${tone || 'text-gray-900'}`}>{value}</p>
    {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
  </Card>
);

/** System-wide numbers for people with an admin permission, shown on the Dashboard. */
const AdminOverview = () => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/admin/stats').then((r) => setStats(r.data)).catch(() => setStats(false));
  }, []);

  if (!stats) return null;
  const d = stats.documents;
  const pie = STATUS.map((s) => ({ ...s, value: d[s.key] })).filter((s) => s.value > 0);

  return (
    <section className="space-y-4" aria-label="System overview">
      <h2 className="text-lg font-bold text-gray-900">System overview</h2>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Stat label="Documents" value={d.total} hint={`${stats.workflows} workflows`} />
        <Stat label="In review" value={d.pending} tone="text-amber-600" />
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? 'text-red-600' : 'text-gray-900'} hint="Past their step deadline" />
        <Stat label="Approved" value={d.approved} tone="text-green-600" />
        <Stat label="Active accounts" value={stats.users} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-bold text-gray-900 mb-2">Documents by outcome</h3>
          {pie.length === 0 ? <p className="text-sm text-gray-500 py-16 text-center">No documents yet.</p> : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3}>
                    {pie.map((s) => <Cell key={s.key} fill={s.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-gray-900 mb-2">Office queues</h3>
          {stats.offices.length === 0 ? <p className="text-sm text-gray-500 py-16 text-center">No offices yet.</p> : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.offices} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: '#F3F4F6' }} />
                  <Legend />
                  <Bar dataKey="waiting" name="Waiting" fill="#6366F1" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="unclaimed" name="Unclaimed" fill="#F59E0B" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="overdue" name="Overdue" fill="#EF4444" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
};

export default AdminOverview;
