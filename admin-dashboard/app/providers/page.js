'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import useCurrentUser from '@/lib/useCurrentUser';
import { hasRole, timeAgo, formatDate } from '@/lib/utils';

const ERROR_THRESHOLD = 5;

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export default function ProvidersPage() {
  const user = useCurrentUser();
  const canManage = hasRole(user?.role, 'SUPER_ADMIN');

  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activityLog, setActivityLog] = useState([]);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [addKeyFor, setAddKeyFor] = useState(null); // provider object, or null

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [providersRes, activityRes] = await Promise.all([
        api.get('/ai-providers'),
        api.get('/ai-providers/activity', { params: { limit: 15 } }),
      ]);
      setProviders(providersRes.data);
      setActivityLog(activityRes.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const allActiveKeys = [];
  for (const p of providers) {
    for (const k of p.apiKeys || []) {
      if (k.isActive) allActiveKeys.push({ ...k, providerName: p.name });
    }
  }

  return (
    <DashboardLayout title="AI Providers">
      <div className="flex items-center justify-between mb-6">
        <Link href="/providers/health" className="text-sm text-[#2563eb] hover:underline">
          View health dashboard →
        </Link>
        {canManage && (
          <button
            onClick={() => setAddProviderOpen(true)}
            className="text-xs text-gray-400 hover:text-white underline"
          >
            + Add a provider
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
        <>
          <div className="space-y-5 mb-8">
            {providers.length === 0 ? (
              <div className="text-sm text-gray-500">No providers yet — add one to get started.</div>
            ) : (
              providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  canManage={canManage}
                  onAddKey={() => setAddKeyFor(provider)}
                  onChanged={load}
                />
              ))
            )}
          </div>

          {allActiveKeys.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">Health Overview</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {allActiveKeys.map((k) => {
                  const pct = k.dailyLimit ? Math.min(100, (k.usageToday / k.dailyLimit) * 100) : k.usageToday > 0 ? 100 : 0;
                  return (
                    <div key={k.id} className="bg-[#111111] border border-white/10 rounded-xl p-4">
                      <div className="text-sm text-white mb-1.5">
                        {capitalize(k.providerName)} — {k.keyIdentifier}: {k.usageToday}/{k.dailyLimit ?? '∞'} used today
                      </div>
                      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : 'bg-[#2563eb]'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {k.errorCount > 0 && (
                        <div className="text-red-400 text-xs mt-2">
                          {k.errorCount} error{k.errorCount === 1 ? '' : 's'}
                          {k.lastErrorAt ? ` — last error ${timeAgo(k.lastErrorAt)}` : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">Activity Log</h2>
            <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-white/10">
                    <th className="px-5 py-2.5 font-medium">Key</th>
                    <th className="px-5 py-2.5 font-medium">Provider</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLog.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-gray-500">
                        No recorded activity yet — this fills in once the processing pipeline
                        starts making real AI provider calls.
                      </td>
                    </tr>
                  ) : (
                    activityLog.map((row) => (
                      <tr key={row.id} className="border-b border-white/5 last:border-0">
                        <td className="px-5 py-2.5 text-gray-300 font-mono text-xs">{row.keyIdentifier}</td>
                        <td className="px-5 py-2.5 text-gray-300 capitalize">{row.providerName}</td>
                        <td className="px-5 py-2.5">
                          <span
                            className={`text-xs rounded-full px-2 py-0.5 border ${
                              row.success
                                ? 'bg-green-500/20 text-green-300 border-green-500/40'
                                : 'bg-red-500/20 text-red-300 border-red-500/40'
                            }`}
                            title={row.errorMessage || undefined}
                          >
                            {row.success ? 'success' : 'fail'}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-gray-400">{formatDate(row.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
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
        provider={addKeyFor}
        onClose={() => setAddKeyFor(null)}
        onSaved={() => {
          setAddKeyFor(null);
          load();
        }}
      />
    </DashboardLayout>
  );
}

function healthDot(provider) {
  if (!provider.isHealthy) return 'bg-red-500';
  const anyActive = (provider.apiKeys || []).some((k) => k.isActive);
  return anyActive ? 'bg-green-500' : 'bg-gray-600';
}

function ProviderCard({ provider, canManage, onAddKey, onChanged }) {
  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${healthDot(provider)}`} />
          <h3 className="text-white font-semibold capitalize">{provider.name}</h3>
          <span className="text-xs text-gray-500">{provider.apiKeys?.length || 0} key{provider.apiKeys?.length === 1 ? '' : 's'}</span>
        </div>
        {canManage && (
          <button
            onClick={onAddKey}
            className="text-xs text-[#2563eb] hover:underline"
          >
            + Add Key
          </button>
        )}
      </div>

      {(!provider.apiKeys || provider.apiKeys.length === 0) ? (
        <p className="text-sm text-gray-500">No keys yet for this provider.</p>
      ) : (
        <div className="space-y-3">
          {provider.apiKeys.map((apiKey) => (
            <KeyCard key={apiKey.id} apiKey={apiKey} canManage={canManage} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

function KeyCard({ apiKey, canManage, onChanged }) {
  const [keyIdentifier, setKeyIdentifier] = useState(apiKey.keyIdentifier);
  const [dailyLimit, setDailyLimit] = useState(apiKey.dailyLimit ?? '');
  const [isActive, setIsActive] = useState(apiKey.isActive);
  const [secretInput, setSecretInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newModel, setNewModel] = useState('');
  const [addingModel, setAddingModel] = useState(false);

  const dirty =
    keyIdentifier !== apiKey.keyIdentifier ||
    String(dailyLimit) !== String(apiKey.dailyLimit ?? '') ||
    isActive !== apiKey.isActive ||
    secretInput.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      if (secretInput.trim()) {
        await api.patch(`/ai-providers/keys/${apiKey.id}/rotate`, { apiKey: secretInput });
      }
      await api.patch(`/ai-providers/keys/${apiKey.id}`, {
        keyIdentifier,
        dailyLimit: dailyLimit === '' ? null : Number(dailyLimit),
        isActive,
      });
      setSecretInput('');
      onChanged();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save key');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete key "${apiKey.keyIdentifier}"? This removes it from every campaign it's linked to.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/ai-providers/keys/${apiKey.id}`);
      onChanged();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete key');
      setDeleting(false);
    }
  };

  const handleAddModel = async (e) => {
    e.preventDefault();
    if (!newModel.trim()) return;
    setAddingModel(true);
    try {
      await api.post(`/ai-providers/keys/${apiKey.id}/models`, { model: newModel.trim() });
      setNewModel('');
      onChanged();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add model');
    } finally {
      setAddingModel(false);
    }
  };

  const handleRemoveModel = async (modelId) => {
    try {
      await api.delete(`/ai-providers/keys/${apiKey.id}/models/${modelId}`);
      onChanged();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to remove model');
    }
  };

  const dotColor = !isActive ? 'bg-gray-500' : apiKey.errorCount > ERROR_THRESHOLD ? 'bg-red-500' : 'bg-green-500';

  return (
    <div className="border border-white/10 rounded-lg p-4 bg-[#0a0a0a]">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} title={!isActive ? 'Inactive' : apiKey.errorCount > ERROR_THRESHOLD ? 'Erroring' : 'Healthy'} />
        <span className="text-xs text-gray-500">Usage today: {apiKey.usageToday}</span>
        {apiKey.errorCount > 0 && <span className="text-xs text-red-400">· {apiKey.errorCount} errors</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Label</label>
          <input
            type="text"
            disabled={!canManage}
            value={keyIdentifier}
            onChange={(e) => setKeyIdentifier(e.target.value)}
            className="w-full bg-[#111111] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb] disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Daily Limit</label>
          <input
            type="number"
            min={1}
            disabled={!canManage}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            placeholder="Unlimited"
            className="w-full bg-[#111111] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb] disabled:opacity-60"
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-400 mb-1">API Key (leave blank to keep current)</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            disabled={!canManage}
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder="••••••••"
            className="w-full bg-[#111111] border border-white/10 rounded-lg px-3 py-2 pr-16 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb] disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white"
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div className="mb-3">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            disabled={!canManage}
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded border-white/20 bg-[#111111] text-[#2563eb] focus:ring-[#2563eb]"
          />
          Active
        </label>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-400 mb-1.5">Models</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(apiKey.models || []).length === 0 && (
            <span className="text-xs text-gray-600">No models added yet — a campaign can&apos;t select this key until it has at least one.</span>
          )}
          {(apiKey.models || []).map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1.5 bg-[#111111] border border-white/10 rounded-full pl-3 pr-1.5 py-1 text-xs text-gray-200 font-mono"
            >
              {m.model}
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleRemoveModel(m.id)}
                  title="Remove model"
                  className="text-gray-500 hover:text-red-400 w-4 h-4 flex items-center justify-center rounded-full"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {canManage && (
          <form onSubmit={handleAddModel} className="flex gap-2">
            <input
              type="text"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder="gemini-3-pro-image"
              className="flex-1 bg-[#111111] border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            />
            <button
              type="submit"
              disabled={addingModel || !newModel.trim()}
              className="text-xs bg-white/5 hover:bg-white/10 disabled:opacity-50 text-gray-300 rounded-lg px-3 py-1.5 transition-colors"
            >
              + Add Model
            </button>
          </form>
        )}
      </div>

      {canManage && (
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex-1 bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm border border-red-500/30 hover:bg-red-500/10 disabled:opacity-40 text-red-400 rounded-lg px-3 py-2 transition-colors"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}

function AddKeyModal({ open, provider, onClose, onSaved }) {
  const [keyIdentifier, setKeyIdentifier] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setKeyIdentifier('');
      setApiKeyValue('');
      setDailyLimit('');
      setError('');
    }
  }, [open]);

  if (!provider) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/ai-providers/keys', {
        providerId: provider.id,
        keyIdentifier,
        apiKey: apiKeyValue,
        dailyLimit: dailyLimit === '' ? undefined : Number(dailyLimit),
      });
      onSaved();
    } catch (err) {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to add key');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Add Key — ${capitalize(provider.name)}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Label</label>
          <input
            type="text"
            required
            minLength={2}
            value={keyIdentifier}
            onChange={(e) => setKeyIdentifier(e.target.value)}
            placeholder="Gemini Key 1"
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">API Key</label>
          <input
            type="password"
            required
            minLength={4}
            value={apiKeyValue}
            onChange={(e) => setApiKeyValue(e.target.value)}
            placeholder="Enter API key"
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Daily Limit</label>
          <input
            type="number"
            min={1}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            placeholder="Unlimited"
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <p className="text-xs text-gray-500">
          You can add one or more models to this key (e.g. &quot;gemini-2.5-flash-image&quot;, &quot;gemini-3-pro-image&quot;) after saving it.
        </p>
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
