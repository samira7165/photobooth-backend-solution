'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Activity, Camera, AlertTriangle, TrendingUp, TrendingDown, Inbox } from 'lucide-react';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import TableSkeleton from '@/components/TableSkeleton';
import EmptyState from '@/components/EmptyState';
import Toast from '@/components/Toast';
import { getSocket } from '@/lib/socket';
import { formatDate, truncateId } from '@/lib/utils';

const ICON_THEME = {
  blue: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-b-blue-500/40' },
  green: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-b-green-500/40' },
  purple: { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-b-purple-500/40' },
  red: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-b-red-500/40' },
};

function StatCard({ label, value, icon: Icon, theme, loading, change }) {
  const t = ICON_THEME[theme] || ICON_THEME.blue;

  return (
    <div className={`bg-[#111111] border border-white/10 border-b-2 ${t.border} rounded-xl p-5`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${t.bg}`}>
          <Icon size={18} className={t.text} />
        </div>
        {!loading && change && (
          <div
            className={`flex items-center gap-1 text-xs font-medium ${change.direction === 'up' ? 'text-green-400' : 'text-red-400'}`}
          >
            {change.direction === 'up' ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {change.label}
          </div>
        )}
      </div>
      <div className="text-sm text-gray-400">{label}</div>
      {loading ? (
        <div className="h-8 w-16 mt-1.5 rounded bg-white/10 animate-pulse motion-reduce:animate-none" />
      ) : (
        <div className="text-3xl font-semibold mt-1 text-white">{value}</div>
      )}
    </div>
  );
}

// Compares today's count against the most recent prior day that actually
// had activity — a day with zero submissions never appears in the grouped
// timeline at all, so "yesterday" isn't reliably the second-to-last entry;
// looking it up by its actual date avoids quietly comparing against the
// wrong day.
function computeChange(timeline, field) {
  if (!timeline || timeline.length === 0) return null;
  const todayKey = new Date().toISOString().slice(0, 10);
  const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const today = timeline.find((t) => t.period === todayKey)?.[field] ?? 0;
  const yesterday = timeline.find((t) => t.period === yesterdayKey)?.[field] ?? 0;
  if (yesterday === 0) return null; // nothing meaningful to compare against
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct === 0) return null;
  return { direction: pct > 0 ? 'up' : 'down', label: `${pct > 0 ? '+' : ''}${pct}% vs yesterday` };
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({
    totalCampaigns: 0,
    activeCampaigns: 0,
    totalSubmissions: 0,
    failedSubmissions: 0,
  });
  const [timeline, setTimeline] = useState([]);
  const [recentSubmissions, setRecentSubmissions] = useState([]);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [campaignsRes, submissionsRes, failedRes, recentRes, timelineRes] = await Promise.all([
          api.get('/campaigns'),
          api.get('/submissions'),
          api.get('/submissions', { params: { status: 'FAILED' } }),
          api.get('/submissions', { params: { limit: 10 } }),
          // Additive only — day-by-day totals purely to power the "vs
          // yesterday" indicators below; nothing else here depends on it.
          api.get('/analytics/timeline', { params: { groupBy: 'day' } }).catch(() => ({ data: [] })),
        ]);

        if (cancelled) return;

        const campaigns = campaignsRes.data;
        setStats({
          totalCampaigns: campaigns.length,
          activeCampaigns: campaigns.filter((c) => c.status === 'ACTIVE').length,
          totalSubmissions: submissionsRes.data.total,
          failedSubmissions: failedRes.data.total,
        });
        setRecentSubmissions(recentRes.data.submissions);
        setTimeline(timelineRes.data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || 'Failed to load dashboard data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Live updates: a new submission triggers a full reload (cheap — 4 fast
    // queries) plus a toast; a job status change patches just that row so
    // the table doesn't jump/reload on every progress tick.
    const socket = getSocket();

    const onNewSubmission = (data) => {
      setToast({ message: `New submission from ${data.campaignSlug}`, type: 'info' });
      load();
    };

    const onJobUpdate = (data) => {
      setRecentSubmissions((prev) =>
        prev.map((s) => (s.id === data.submissionId ? { ...s, status: data.status } : s)),
      );
    };

    socket.on('admin:new_submission', onNewSubmission);
    socket.on('admin:job_update', onJobUpdate);

    return () => {
      cancelled = true;
      socket.off('admin:new_submission', onNewSubmission);
      socket.off('admin:job_update', onJobUpdate);
    };
  }, []);

  return (
    <DashboardLayout title="Dashboard">
      {toast && (
        <div className="fixed top-5 right-5 z-50">
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Campaigns" value={stats.totalCampaigns} icon={LayoutDashboard} theme="blue" loading={loading} />
        <StatCard label="Active Campaigns" value={stats.activeCampaigns} icon={Activity} theme="green" loading={loading} />
        <StatCard
          label="Total Submissions"
          value={stats.totalSubmissions}
          icon={Camera}
          theme="purple"
          loading={loading}
          change={computeChange(timeline, 'total')}
        />
        <StatCard
          label="Failed Submissions"
          value={stats.failedSubmissions}
          icon={AlertTriangle}
          theme="red"
          loading={loading}
          change={computeChange(timeline, 'failed')}
        />
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-white">Recent Submissions</h2>
          <Link href="/submissions" className="text-sm text-[#2563eb] hover:underline">
            View all →
          </Link>
        </div>

        <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">ID</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Campaign</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">User</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Status</th>
                <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Created At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton columns={5} widths={['w-16', 'w-32', 'w-28', 'w-20', 'w-36']} />
              ) : recentSubmissions.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={Inbox}
                      title="No submissions yet"
                      description="Submissions will show up here as soon as your booth starts receiving photos."
                      action={
                        <Link
                          href="/campaigns"
                          className="text-xs bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors"
                        >
                          View Campaigns
                        </Link>
                      }
                    />
                  </td>
                </tr>
              ) : (
                recentSubmissions.map((s) => (
                  <tr key={s.id} className="border-b border-white/10 last:border-0 hover:bg-white/5">
                    <td className="px-5 py-3 font-mono text-gray-400">{truncateId(s.id)}</td>
                    <td className="px-5 py-3 text-white">{s.campaign?.name || '—'}</td>
                    <td className="px-5 py-3 text-gray-300">
                      {s.userName || s.userPhone || s.userEmail || '—'}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-5 py-3 text-gray-400">{formatDate(s.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
