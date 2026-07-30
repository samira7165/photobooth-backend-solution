'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import SubmissionDetailModal from '@/components/SubmissionDetailModal';
import useCurrentUser from '@/lib/useCurrentUser';
import { hasRole, formatDate, truncateId } from '@/lib/utils';

const STATUS_OPTIONS = ['All', 'UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'];
const PAGE_SIZE = 20;

export default function SubmissionsPage() {
  const user = useCurrentUser();
  const canManage = hasRole(user?.role, 'ADMIN');

  const [campaigns, setCampaigns] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [retrying, setRetrying] = useState(null);

  const [campaignFilter, setCampaignFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(0);

  useEffect(() => {
    api.get('/campaigns').then((res) => setCampaigns(res.data)).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (campaignFilter !== 'All') params.campaignId = campaignFilter;
      if (statusFilter !== 'All') params.status = statusFilter;

      const res = await api.get('/submissions', { params });
      setSubmissions(res.data.submissions);
      setTotal(res.data.total);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignFilter, statusFilter, page]);

  const handleRetry = async (id, e) => {
    e.stopPropagation();
    setRetrying(id);
    try {
      await api.patch(`/submissions/${id}/retry`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Retry failed');
    } finally {
      setRetrying(null);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Delete this submission? This cannot be undone.')) return;
    try {
      await api.delete(`/submissions/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete submission');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DashboardLayout title="Submissions">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <select
          value={campaignFilter}
          onChange={(e) => {
            setCampaignFilter(e.target.value);
            setPage(0);
          }}
          className="bg-[#111111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
        >
          <option value="All">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="bg-[#111111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 'All' ? 'All statuses' : s}
            </option>
          ))}
        </select>

        <span className="text-sm text-gray-500 ml-auto">{total} total</span>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-white/10">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">Campaign</th>
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Mode</th>
                <th className="px-5 py-3 font-medium">Created At</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : submissions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-500">
                    No submissions found
                  </td>
                </tr>
              ) : (
                submissions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                  >
                    <td className="px-5 py-3 font-mono text-gray-400">{truncateId(s.id)}</td>
                    <td className="px-5 py-3 text-white">{s.campaign?.name || '—'}</td>
                    <td className="px-5 py-3 text-gray-300">
                      {s.userName || s.userPhone || s.userEmail || '—'}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-5 py-3 text-gray-300">{s.mode}</td>
                    <td className="px-5 py-3 text-gray-400">{formatDate(s.createdAt)}</td>
                    <td className="px-5 py-3 text-right space-x-2 whitespace-nowrap">
                      {canManage && s.status === 'FAILED' && (
                        <button
                          onClick={(e) => handleRetry(s.id, e)}
                          disabled={retrying === s.id}
                          className="text-xs bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-2.5 py-1 transition-colors"
                        >
                          {retrying === s.id ? 'Retrying…' : 'Retry'}
                        </button>
                      )}
                      {canManage && (
                        <button
                          onClick={(e) => handleDelete(s.id, e)}
                          className="text-xs text-red-400 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 text-sm">
          <span className="text-gray-400">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 disabled:opacity-40 hover:bg-white/5"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 disabled:opacity-40 hover:bg-white/5"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <SubmissionDetailModal submission={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
}
