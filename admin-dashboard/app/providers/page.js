'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import useCurrentUser from '@/lib/useCurrentUser';
import { hasRole, formatDate } from '@/lib/utils';

export default function ProvidersPage() {
  const user = useCurrentUser();
  const canManage = hasRole(user?.role, 'SUPER_ADMIN');

  const [providers, setProviders] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [addKeyFor, setAddKeyFor] = useState(null); // providerId
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [providersRes, campaignsRes] = await Promise.all([
        api.get('/ai-providers'),
        api.get('/campaigns'),
      ]);
      setProviders(providersRes.data);
      setCampaigns(campaignsRes.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggleActive = async (keyId, isActive) => {
    try {
      await api.patch(`/ai-providers/keys/${keyId}`, { isActive: !isActive });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update key');
    }
  };

  const handleRotate = async (keyId) => {
    const newKey = prompt('Enter the new API key value:');
    if (!newKey) return;
    setBusy(true);
    try {
      await api.patch(`/ai-providers/keys/${keyId}/rotate`, { apiKey: newKey });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to rotate key');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteKey = async (keyId) => {
    if (!confirm('Delete this API key? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.delete(`/ai-providers/keys/${keyId}`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete key');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardLayout title="AI Providers">
      <div className="flex items-center justify-between mb-6">
        <Link href="/providers/health" className="text-sm text-[#2563eb] hover:underline">
          View health dashboard →
        </Link>
        {canManage && (
          <button
            onClick={() => setAddProviderOpen(true)}
            className="text-sm bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg px-3 py-2 transition-colors"
          >
            + Add Provider
          </button>
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
        <div className="space-y-6">
          {providers.map((p) => (
            <div key={p.id} className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
              <div className="p-5 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-3 h-3 rounded-full ${p.isHealthy ? 'bg-green-500' : 'bg-red-500'}`}
                    title={p.isHealthy ? 'Healthy' : 'Unhealthy'}
                  />
                  <div>
                    <div className="text-white font-semibold capitalize">{p.name}</div>
                    <div className="text-xs text-gray-400">{p.baseUrl}</div>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm text-gray-300">
                  <div>
                    <span className="text-gray-500">Avg response:</span>{' '}
                    {p.avgResponseTime ? `${p.avgResponseTime}ms` : '—'}
                  </div>
                  <div>
                    <span className="text-gray-500">Active keys:</span>{' '}
                    {p.apiKeys.filter((k) => k.isActive).length}/{p.apiKeys.length}
                  </div>
                  {canManage && (
                    <button
                      onClick={() => setAddKeyFor(p.id)}
                      className="text-xs bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                      + Add Key
                    </button>
                  )}
                </div>
              </div>

              {p.apiKeys.length > 0 && (
                <div className="overflow-x-auto border-t border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-white/10">
                        <th className="px-5 py-2.5 font-medium">Key Identifier</th>
                        <th className="px-5 py-2.5 font-medium">Active</th>
                        <th className="px-5 py-2.5 font-medium">Usage Today / Limit</th>
                        <th className="px-5 py-2.5 font-medium">Errors</th>
                        <th className="px-5 py-2.5 font-medium">Last Used</th>
                        {canManage && <th className="px-5 py-2.5 font-medium"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {p.apiKeys.map((k) => (
                        <tr key={k.id} className="border-b border-white/5">
                          <td className="px-5 py-2.5 text-white">{k.keyIdentifier}</td>
                          <td className="px-5 py-2.5">
                            <button
                              disabled={!canManage}
                              onClick={() => handleToggleActive(k.id, k.isActive)}
                              className={`text-xs rounded-full px-2 py-0.5 border ${
                                k.isActive
                                  ? 'bg-green-500/20 text-green-300 border-green-500/40'
                                  : 'bg-gray-500/20 text-gray-400 border-gray-500/40'
                              } ${canManage ? 'cursor-pointer' : 'cursor-default'}`}
                            >
                              {k.isActive ? 'Active' : 'Inactive'}
                            </button>
                          </td>
                          <td className="px-5 py-2.5 text-gray-300">
                            {k.usageToday} / {k.dailyLimit ?? '∞'}
                          </td>
                          <td className={`px-5 py-2.5 ${k.errorCount >= 10 ? 'text-red-400' : 'text-gray-300'}`}>
                            {k.errorCount}
                          </td>
                          <td className="px-5 py-2.5 text-gray-400">{formatDate(k.lastUsedAt)}</td>
                          {canManage && (
                            <td className="px-5 py-2.5 text-right space-x-2">
                              <button
                                onClick={() => handleRotate(k.id)}
                                disabled={busy}
                                className="text-xs text-[#2563eb] hover:underline"
                              >
                                Rotate
                              </button>
                              <button
                                onClick={() => handleDeleteKey(k.id)}
                                disabled={busy}
                                className="text-xs text-red-400 hover:underline"
                              >
                                Delete
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AddProviderModal
        open={addProviderOpen}
        onClose={() => setAddProviderOpen(false)}
        onSaved={() => {
          setAddProviderOpen(false);
          load();
        }}
      />

      <AddKeyModal
        open={!!addKeyFor}
        providerId={addKeyFor}
        campaigns={campaigns}
        onClose={() => setAddKeyFor(null)}
        onSaved={() => {
          setAddKeyFor(null);
          load();
        }}
      />
    </DashboardLayout>
  );
}

function AddProviderModal({ open, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/ai-providers', { name, baseUrl });
      setName('');
      setBaseUrl('');
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create provider');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add AI Provider">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="stability"
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Base URL</label>
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.stability.ai"
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
        >
          {saving ? 'Creating…' : 'Create Provider'}
        </button>
      </form>
    </Modal>
  );
}

function AddKeyModal({ open, providerId, campaigns, onClose, onSaved }) {
  const [keyIdentifier, setKeyIdentifier] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [campaignIds, setCampaignIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleCampaign = (id) => {
    setCampaignIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/ai-providers/keys', {
        providerId,
        keyIdentifier,
        apiKey,
        dailyLimit: dailyLimit ? Number(dailyLimit) : undefined,
        campaignIds: campaignIds.length > 0 ? campaignIds : undefined,
      });
      setKeyIdentifier('');
      setApiKey('');
      setDailyLimit('');
      setCampaignIds([]);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add key');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add API Key">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-red-400 text-sm">{error}</div>}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Key Identifier</label>
          <input
            type="text"
            required
            value={keyIdentifier}
            onChange={(e) => setKeyIdentifier(e.target.value)}
            placeholder="gemini-key-1"
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">API Key</label>
          <input
            type="password"
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Daily Limit (optional)</label>
          <input
            type="number"
            min={1}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            placeholder="Unlimited"
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Linked Campaigns (leave empty for a shared/global key)
          </label>
          <div className="max-h-40 overflow-y-auto border border-white/10 rounded-lg p-2 space-y-1">
            {campaigns.length === 0 ? (
              <div className="text-xs text-gray-500 px-1 py-1">No campaigns yet</div>
            ) : (
              campaigns.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-gray-300 px-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={campaignIds.includes(c.id)}
                    onChange={() => toggleCampaign(c.id)}
                    className="rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
                  />
                  {c.name}
                </label>
              ))
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
        >
          {saving ? 'Adding…' : 'Add Key'}
        </button>
      </form>
    </Modal>
  );
}
