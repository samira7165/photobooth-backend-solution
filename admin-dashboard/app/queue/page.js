'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import useCurrentUser from '@/lib/useCurrentUser';
import { hasRole, timeAgo, truncateId, resolveImageUrl } from '@/lib/utils';

const POLL_INTERVAL_MS = 3000;

export default function QueueMonitorPage() {
  const user = useCurrentUser();
  const canControl = hasRole(user?.role, 'ADMIN');

  const [stats, setStats] = useState(null);
  const [active, setActive] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [failed, setFailed] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [clients, setClients] = useState(null);
  const [error, setError] = useState('');
  const [controlBusy, setControlBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);

  const load = async () => {
    try {
      const [statsRes, activeRes, waitingRes, failedRes, completedRes, clientsRes] = await Promise.all([
        api.get('/admin/queue/stats'),
        api.get('/admin/queue/active'),
        api.get('/admin/queue/waiting'),
        api.get('/admin/queue/failed'),
        api.get('/admin/queue/completed'),
        api.get('/admin/queue/clients'),
      ]);
      setStats(statsRes.data);
      setActive(activeRes.data);
      setWaiting(waitingRes.data);
      setFailed(failedRes.data);
      setCompleted(completedRes.data);
      setClients(clientsRes.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load queue status');
    }
  };

  const intervalRef = useRef(null);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, []);

  const runControl = async (action) => {
    setControlBusy(true);
    try {
      await api.post(`/admin/queue/${action}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || `Failed to ${action} queue`);
    } finally {
      setControlBusy(false);
    }
  };

  const handleDrain = () => {
    if (!confirm('Drain the queue? This permanently removes every waiting job — active jobs finish normally.')) return;
    runControl('drain');
  };

  const handleRetry = async (jobId) => {
    setRowBusy(jobId);
    try {
      await api.post(`/admin/queue/retry/${jobId}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to retry job');
    } finally {
      setRowBusy(null);
    }
  };

  const handleRemove = async (jobId) => {
    if (!confirm('Remove this job from the queue permanently?')) return;
    setRowBusy(jobId);
    try {
      await api.delete(`/admin/queue/${jobId}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to remove job');
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <DashboardLayout title="Queue Monitor">
      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${stats?.isPaused ? 'bg-yellow-500' : 'bg-green-500'}`} />
          <span className="text-sm text-white">
            Queue Status: <span className={stats?.isPaused ? 'text-yellow-400' : 'text-green-400'}>{stats?.isPaused ? 'Paused' : 'Running'}</span>
          </span>
        </div>

        {canControl && (
          <div className="flex gap-2">
            <button
              onClick={() => runControl('resume')}
              disabled={controlBusy || !stats?.isPaused}
              className="text-xs bg-white/5 hover:bg-white/10 disabled:opacity-40 text-gray-300 rounded-lg px-3 py-2 transition-colors"
            >
              Resume Queue
            </button>
            <button
              onClick={() => runControl('pause')}
              disabled={controlBusy || stats?.isPaused}
              className="text-xs bg-white/5 hover:bg-white/10 disabled:opacity-40 text-gray-300 rounded-lg px-3 py-2 transition-colors"
            >
              Pause Queue
            </button>
            <button
              onClick={handleDrain}
              disabled={controlBusy}
              className="text-xs border border-red-500/30 hover:bg-red-500/10 disabled:opacity-40 text-red-400 rounded-lg px-3 py-2 transition-colors"
            >
              Drain Queue
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Waiting" value={stats?.waiting ?? '—'} accent="text-yellow-400" />
        <StatCard label="Active" value={stats?.active ?? '—'} accent="text-blue-400" />
        <StatCard label="Completed" value={stats?.completed ?? '—'} accent="text-green-400" />
        <StatCard label="Failed" value={stats?.failed ?? '—'} accent="text-red-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Active Jobs</h2>
          {active.length === 0 ? (
            <p className="text-sm text-gray-500">No active jobs</p>
          ) : (
            <div className="space-y-3">
              {active.map((job) => (
                <div key={job.jobId} className="border border-white/10 rounded-lg p-3">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="font-mono text-gray-300">{truncateId(job.submissionId)}</span>
                    <span className="text-gray-500">{job.campaignName || '—'} · {job.mode}</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mb-1.5">
                    <div className="h-full bg-[#3b82f6] rounded-full transition-all" style={{ width: `${job.progress}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{job.progress}% · started {job.startedAt ? elapsedFrom(job.startedAt) : '—'}</span>
                    <DownloadLink url={job.originalUrl} label="Original" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Waiting Jobs</h2>
          {waiting.length === 0 ? (
            <p className="text-sm text-gray-500">Queue is empty</p>
          ) : (
            <div className="space-y-2">
              {waiting.map((job) => (
                <div key={job.jobId} className="flex items-center justify-between text-sm border-b border-white/5 last:border-0 pb-2 last:pb-0">
                  <span className="font-mono text-gray-300">{truncateId(job.submissionId)}</span>
                  <span className="text-gray-500">{job.campaignName || '—'}</span>
                  <span className="text-gray-500 text-xs">{timeAgo(job.queuedAt)}</span>
                  {canControl && (
                    <button
                      onClick={() => handleRemove(job.jobId)}
                      disabled={rowBusy === job.jobId}
                      className="text-xs text-red-400 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-white/10">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Recently Completed</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-white/10">
                <th className="px-5 py-2.5 font-medium">Submission ID</th>
                <th className="px-5 py-2.5 font-medium">Campaign</th>
                <th className="px-5 py-2.5 font-medium">Mode</th>
                <th className="px-5 py-2.5 font-medium">Finished</th>
                <th className="px-5 py-2.5 font-medium">Original</th>
                <th className="px-5 py-2.5 font-medium">Result</th>
                {canControl && <th className="px-5 py-2.5 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {completed.length === 0 ? (
                <tr>
                  <td colSpan={canControl ? 7 : 6} className="px-5 py-8 text-center text-gray-500">No completed jobs yet</td>
                </tr>
              ) : (
                completed.map((job) => (
                  <tr key={job.jobId} className="border-b border-white/5 last:border-0">
                    <td className="px-5 py-2.5 font-mono text-gray-300">{truncateId(job.submissionId)}</td>
                    <td className="px-5 py-2.5 text-gray-300">{job.campaignName || '—'}</td>
                    <td className="px-5 py-2.5 text-gray-400">{job.mode || '—'}</td>
                    <td className="px-5 py-2.5 text-gray-400">{job.finishedAt ? timeAgo(job.finishedAt) : '—'}</td>
                    <td className="px-5 py-2.5"><DownloadLink url={job.originalUrl} label="Original" /></td>
                    <td className="px-5 py-2.5"><DownloadLink url={job.resultUrl} label="Result" /></td>
                    {canControl && (
                      <td className="px-5 py-2.5">
                        <button
                          onClick={() => handleRemove(job.jobId)}
                          disabled={rowBusy === job.jobId}
                          className="text-xs text-red-400 hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-white/10">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Failed Jobs</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-white/10">
                <th className="px-5 py-2.5 font-medium">Submission ID</th>
                <th className="px-5 py-2.5 font-medium">Campaign</th>
                <th className="px-5 py-2.5 font-medium">Failed Reason</th>
                <th className="px-5 py-2.5 font-medium">Attempts</th>
                <th className="px-5 py-2.5 font-medium">Time</th>
                <th className="px-5 py-2.5 font-medium">Photo</th>
                {canControl && <th className="px-5 py-2.5 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {failed.length === 0 ? (
                <tr>
                  <td colSpan={canControl ? 7 : 6} className="px-5 py-8 text-center text-gray-500">No failed jobs</td>
                </tr>
              ) : (
                failed.map((job) => (
                  <tr key={job.jobId} className="border-b border-white/5 last:border-0">
                    <td className="px-5 py-2.5 font-mono text-gray-300">{truncateId(job.submissionId)}</td>
                    <td className="px-5 py-2.5 text-gray-300">{job.campaignName || '—'}</td>
                    <td className="px-5 py-2.5 text-red-400 max-w-xs truncate" title={job.failedReason}>{job.failedReason || '—'}</td>
                    <td className="px-5 py-2.5 text-gray-400">{job.attemptsMade}</td>
                    <td className="px-5 py-2.5 text-gray-400">{timeAgo(job.queuedAt)}</td>
                    <td className="px-5 py-2.5"><DownloadLink url={job.originalUrl} label="Original" /></td>
                    {canControl && (
                      <td className="px-5 py-2.5">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRetry(job.jobId)}
                            disabled={rowBusy === job.jobId}
                            className="text-xs text-[#2563eb] hover:underline disabled:opacity-50"
                          >
                            Retry
                          </button>
                          <button
                            onClick={() => handleRemove(job.jobId)}
                            disabled={rowBusy === job.jobId}
                            className="text-xs text-red-400 hover:underline disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl p-5 max-w-sm">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">Connected Clients</h2>
        <div className="text-2xl font-semibold text-white mb-2">{clients?.totalConnected ?? '—'}</div>
        <div className="text-sm text-gray-400 space-y-1">
          <div>Admins: {clients?.admins ?? '—'}</div>
          <div>Booths: {clients?.booths?.length ?? '—'}</div>
          {clients?.booths?.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-gray-500">
              {clients.booths.map((b) => (
                <li key={b.socketId}>{b.campaignSlug}{b.hallId ? ` (hall ${b.hallId})` : ''}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function elapsedFrom(iso) {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

function DownloadLink({ url, label }) {
  if (!url) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <a
      href={resolveImageUrl(url)}
      download
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-[#2563eb] hover:underline"
    >
      <Download size={12} /> {label}
    </a>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <div className="text-sm text-gray-400">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${accent || 'text-white'}`}>{value}</div>
    </div>
  );
}
