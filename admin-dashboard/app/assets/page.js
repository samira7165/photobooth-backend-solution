'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';

// Assets (backgrounds/frames/props) belong to a campaign — there's no
// campaign-agnostic asset listing on the backend — so this page is just a
// picker that hands off to that campaign's Assets tab.
export default function AssetsPickerPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/campaigns')
      .then((res) => setCampaigns(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load campaigns'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout title="Assets">
      <p className="text-gray-400 text-sm mb-6">
        Assets belong to a campaign — pick one to manage its backgrounds, frames, and props.
      </p>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : campaigns.length === 0 ? (
        <div className="text-gray-500 text-sm">No campaigns yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((c) => (
            <Link
              key={c.id}
              href={`/campaigns/${c.id}?tab=Assets`}
              className="bg-[#111111] border border-white/10 hover:border-[#2563eb]/50 rounded-xl p-4 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium">{c.name}</span>
                <StatusBadge status={c.status} type="campaign" />
              </div>
              <div className="text-gray-400 text-xs font-mono">{c.slug}</div>
              <div className="text-gray-500 text-xs mt-2">
                {(c._count?.backgrounds ?? 0) + (c._count?.frames ?? 0) + (c._count?.props ?? 0)} assets
              </div>
            </Link>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
