'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { List, LayoutGrid, FolderOpen } from 'lucide-react';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import TableSkeleton from '@/components/TableSkeleton';
import EmptyState from '@/components/EmptyState';
import { formatDate } from '@/lib/utils';

const STATUS_FILTERS = ['All', 'DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'];
const VIEW_MODE_KEY = 'campaignsViewMode';

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [viewMode, setViewMode] = useState('list');

  // Read the saved view preference only after mount — localStorage isn't
  // available during the server render pass, and guessing wrong here would
  // just cause a flash from the default to the saved value anyway.
  useEffect(() => {
    const saved = typeof window !== 'undefined' && localStorage.getItem(VIEW_MODE_KEY);
    if (saved === 'grid' || saved === 'list') setViewMode(saved);
  }, []);

  const changeViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = statusFilter !== 'All' ? { status: statusFilter } : {};
      const res = await api.get('/campaigns', { params });
      setCampaigns(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const emptyState = (
    <EmptyState
      icon={FolderOpen}
      title="No campaigns found"
      description={statusFilter !== 'All' ? `Nothing matches the "${statusFilter}" filter.` : 'Create your first campaign to get started.'}
      action={
        <Link
          href="/campaigns/create"
          className="text-xs bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors"
        >
          + Create Campaign
        </Link>
      }
    />
  );

  return (
    <DashboardLayout title="Campaigns">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#111111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === 'All' ? 'All statuses' : s}
              </option>
            ))}
          </select>

          <div className="flex items-center bg-[#111111] border border-white/10 rounded-lg p-1">
            <button
              onClick={() => changeViewMode('list')}
              title="List view"
              aria-pressed={viewMode === 'list'}
              className={`p-1.5 rounded-md transition-colors motion-reduce:transition-none ${
                viewMode === 'list' ? 'bg-[#2563eb] text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <List size={16} />
            </button>
            <button
              onClick={() => changeViewMode('grid')}
              title="Grid view"
              aria-pressed={viewMode === 'grid'}
              className={`p-1.5 rounded-md transition-colors motion-reduce:transition-none ${
                viewMode === 'grid' ? 'bg-[#2563eb] text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>

        <Link
          href="/campaigns/create"
          className="bg-[#2563eb] hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
        >
          + Create Campaign
        </Link>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {viewMode === 'grid' ? (
        loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-[#111111] border border-white/10 rounded-xl p-5 space-y-3">
                <div className="h-4 w-2/3 rounded bg-white/10 animate-pulse motion-reduce:animate-none" />
                <div className="h-3 w-1/3 rounded bg-white/10 animate-pulse motion-reduce:animate-none" />
                <div className="h-5 w-20 rounded-full bg-white/10 animate-pulse motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-[#111111] border border-white/10 rounded-xl">{emptyState}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((c) => (
              <button
                key={c.id}
                onClick={() => router.push(`/campaigns/${c.id}`)}
                className="text-left bg-[#111111] border border-white/10 hover:border-white/20 hover:bg-white/[0.03] rounded-xl p-5 transition-colors motion-reduce:transition-none"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-white font-medium truncate">{c.name}</h3>
                  <StatusBadge status={c.status} type="campaign" />
                </div>
                <p className="text-xs text-gray-500 font-mono mb-3 truncate">{c.slug}</p>
                <div className="flex items-center justify-between">
                  <StatusBadge status={c.processingMode} type="mode" />
                  <span className="text-xs text-gray-400">{c._count?.submissions ?? 0} submissions</span>
                </div>
                <p className="text-xs text-gray-500 mt-3">{formatDate(c.createdAt)}</p>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400">
                  <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Name</th>
                  <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Slug</th>
                  <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Status</th>
                  <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Processing Mode</th>
                  <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Submissions</th>
                  <th className="sticky top-0 z-10 bg-[#111111] px-5 py-3 font-medium border-b border-white/10">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton columns={6} widths={['w-32', 'w-28', 'w-20', 'w-16', 'w-10', 'w-24']} />
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{emptyState}</td>
                  </tr>
                ) : (
                  campaigns.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/campaigns/${c.id}`)}
                      className="border-b border-white/10 last:border-0 hover:bg-white/5 cursor-pointer"
                    >
                      <td className="px-5 py-3 text-white font-medium">{c.name}</td>
                      <td className="px-5 py-3 text-gray-400 font-mono">{c.slug}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={c.status} type="campaign" />
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={c.processingMode} type="mode" />
                      </td>
                      <td className="px-5 py-3 text-gray-300">{c._count?.submissions ?? 0}</td>
                      <td className="px-5 py-3 text-gray-400">{formatDate(c.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
