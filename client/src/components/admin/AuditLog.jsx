import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api';
import { PageHeader, Card, Button, inputClass, EmptyState } from '../ui';

/** The full audit trail, searchable by action, person or document and by date, with CSV export. */
const AuditLog = ({ showToast = () => {} }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', startDate: '', endDate: '' });
  const [exporting, setExporting] = useState(false);
  const toast = useRef(showToast);
  toast.current = showToast;

  const params = useCallback(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), [filters]);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setLogs((await api.get('/admin/audit-logs', { params: params() })).data);
      } catch (err) {
        toast.current('error', err.response?.data?.message || 'Could not load the audit log.');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [params]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get('/admin/audit-logs/export', { params: params(), responseType: 'text' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'Eflow_Audit_Log.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.current('success', 'Audit log exported.');
    } catch {
      toast.current('error', 'Could not export the audit log.');
    } finally {
      setExporting(false);
    }
  };

  const filtered = filters.search || filters.startDate || filters.endDate;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        subtitle="Every sign-in, approval, change of access and workflow edit, newest first."
        actions={<Button variant="secondary" onClick={exportCsv} disabled={exporting}>{exporting ? 'Preparing…' : filtered ? 'Export these as CSV' : 'Export all as CSV'}</Button>}
      />

      <Card className="p-4 flex flex-col md:flex-row gap-3">
        <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search actions, people or documents" aria-label="Search the audit log" className={`${inputClass} md:flex-1`} />
        <label className="flex items-center gap-2 text-sm text-gray-600">From
          <input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} className={inputClass} />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">To
          <input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} className={inputClass} />
        </label>
      </Card>

      {loading ? <div className="p-8 text-center text-gray-500">Loading…</div> : logs.length === 0 ? (
        <EmptyState>No entries match.</EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">When</th>
                  <th className="px-5 py-3">Who</th>
                  <th className="px-5 py-3">What happened</th>
                  <th className="px-5 py-3">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 align-top">
                    <td className="px-5 py-3 whitespace-nowrap text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-800">{log.user_name || 'System'}</td>
                    <td className="px-5 py-3 text-gray-900">{log.action}</td>
                    <td className="px-5 py-3 text-gray-600">{log.document_title || <span className="text-gray-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {logs.length >= 300 && <p className="px-5 py-3 text-xs text-gray-500 border-t border-gray-100">Showing the latest 300. Narrow the search or export to see more.</p>}
        </Card>
      )}
    </div>
  );
};

export default AuditLog;
