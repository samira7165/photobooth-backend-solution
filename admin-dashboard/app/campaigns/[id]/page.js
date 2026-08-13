'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import AssetsTab from '@/components/AssetsTab';
import SubmissionsTab from '@/components/SubmissionsTab';
import useCurrentUser from '@/lib/useCurrentUser';
import { hasRole, CAMPAIGN_STATUS_TRANSITIONS, formatDate, COLLECT_FIELD_OPTIONS } from '@/lib/utils';
import AiModelConfigSection, { flattenProviderKeys, keyLabel, countAllKeys } from '@/components/AiModelConfigSection';
import { EnabledAssetGrid } from '@/components/StagedAssetSection';

const TABS = ['Overview', 'Assets', 'Submissions'];

const STATUS_ACTION_LABELS = {
  ACTIVE: 'Activate',
  PAUSED: 'Pause',
  COMPLETED: 'Complete',
  ARCHIVED: 'Archive',
};

// ACTIVE has two outgoing transitions (PAUSED, COMPLETED) that both need
// distinct labels from the generic map above — "Pause"/"Complete" already
// cover it, but PAUSED -> ACTIVE reads better as "Resume" than "Activate".
function labelFor(fromStatus, toStatus) {
  if (fromStatus === 'PAUSED' && toStatus === 'ACTIVE') return 'Resume';
  return STATUS_ACTION_LABELS[toStatus] || toStatus;
}

export default function CampaignDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const user = useCurrentUser();

  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Overview');

  // Reads ?tab= directly from window.location instead of useSearchParams()
  // so this page doesn't need a <Suspense> boundary (the whole app is
  // client-rendered against the NestJS API, so there's no SSR content to
  // suspend on anyway).
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && TABS.includes(requested)) setTab(requested);
  }, []);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadingConfig, setDownloadingConfig] = useState(false);

  const canManage = hasRole(user?.role, 'ADMIN');
  const canDelete = hasRole(user?.role, 'SUPER_ADMIN');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/campaigns/${id}`);
      setCampaign(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleStatusChange = async (newStatus) => {
    setStatusUpdating(true);
    try {
      await api.patch(`/campaigns/${id}/status`, { status: newStatus });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to change status');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete campaign "${campaign.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/campaigns/${id}`);
      router.push('/campaigns');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete campaign');
      setDeleting(false);
    }
  };

  // A key's plaintext is never stored, so there's nothing to "re-download"
  // from the original creation — this issues a brand new developer API key
  // for the campaign every time it's clicked, packaged the same way. The
  // old key(s) keep working; this doesn't revoke anything.
  const handleDownloadIntegrationConfig = async () => {
    if (!confirm(`Download an API config for "${campaign.name}"? This issues a new API key — any existing keys keep working.`)) return;
    setDownloadingConfig(true);
    try {
      const res = await api.post(`/campaigns/${id}/integration-config`);
      const cfg = res.data;
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${cfg.campaignSlug}-integration-config.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      alert(`Downloaded — a new API key ("${cfg.keyPrefix}...") was issued and saved to the file.`);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to generate integration config');
    } finally {
      setDownloadingConfig(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout title="Campaign">
        <div className="text-gray-500 text-sm">Loading…</div>
      </DashboardLayout>
    );
  }

  if (error || !campaign) {
    return (
      <DashboardLayout title="Campaign">
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error || 'Campaign not found'}
        </div>
      </DashboardLayout>
    );
  }

  const transitions = CAMPAIGN_STATUS_TRANSITIONS[campaign.status] || [];

  return (
    <DashboardLayout title={campaign.name}>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-2xl font-semibold text-white">{campaign.name}</h2>
            <StatusBadge status={campaign.status} type="campaign" />
          </div>
          <p className="text-gray-400 text-sm font-mono">{campaign.slug}</p>
        </div>

        {canManage && (
          <div className="flex items-center gap-2 flex-wrap">
            {transitions.map((toStatus) => (
              <button
                key={toStatus}
                onClick={() => handleStatusChange(toStatus)}
                disabled={statusUpdating}
                className="text-sm bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 transition-colors"
              >
                {labelFor(campaign.status, toStatus)}
              </button>
            ))}
            <button
              onClick={() => setEditOpen(true)}
              className="text-sm border border-white/10 hover:bg-white/5 text-gray-300 rounded-lg px-3 py-2 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={handleDownloadIntegrationConfig}
              disabled={downloadingConfig}
              title="Issues a new API key and downloads a ready-to-use integration config for this campaign"
              className="text-sm border border-white/10 hover:bg-white/5 disabled:opacity-50 text-gray-300 rounded-lg px-3 py-2 transition-colors"
            >
              {downloadingConfig ? 'Generating…' : 'Download API Config'}
            </button>
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting || campaign.status === 'ACTIVE'}
                title={campaign.status === 'ACTIVE' ? 'Pause or complete the campaign first' : ''}
                className="text-sm border border-red-500/30 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed text-red-400 rounded-lg px-3 py-2 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-6 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-[#2563eb] text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab campaign={campaign} />}
      {tab === 'Assets' && <AssetsTab campaignId={campaign.id} canManage={canManage} />}
      {tab === 'Submissions' && <SubmissionsTab campaignId={campaign.id} canManage={canManage} />}

      <EditCampaignModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        campaign={campaign}
        onSaved={() => {
          setEditOpen(false);
          load();
        }}
      />
    </DashboardLayout>
  );
}

function ConfigSection({ title, config }) {
  if (!config || Object.keys(config).length === 0) return null;
  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">{title}</h3>
      <div className="space-y-1.5 text-sm">
        {Object.entries(config).map(([key, value]) => (
          <div key={key} className="flex justify-between gap-4">
            <span className="text-gray-400">{key}</span>
            <span className="text-white text-right break-all">
              {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({ campaign }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatBox label="Submissions" value={campaign._count?.submissions ?? 0} />
        <StatBox label="Assets" value={(campaign.backgrounds?.length ?? 0) + (campaign.frames?.length ?? 0) + (campaign.props?.length ?? 0)} />
        <StatBox label="Created" value={formatDate(campaign.createdAt)} small />
      </div>

      <AiChainDisplay campaign={campaign} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConfigSection title="Photo Settings" config={campaign.photoSettings} />
        <ConfigSection title="AI Config" config={campaign.aiConfig} />
        <ConfigSection title="QR Config" config={campaign.qrConfig} />
        <ConfigSection title="Background Config" config={campaign.backgroundConfig} />
        <ConfigSection title="Frame Config" config={campaign.frameConfig} />
        <ConfigSection title="Prop Config" config={campaign.propConfig} />
        <ConfigSection title="Text Config" config={campaign.textConfig} />
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">Other</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Detail label="Processing Mode" value={campaign.processingMode} />
          <Detail label="Output Mode" value={campaign.outputMode} />
          <Detail label="Collect Fields" value={(campaign.collectFields || []).join(', ')} />
          <Detail label="Max Submissions" value={campaign.maxSubmissions} />
          <Detail label="Daily Budget" value={campaign.dailyBudget} />
          <Detail label="Total Budget" value={campaign.totalBudget} />
        </div>
      </div>
    </div>
  );
}

// Resolves aiConfig.keyChain (ordered key ids) against apiKeyLinks (the
// linked keys' provider/model details) so the failover order shows as
// "1. Gemini (model) → 2. ..." instead of raw key ids.
function AiChainDisplay({ campaign }) {
  const chain = campaign.aiConfig?.keyChain || [];
  const [aiKeys, setAiKeys] = useState([]);

  useEffect(() => {
    if (chain.length === 0) return;
    api
      .get('/ai-providers')
      .then((res) => setAiKeys(flattenProviderKeys(res.data)))
      .catch(() => setAiKeys([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id]);

  if (chain.length === 0) return null;

  const parts = chain.map((id, i) => {
    const key = aiKeys.find((k) => k.id === id);
    const label = key ? keyLabel(key) : `Unknown key (${id.slice(0, 8)}…)`;
    return `${i + 1}. ${label}`;
  });

  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">AI Failover Chain</h3>
      <div className="text-sm text-gray-300 font-mono break-all">{parts.join(' → ')}</div>
    </div>
  );
}

function StatBox({ label, value, small }) {
  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`${small ? 'text-sm' : 'text-2xl'} font-semibold text-white mt-1`}>{value}</div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div className="text-gray-400 text-xs">{label}</div>
      <div className="text-white">{value ?? '—'}</div>
    </div>
  );
}

function EditCampaignModal({ open, onClose, campaign, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);

  const [aiKeys, setAiKeys] = useState([]);
  const [aiKeysLoading, setAiKeysLoading] = useState(true);
  const [totalKeysCount, setTotalKeysCount] = useState(0);
  const [keyChain, setKeyChain] = useState(['']);
  const [aiPrompt, setAiPrompt] = useState('');
  const [originalChain, setOriginalChain] = useState([]);

  const [backgroundsEnabled, setBackgroundsEnabled] = useState(false);
  const [framesEnabled, setFramesEnabled] = useState(false);
  const [propsEnabled, setPropsEnabled] = useState(false);
  const [templatesEnabled, setTemplatesEnabled] = useState(false);

  useEffect(() => {
    api
      .get('/ai-providers')
      .then((res) => {
        setAiKeys(flattenProviderKeys(res.data));
        setTotalKeysCount(countAllKeys(res.data));
      })
      .catch(() => setAiKeys([]))
      .finally(() => setAiKeysLoading(false));
  }, []);

  useEffect(() => {
    if (campaign) {
      setForm({
        name: campaign.name,
        processingMode: campaign.processingMode,
        orientation: campaign.photoSettings?.orientation || 'portrait',
        outputWidth: campaign.photoSettings?.outputWidth || 1080,
        outputHeight: campaign.photoSettings?.outputHeight || 1920,
        outputMode: campaign.outputMode,
        backgroundRemoval: campaign.backgroundConfig?.removal || false,
        collectFields: campaign.collectFields || [],
      });

      const chain = (campaign.aiConfig?.keyChain || []).filter(Boolean);
      setKeyChain(chain.length > 0 ? chain : ['']);
      setAiPrompt(campaign.aiConfig?.prompt || '');
      setOriginalChain(chain);

      setBackgroundsEnabled(campaign.backgroundConfig?.enabled || false);
      setFramesEnabled(campaign.frameConfig?.enabled || false);
      setPropsEnabled(campaign.propConfig?.enabled || false);
      setTemplatesEnabled(campaign.aiConfig?.templatesEnabled || campaign.templates?.length > 0 || false);
    }
  }, [campaign]);

  if (!form) return null;

  const aiModeSelected = form.processingMode === 'ai' || form.processingMode === 'both';

  const toggleCollectField = (field) => {
    setForm((f) => ({
      ...f,
      collectFields: f.collectFields.includes(field)
        ? f.collectFields.filter((x) => x !== field)
        : [...f.collectFields, field],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const chain = keyChain.filter(Boolean);
    if (aiModeSelected && chain.length === 0) {
      setError('Select a Primary Model before saving an AI-enabled campaign');
      return;
    }

    setSaving(true);
    try {
      if (aiModeSelected) {
        // chain entries are ApiKeyModel ids — resolve each to its underlying
        // ApiKey id and dedupe before diffing, since the same key can appear
        // more than once in a chain under different models and link/unlink
        // only make sense at the physical-key level.
        const apiKeyIdFor = (chainEntryId) => aiKeys.find((k) => k.id === chainEntryId)?.apiKeyId;
        const originalKeyIds = [...new Set(originalChain.map(apiKeyIdFor).filter(Boolean))];
        const newKeyIds = [...new Set(chain.map(apiKeyIdFor).filter(Boolean))];

        const toUnlink = originalKeyIds.filter((id) => !newKeyIds.includes(id));
        const toLink = newKeyIds.filter((id) => !originalKeyIds.includes(id));

        const results = await Promise.allSettled([
          ...toUnlink.map((keyId) => api.delete(`/ai-providers/keys/${keyId}/link/${campaign.id}`)),
          ...toLink.map((keyId) => api.post(`/ai-providers/keys/${keyId}/link/${campaign.id}`)),
        ]);
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          console.error('Some AI key links failed to update:', failed);
        }
      }

      // Deliberately no `status` field — CampaignsService.update() rejects
      // it (status changes must go through PATCH /campaigns/:id/status).
      await api.patch(`/campaigns/${campaign.id}`, {
        name: form.name,
        processingMode: form.processingMode,
        photoSettings: {
          orientation: form.orientation,
          outputWidth: Number(form.outputWidth),
          outputHeight: Number(form.outputHeight),
        },
        outputMode: form.outputMode,
        collectFields: form.collectFields,
        backgroundConfig: {
          ...campaign.backgroundConfig,
          enabled: backgroundsEnabled,
          removal: form.backgroundRemoval,
        },
        frameConfig: { ...campaign.frameConfig, enabled: framesEnabled },
        propConfig: { ...campaign.propConfig, enabled: propsEnabled },
        ...(aiModeSelected && {
          aiConfig: {
            prompt: aiPrompt,
            keyChain: chain,
            fallbackProviders: chain.map((id) => aiKeys.find((k) => k.id === id)?.providerName).filter(Boolean),
            templatesEnabled,
          },
        }),
      });
      alert(`Saved — "${form.name}" was updated successfully.`);
      onSaved();
    } catch (err) {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Campaign">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Name</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Processing Mode</label>
          <select
            value={form.processingMode}
            onChange={(e) => setForm((f) => ({ ...f, processingMode: e.target.value }))}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          >
            <option value="non-ai">non-ai</option>
            <option value="ai">ai</option>
          </select>
        </div>

        {aiModeSelected && (
          <AiModelConfigSection
            aiKeys={aiKeys}
            keysLoading={aiKeysLoading}
            keyChain={keyChain}
            onKeyChainChange={setKeyChain}
            prompt={aiPrompt}
            onPromptChange={setAiPrompt}
            required
            totalKeysCount={totalKeysCount}
          />
        )}

        <div className="space-y-3 border-t border-white/10 pt-4">
          <EnabledAssetGrid
            kind="backgrounds"
            enabled={backgroundsEnabled}
            onEnabledChange={setBackgroundsEnabled}
            campaignId={campaign.id}
            canManage
          />
          <label className="flex items-start gap-2.5 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.backgroundRemoval}
              onChange={(e) => setForm((f) => ({ ...f, backgroundRemoval: e.target.checked }))}
              className="mt-0.5 rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
            />
            <span>
              Remove/change background
              <span className="block text-xs text-gray-500 mt-0.5">
                Applies to both AI and non-AI submissions.
              </span>
            </span>
          </label>
        </div>

        <div className="border-t border-white/10 pt-4">
          <EnabledAssetGrid
            kind="frames"
            enabled={framesEnabled}
            onEnabledChange={setFramesEnabled}
            campaignId={campaign.id}
            canManage
          />
        </div>

        <div className="border-t border-white/10 pt-4">
          <EnabledAssetGrid
            kind="props"
            enabled={propsEnabled}
            onEnabledChange={setPropsEnabled}
            campaignId={campaign.id}
            canManage
          />
        </div>

        {aiModeSelected && (
          <div className="border-t border-white/10 pt-4">
            <EnabledAssetGrid
              kind="templates"
              enabled={templatesEnabled}
              onEnabledChange={setTemplatesEnabled}
              campaignId={campaign.id}
              canManage
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Orientation</label>
          <select
            value={form.orientation}
            onChange={(e) => {
              const orientation = e.target.value;
              // Auto-fill the standard size for the chosen orientation —
              // still just a starting point, Output Width/Height below
              // stay freely editable for a custom size afterward.
              const [outputWidth, outputHeight] = orientation === 'landscape' ? [1920, 1080] : [1080, 1920];
              setForm((f) => ({ ...f, orientation, outputWidth, outputHeight }));
            }}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          >
            <option value="portrait">Portrait (1080 × 1920)</option>
            <option value="landscape">Landscape (1920 × 1080, 16:9)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Output Width</label>
            <input
              type="number"
              required
              value={form.outputWidth}
              onChange={(e) => setForm((f) => ({ ...f, outputWidth: e.target.value }))}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Output Height</label>
            <input
              type="number"
              required
              value={form.outputHeight}
              onChange={(e) => setForm((f) => ({ ...f, outputHeight: e.target.value }))}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Collect Fields</label>
          <div className="flex gap-4">
            {COLLECT_FIELD_OPTIONS.map((field) => (
              <label key={field} className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.collectFields.includes(field)}
                  onChange={() => toggleCollectField(field)}
                  className="rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
                />
                {field}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1.5">
            Leave all unchecked and the booth won&apos;t ask for any info before submitting.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Output Mode</label>
          <select
            value={form.outputMode}
            onChange={(e) => setForm((f) => ({ ...f, outputMode: e.target.value }))}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          >
            <option value="qr">QR Code</option>
            <option value="download">Download</option>
            <option value="print">Print</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </Modal>
  );
}
