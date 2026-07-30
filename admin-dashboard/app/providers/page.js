'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import useCurrentUser from '@/lib/useCurrentUser';
import { hasRole, timeAgo, formatDate } from '@/lib/utils';

const ERROR_THRESHOLD = 5;

const SLOT_DEFS = [
  { key: 'slot1', label: 'Slot 1', title: 'Primary API', identifier: 'slot-1-primary', border: 'border-l-[#2563eb]' },
  { key: 'slot2', label: 'Slot 2', title: 'Fallback API', identifier: 'slot-2-fallback', border: 'border-l-gray-500' },
];

function emptySlot() {
  return {
    keyId: null,
    providerId: '',
    originalProviderId: '',
    model: '',
    apiKey: '',
    dailyLimit: '',
    isActive: true,
    usageToday: 0,
    errorCount: 0,
    lastUsedAt: null,
    lastErrorAt: null,
  };
}

export default function ProvidersPage() {
  const user = useCurrentUser();
  const canManage = hasRole(user?.role, 'SUPER_ADMIN');

  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [slots, setSlots] = useState({ slot1: emptySlot(), slot2: emptySlot() });
  const [savingSlot, setSavingSlot] = useState(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [activityLog, setActivityLog] = useState([]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [providersRes, activityRes] = await Promise.all([
        api.get('/ai-providers'),
        api.get('/ai-providers/activity', { params: { limit: 10 } }),
      ]);
      setProviders(providersRes.data);
      setActivityLog(activityRes.data);

      // Slot 1/2 = the two active keys with the fewest errors, across all
      // providers — flatten provider.apiKeys[] into one list to rank them.
      const allActiveKeys = [];
      for (const p of providersRes.data) {
        for (const k of p.apiKeys) {
          if (k.isActive) allActiveKeys.push({ ...k, providerId: p.id });
        }
      }
      allActiveKeys.sort((a, b) => a.errorCount - b.errorCount);

      const next = { slot1: emptySlot(), slot2: emptySlot() };
      SLOT_DEFS.forEach((def, idx) => {
        const k = allActiveKeys[idx];
        if (!k) return;
        next[def.key] = {
          keyId: k.id,
          providerId: k.providerId,
          originalProviderId: k.providerId,
          model: k.model || '',
          apiKey: '',
          dailyLimit: k.dailyLimit ?? '',
          isActive: k.isActive,
          usageToday: k.usageToday,
          errorCount: k.errorCount,
          lastUsedAt: k.lastUsedAt,
          lastErrorAt: k.lastErrorAt,
        };
      });
      setSlots(next);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateSlot = (slotKey, patch) => {
    setSlots((s) => ({ ...s, [slotKey]: { ...s[slotKey], ...patch } }));
  };

  const handleSave = async (def) => {
    const slot = slots[def.key];
    if (!slot.providerId) {
      alert('Select a provider first');
      return;
    }

    // Changing the provider on an existing key isn't supported by the
    // backend (providerId is immutable once created) — re-provision the
    // slot with a brand-new key and retire the old one instead.
    const providerChanged = slot.keyId && slot.originalProviderId !== slot.providerId;
    const isNew = !slot.keyId || providerChanged;

    if (isNew && slot.apiKey.trim().length < 4) {
      alert('Enter an API key (at least 4 characters) to set up this slot');
      return;
    }

    setSavingSlot(def.key);
    try {
      const dailyLimitValue = slot.dailyLimit === '' ? null : Number(slot.dailyLimit);

      if (isNew) {
        if (slot.keyId && providerChanged) {
          await api.patch(`/ai-providers/keys/${slot.keyId}`, { isActive: false });
        }
        await api.post('/ai-providers/keys', {
          providerId: slot.providerId,
          keyIdentifier: def.identifier,
          apiKey: slot.apiKey,
          model: slot.model || undefined,
          dailyLimit: dailyLimitValue ?? undefined,
        });
      } else {
        if (slot.apiKey.trim()) {
          await api.patch(`/ai-providers/keys/${slot.keyId}/rotate`, { apiKey: slot.apiKey });
        }
        await api.patch(`/ai-providers/keys/${slot.keyId}`, {
          keyIdentifier: def.identifier,
          model: slot.model || null,
          dailyLimit: dailyLimitValue,
        });
      }

      await load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save slot');
    } finally {
      setSavingSlot(null);
    }
  };

  // Label rows against the current Slot 1/Slot 2 if the log entry's key still
  // occupies one of them; a key that's since been rotated out of a slot (or
  // was never in one) falls back to its own keyIdentifier so the row is
  // still meaningful instead of silently dropped.
  const slotLabelFor = (apiKeyId) => {
    if (apiKeyId === slots.slot1.keyId) return 'Slot 1';
    if (apiKeyId === slots.slot2.keyId) return 'Slot 2';
    return null;
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
            {SLOT_DEFS.map((def) => (
              <SlotCard
                key={def.key}
                def={def}
                slot={slots[def.key]}
                providers={providers}
                canManage={canManage}
                saving={savingSlot === def.key}
                onChange={(patch) => updateSlot(def.key, patch)}
                onSave={() => handleSave(def)}
              />
            ))}
          </div>

          <div className="mb-8">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">Health Overview</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {SLOT_DEFS.map((def) => {
                const slot = slots[def.key];
                const limit = slot.dailyLimit === '' ? null : Number(slot.dailyLimit);
                const pct = limit ? Math.min(100, (slot.usageToday / limit) * 100) : slot.usageToday > 0 ? 100 : 0;
                return (
                  <div key={def.key} className="bg-[#111111] border border-white/10 rounded-xl p-4">
                    <div className="text-sm text-white mb-1.5">
                      {def.label}: {slot.usageToday}/{limit ?? '∞'} used today
                    </div>
                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : 'bg-[#2563eb]'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {slot.errorCount > 0 && (
                      <div className="text-red-400 text-xs mt-2">
                        {def.label}: {slot.errorCount} error{slot.errorCount === 1 ? '' : 's'}
                        {slot.lastErrorAt ? ` — last error ${timeAgo(slot.lastErrorAt)}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">Activity Log</h2>
            <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-white/10">
                    <th className="px-5 py-2.5 font-medium">Slot</th>
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
                        <td className="px-5 py-2.5 text-white">
                          {slotLabelFor(row.apiKeyId) || (
                            <span className="text-gray-500 font-mono text-xs">{row.keyIdentifier}</span>
                          )}
                        </td>
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
    </DashboardLayout>
  );
}

function slotDotColor(slot) {
  if (!slot.keyId) return 'bg-gray-600';
  if (!slot.isActive) return 'bg-gray-500';
  if (slot.errorCount > ERROR_THRESHOLD) return 'bg-red-500';
  return 'bg-green-500';
}

function SlotCard({ def, slot, providers, canManage, saving, onChange, onSave }) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className={`bg-[#111111] border border-white/10 border-l-4 ${def.border} rounded-xl p-5`}>
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-white font-semibold">{def.label} — {def.title}</div>
          {def.key === 'slot2' && (
            <div className="text-xs text-gray-500">Used automatically if Slot 1 fails</div>
          )}
        </div>
        <span
          className={`w-3 h-3 rounded-full ${slotDotColor(slot)}`}
          title={!slot.keyId ? 'Not configured' : !slot.isActive ? 'Inactive' : slot.errorCount > ERROR_THRESHOLD ? 'Erroring' : 'Healthy'}
        />
      </div>

      <div className="text-xs text-gray-500 mb-4">Usage today: {slot.usageToday}</div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Provider</label>
          <select
            disabled={!canManage}
            value={slot.providerId}
            onChange={(e) => onChange({ providerId: e.target.value })}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb] disabled:opacity-60"
          >
            <option value="">Select provider…</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id} className="capitalize">
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Model Name</label>
          <input
            type="text"
            disabled={!canManage}
            value={slot.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="gemini-2.5-flash-image"
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb] disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            API Key {slot.keyId && <span className="text-gray-600">(leave blank to keep current)</span>}
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              disabled={!canManage}
              value={slot.apiKey}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              placeholder={slot.keyId ? '••••••••' : 'Enter API key'}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 pr-16 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb] disabled:opacity-60"
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

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Daily Limit</label>
          <input
            type="number"
            min={1}
            disabled={!canManage}
            value={slot.dailyLimit}
            onChange={(e) => onChange({ dailyLimit: e.target.value })}
            placeholder="Unlimited"
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb] disabled:opacity-60"
          />
        </div>

        {canManage && (
          <button
            onClick={onSave}
            disabled={saving}
            className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </div>
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
