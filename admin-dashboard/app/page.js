'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import { getSocket } from '@/lib/socket';
import { formatDate, truncateId } from '@/lib/utils';

function StatCard({ label, value, icon, accent }) {
  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-400">{label}</div>
          <div className={`text-3xl font-semibold mt-1 ${accent || 'text-white'}`}>{value}</div>
        </div>
        <div className="text-3xl opacity-80">{icon}</div>
      </div>
    </div>
  );
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
  const [recentSubmissions, setRecentSubmissions] = useState([]);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [campaignsRes, submissionsRes, failedRes, recentRes] = await Promise.all([
          api.get('/campaigns'),
          api.get('/submissions'),
          api.get('/submissions', { params: { status: 'FAILED' } }),
          api.get('/submissions', { params: { limit: 10 } }),
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
      setToast(`New submission from ${data.campaignSlug}`);
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

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <DashboardLayout title="Dashboard">
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-[#111111] border border-[#2563eb]/40 text-white text-sm rounded-lg px-4 py-3 shadow-2xl">
          {toast}
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Campaigns" value={loading ? '—' : stats.totalCampaigns} icon="📋" />
        <StatCard
          label="Active Campaigns"
          value={loading ? '—' : stats.activeCampaigns}
          icon="🟢"
          accent="text-green-400"
        />
        <StatCard label="Total Submissions" value={loading ? '—' : stats.totalSubmissions} icon="📸" />
        <StatCard
          label="Failed Submissions"
          value={loading ? '—' : stats.failedSubmissions}
          icon="⚠️"
          accent="text-red-400"
        />
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-white">Recent Submissions</h2>
          <Link href="/submissions" className="text-sm text-[#2563eb] hover:underline">
            View all →
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-white/10">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">Campaign</th>
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : recentSubmissions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-500">
                    No submissions yet
                  </td>
                </tr>
              ) : (
                recentSubmissions.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
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
