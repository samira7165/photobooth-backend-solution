'use client';

import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import SubmissionDetailModal from '@/components/SubmissionDetailModal';
import TableSkeleton from '@/components/TableSkeleton';
import EmptyState from '@/components/EmptyState';
import useCurrentUser from '@/lib/useCurrentUser';
import { hasRole, formatDate, truncateId, resolveImageUrl, resultExtension, downloadFile, printImageUrl } from '@/lib/utils';

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
  const [downloadingId, setDownloadingId] = useState(null);
  const [printingId, setPrintingId] = useState(null);

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

  const handleDownload = async (s, e) => {
    e.stopPropagation();
    setDownloadingId(s.id);
    try {
      await downloadFile(resolveImageUrl(s.resultUrl), `${s.id}-result${resultExtension(s.resultUrl)}`);
    } catch (err) {
      alert(err.message || 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  // Backend is the source of truth for "already printed" — this calls
  // PATCH /submissions/:id/print FIRST and only opens the actual browser
  // print dialog if that claim succeeds, so a duplicate click (or someone
  // else printing the same submission from a different browser/booth a
  // moment earlier) can't trigger a second physical print. printImageUrl()
  // itself has no idea whether anything was ever printed before — the
  // recorded printStatus on the submission is what makes that true after a
  // refresh, in a different browser, or from a different booth.
  const handlePrint = async (s, e) => {
    e.stopPropagation();
    setPrintingId(s.id);
    try {
      const res = await api.patch(`/submissions/${s.id}/print`);
      if (res.data.alreadyPrinted) {
        alert(res.data.message || 'This image has already been printed.');
      } else {
        printImageUrl(resolveImageUrl(s.resultUrl));
      }
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to record print');
    } finally {
      setPrintingId(null);
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
        <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">ID</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Campaign</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">User</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Status</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Mode</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Code</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Created At</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton columns={8} widths={['w-16', 'w-32', 'w-28', 'w-20', 'w-14', 'w-20', 'w-36', 'w-12']} />
              ) : submissions.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={Camera}
                      title="No submissions found"
                      description={
                        campaignFilter !== 'All' || statusFilter !== 'All'
                          ? 'Nothing matches the current filters.'
                          : 'Submissions will appear here once a booth starts receiving photos.'
                      }
                      action={
                        (campaignFilter !== 'All' || statusFilter !== 'All') && (
                          <button
                            onClick={() => {
                              setCampaignFilter('All');
                              setStatusFilter('All');
                              setPage(0);
                            }}
                            className="text-xs border border-white/10 hover:bg-white/5 text-gray-300 rounded-lg px-3 py-1.5 transition-colors"
                          >
                            Clear filters
                          </button>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : (
                submissions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className="border-b border-white/10 last:border-0 hover:bg-white/5 cursor-pointer"
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
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">{s.displayCode || s.downloadCode || '—'}</td>
                    <td className="px-5 py-3 text-gray-400">{formatDate(s.createdAt)}</td>
                    <td className="px-5 py-3 text-right space-x-2 whitespace-nowrap">
                      {s.status === 'COMPLETED' && s.resultUrl && (
                        <>
                          <button
                            onClick={(e) => handleDownload(s, e)}
                            disabled={downloadingId === s.id}
                            className="text-xs border border-white/10 hover:bg-white/5 disabled:opacity-50 text-gray-300 rounded-lg px-2.5 py-1 transition-colors"
                          >
                            {downloadingId === s.id ? 'Downloading…' : 'Download'}
                          </button>
                          {s.printStatus === 'PRINTED' ? (
                            <span
                              title={s.printedAt ? `Printed ${formatDate(s.printedAt)}` : undefined}
                              className="text-xs text-gray-500 border border-white/10 rounded-lg px-2.5 py-1 inline-block cursor-default"
                            >
                              Already Printed
                            </span>
                          ) : (
                            <button
                              onClick={(e) => handlePrint(s, e)}
                              disabled={printingId === s.id}
                              className="text-xs border border-white/10 hover:bg-white/5 disabled:opacity-50 text-gray-300 rounded-lg px-2.5 py-1 transition-colors"
                            >
                              {printingId === s.id ? 'Printing…' : 'Print'}
                            </button>
                          )}
                        </>
                      )}
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
