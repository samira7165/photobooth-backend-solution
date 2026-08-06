'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import { formatDate } from '@/lib/utils';

const GROUP_BY_OPTIONS = [
  { value: 'hour', label: 'By Hour' },
  { value: 'day', label: 'By Day' },
  { value: 'month', label: 'By Month' },
];

const AUDIT_PAGE_SIZE = 20;

export default function AnalyticsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [groupBy, setGroupBy] = useState('day');

  const [overview, setOverview] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [providerStats, setProviderStats] = useState([]);
  const [campaignStats, setCampaignStats] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [sortKey, setSortKey] = useState('totalSubmissions');
  const [sortDir, setSortDir] = useState('desc');

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    api.get('/campaigns').then((res) => setCampaigns(res.data)).catch(() => setCampaigns([]));
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = campaignId ? { campaignId } : {};
      const [overviewRes, timelineRes, providersRes, campaignStatsRes] = await Promise.all([
        api.get('/analytics/overview', { params }),
        api.get('/analytics/timeline', { params: { ...params, groupBy } }),
        api.get('/analytics/providers', { params }),
        api.get('/analytics/campaigns'),
      ]);
      setOverview(overviewRes.data);
      setTimeline(timelineRes.data);
      setProviderStats(providersRes.data);
      setCampaignStats(campaignId ? campaignStatsRes.data.filter((c) => c.campaignId === campaignId) : campaignStatsRes.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, groupBy]);

  const loadAuditLog = async (page) => {
    setAuditLoading(true);
    try {
      const res = await api.get('/analytics/audit-log', {
        params: { limit: AUDIT_PAGE_SIZE, offset: page * AUDIT_PAGE_SIZE },
      });
      setAuditLogs(res.data.logs);
      setAuditTotal(res.data.total);
      setAuditPage(page);
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (auditOpen && auditLogs.length === 0) loadAuditLog(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditOpen]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get('/analytics/export', {
        params: campaignId ? { campaignId } : {},
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = campaignId ? `photobooth-${campaignId}.xlsx` : 'photobooth-all.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  const sortedCampaignStats = useMemo(() => {
    const sorted = [...campaignStats].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return sorted;
  }, [campaignStats, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <DashboardLayout title="Analytics">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className="bg-[#111111] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
        >
          <option value="">All Campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
        >
          {exporting ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Submissions" value={loading ? '—' : overview?.total} sub={loading ? '' : `${overview?.today.total || 0} today`} />
        <StatCard label="Completion Rate" value={loading ? '—' : `${overview?.completionRate}%`} sub={loading ? '' : `${overview?.completed} completed`} accent="text-green-400" />
        <StatCard label="Avg Processing Time" value={loading ? '—' : `${overview?.avgProcessingTime}ms`} sub={loading ? '' : `${overview?.minProcessingTime}–${overview?.maxProcessingTime}ms range`} accent="text-blue-400" />
        <StatCard label="Total Downloads" value={loading ? '—' : overview?.totalDownloads} sub={loading ? '' : `${overview?.activeCampaigns} active campaigns`} />
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl p-5 mb-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Submissions Timeline</h2>
          <div className="flex gap-1 bg-[#0a0a0a] border border-white/10 rounded-lg p-1">
            {GROUP_BY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGroupBy(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  groupBy === opt.value ? 'bg-[#2563eb] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {timeline.length === 0 ? (
          <div className="text-sm text-gray-500 py-12 text-center">No submission data for this period.</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
              <XAxis dataKey="period" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#111111', border: '1px solid #ffffff1a', borderRadius: 8 }} />
              <Legend />
              <Line type="monotone" dataKey="total" name="Total" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="completed" name="Completed" stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl p-5 mb-8">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">AI Provider Usage</h2>

        {providerStats.length === 0 ? (
          <div className="text-sm text-gray-500 py-8 text-center">No AI provider calls recorded yet.</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={providerStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
                <XAxis dataKey="provider" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#111111', border: '1px solid #ffffff1a', borderRadius: 8 }} />
                <Bar dataKey="totalCalls" name="Total Calls" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-white/10">
                    <th className="py-2 pr-4 font-medium">Provider</th>
                    <th className="py-2 pr-4 font-medium">Total Calls</th>
                    <th className="py-2 pr-4 font-medium">Avg Time</th>
                    <th className="py-2 pr-4 font-medium">Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {providerStats.map((p) => (
                    <tr key={p.provider} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-4 text-white capitalize">{p.provider}</td>
                      <td className="py-2 pr-4 text-gray-300">{p.totalCalls}</td>
                      <td className="py-2 pr-4 text-gray-300">{p.avgProcessingTime}ms</td>
                      <td className="py-2 pr-4 text-gray-300">${p.totalCost.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-white/10">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Per Campaign Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-white/10">
                <SortableHeader label="Campaign" sortKeyName="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <th className="px-5 py-2.5 font-medium">Status</th>
                <SortableHeader label="Total" sortKeyName="totalSubmissions" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Completed" sortKeyName="completed" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Failed" sortKeyName="failed" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Completion Rate" sortKeyName="completionRate" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Avg Time" sortKeyName="avgProcessingTime" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedCampaignStats.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-500">No campaigns yet</td>
                </tr>
              ) : (
                sortedCampaignStats.map((c) => (
                  <tr key={c.campaignId} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                    <td className="px-5 py-3 text-white">{c.name}</td>
                    <td className="px-5 py-3"><StatusBadge status={c.status} type="campaign" /></td>
                    <td className="px-5 py-3 text-gray-300">{c.totalSubmissions}</td>
                    <td className="px-5 py-3 text-gray-300">{c.completed}</td>
                    <td className="px-5 py-3 text-gray-300">{c.failed}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-[#22c55e] rounded-full" style={{ width: `${c.completionRate}%` }} />
                        </div>
                        <span className="text-gray-400 text-xs">{c.completionRate}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-300">{c.avgProcessingTime}ms</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <button
          onClick={() => setAuditOpen((v) => !v)}
          className="w-full px-5 py-4 flex items-center justify-between text-left"
        >
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Audit Log</h2>
          <span className="text-gray-400 text-sm">{auditOpen ? '▲ Collapse' : '▼ Expand'}</span>
        </button>

        {auditOpen && (
          <div className="border-t border-white/10">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-white/10">
                    <th className="px-5 py-2.5 font-medium">User</th>
                    <th className="px-5 py-2.5 font-medium">Action</th>
                    <th className="px-5 py-2.5 font-medium">Entity</th>
                    <th className="px-5 py-2.5 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLoading ? (
                    <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-500">Loading…</td></tr>
                  ) : auditLogs.length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-500">No activity recorded</td></tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id} className="border-b border-white/5 last:border-0">
                        <td className="px-5 py-2.5 text-white">{log.user?.name || '—'}</td>
                        <td className="px-5 py-2.5 text-gray-300 font-mono text-xs">{log.action}</td>
                        <td className="px-5 py-2.5 text-gray-400">{log.entityType}</td>
                        <td className="px-5 py-2.5 text-gray-400">{formatDate(log.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 text-sm">
              <span className="text-gray-500">
                {auditTotal === 0 ? 'No entries' : `${auditPage * AUDIT_PAGE_SIZE + 1}–${Math.min((auditPage + 1) * AUDIT_PAGE_SIZE, auditTotal)} of ${auditTotal}`}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => loadAuditLog(auditPage - 1)}
                  disabled={auditPage === 0 || auditLoading}
                  className="text-xs border border-white/10 hover:bg-white/5 disabled:opacity-40 text-gray-300 rounded-lg px-3 py-1.5 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => loadAuditLog(auditPage + 1)}
                  disabled={(auditPage + 1) * AUDIT_PAGE_SIZE >= auditTotal || auditLoading}
                  className="text-xs border border-white/10 hover:bg-white/5 disabled:opacity-40 text-gray-300 rounded-lg px-3 py-1.5 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <div className="text-sm text-gray-400">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${accent || 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function SortableHeader({ label, sortKeyName, sortKey, sortDir, onClick }) {
  const active = sortKey === sortKeyName;
  return (
    <th
      onClick={() => onClick(sortKeyName)}
      className="px-5 py-2.5 font-medium cursor-pointer select-none hover:text-white"
    >
      {label} {active && (sortDir === 'asc' ? '▲' : '▼')}
    </th>
  );
}
