'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import { formatDate } from '@/lib/utils';

const REFRESH_MS = 10000;
// Response-time bar is normalized against this ceiling — purely a display
// choice, not a value from the backend.
const RESPONSE_TIME_CEILING_MS = 5000;

export default function ProviderHealthPage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/ai-providers/health');
      setProviders(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load health data');
    } finally {
      setLoading(false);
      setLastRefreshed(new Date());
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <DashboardLayout title="Provider Health">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-400">Auto-refreshes every 10 seconds</p>
        {lastRefreshed && (
          <p className="text-xs text-gray-500">Last updated: {lastRefreshed.toLocaleTimeString()}</p>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map((p) => {
            const barPct = p.avgResponseTime
              ? Math.min(100, (p.avgResponseTime / RESPONSE_TIME_CEILING_MS) * 100)
              : 0;

            return (
              <div key={p.id} className="bg-[#111111] border border-white/10 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-white font-semibold capitalize">{p.name}</span>
                  <span
                    className={`w-4 h-4 rounded-full ${p.isHealthy ? 'bg-green-500 shadow-[0_0_8px_2px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.5)]'}`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                  <MiniStat label="Active Keys" value={p.activeKeys} />
                  <MiniStat label="Total Keys" value={p.totalKeys} />
                  <MiniStat
                    label="At Daily Limit"
                    value={p.keysAtLimit}
                    accent={p.keysAtLimit > 0 ? 'text-yellow-400' : undefined}
                  />
                  <MiniStat
                    label="Recent Errors"
                    value={p.recentErrors}
                    accent={p.recentErrors > 0 ? 'text-red-400' : undefined}
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Avg Response Time</span>
                    <span>{p.avgResponseTime ? `${p.avgResponseTime}ms` : 'no data'}</span>
                  </div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barPct > 66 ? 'bg-red-500' : barPct > 33 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>

                <div className="text-xs text-gray-500 mt-3">
                  Last check: {formatDate(p.lastHealthCheck)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}

function MiniStat({ label, value, accent }) {
  return (
    <div>
      <div className="text-gray-500 text-xs">{label}</div>
      <div className={`font-semibold ${accent || 'text-white'}`}>{value}</div>
    </div>
  );
}
