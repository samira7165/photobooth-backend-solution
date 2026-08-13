'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import AiModelConfigSection, { flattenProviderKeys, countAllKeys } from '@/components/AiModelConfigSection';
import { StagedAssetSection, EnabledAssetGrid } from '@/components/StagedAssetSection';
import { COLLECT_FIELD_OPTIONS } from '@/lib/utils';

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export default function CreateCampaignPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const [form, setForm] = useState({
    name: '',
    slug: '',
    processingMode: 'non-ai',
    orientation: 'portrait',
    outputWidth: 1080,
    outputHeight: 1920,
    collectFields: ['name', 'phone'],
    outputMode: 'qr',
    backgroundRemoval: false,
  });

  const [aiKeys, setAiKeys] = useState([]);
  const [aiKeysLoading, setAiKeysLoading] = useState(true);
  const [totalKeysCount, setTotalKeysCount] = useState(0);
  const [keyChain, setKeyChain] = useState(['']);
  const [aiPrompt, setAiPrompt] = useState('');

  const [backgroundsEnabled, setBackgroundsEnabled] = useState(false);
  const [framesEnabled, setFramesEnabled] = useState(false);
  const [propsEnabled, setPropsEnabled] = useState(false);
  const [templatesEnabled, setTemplatesEnabled] = useState(false);

  // Set once the campaign is actually created — the integrationConfig it
  // carries contains a plaintext API key shown only this one time (see
  // CampaignsService.create), so instead of navigating away immediately,
  // the form is replaced with a "download this now" screen first.
  const [createdCampaign, setCreatedCampaign] = useState(null);

  // The moment the admin adds their first Background/Frame/Prop/Template,
  // there's no campaign to attach it to yet — creating one right then (as a
  // DRAFT, using whatever Name/Slug/Processing Mode has been filled in so
  // far) means that upload, and every one after it, saves for real
  // immediately instead of sitting in browser memory until the whole form
  // is submitted. "Create Campaign" below then just finalizes this same
  // draft's settings (PATCH) instead of creating a second campaign.
  const [draftCampaignId, setDraftCampaignId] = useState(null);
  const [draftIntegrationConfig, setDraftIntegrationConfig] = useState(null);
  // Guards against a burst of near-simultaneous "+ Add" clicks (different
  // sections) each racing to create their own draft — every caller awaits
  // this same in-flight request instead.
  const draftCreationRef = useRef(null);

  const ensureDraftCampaign = async () => {
    if (draftCampaignId) return draftCampaignId;
    if (draftCreationRef.current) return draftCreationRef.current;

    const promise = (async () => {
      const baseSlug = form.slug || slugify(form.name) || `draft-${Date.now()}`;
      let slug = baseSlug;
      for (let attempt = 0; ; attempt += 1) {
        try {
          const res = await api.post('/campaigns', {
            name: form.name || 'Untitled Campaign',
            slug,
            processingMode: form.processingMode,
          });
          setDraftCampaignId(res.data.id);
          setDraftIntegrationConfig(res.data.integrationConfig || null);
          return res.data.id;
        } catch (err) {
          // This is an internal placeholder slug at this point (the real
          // one, if different, gets set for real when the form is finally
          // submitted below) — a collision here isn't something to bother
          // the admin with, just retry with a random suffix.
          if (err.response?.status === 409 && attempt < 5) {
            slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
            continue;
          }
          throw err;
        }
      }
    })();

    draftCreationRef.current = promise;
    try {
      return await promise;
    } finally {
      draftCreationRef.current = null;
    }
  };

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

  const aiModeSelected = form.processingMode === 'ai' || form.processingMode === 'both';

  const handleNameChange = (value) => {
    setForm((f) => ({
      ...f,
      name: value,
      slug: slugTouched ? f.slug : slugify(value),
    }));
  };

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
      setError('Select a Primary Model before creating an AI-enabled campaign');
      return;
    }

    setSaving(true);

    try {
      const aiConfig = aiModeSelected
        ? {
            prompt: aiPrompt,
            keyChain: chain,
            fallbackProviders: chain.map((id) => aiKeys.find((k) => k.id === id)?.providerName).filter(Boolean),
          }
        : undefined;

      const body = {
        name: form.name,
        slug: form.slug,
        processingMode: form.processingMode,
        photoSettings: {
          orientation: form.orientation,
          outputWidth: Number(form.outputWidth),
          outputHeight: Number(form.outputHeight),
        },
        backgroundConfig: {
          enabled: backgroundsEnabled,
          removal: form.backgroundRemoval,
          allowCustomUpload: false,
        },
        frameConfig: { enabled: framesEnabled },
        propConfig: { enabled: propsEnabled },
        ...(aiConfig && { aiConfig }),
        collectFields: form.collectFields,
        outputMode: form.outputMode,
      };

      // If any Background/Frame/Prop/Template was already added, a DRAFT
      // campaign was created for real back when that happened (see
      // ensureDraftCampaign) — finalizing just means updating that same
      // campaign's settings (PATCH), not creating a second one. Its
      // integrationConfig was already captured then too, since PATCH
      // doesn't return one.
      let campaignId;
      let integrationConfig;
      if (draftCampaignId) {
        campaignId = draftCampaignId;
        integrationConfig = draftIntegrationConfig;
        await api.patch(`/campaigns/${campaignId}`, body);
      } else {
        const res = await api.post('/campaigns', body);
        campaignId = res.data.id;
        integrationConfig = res.data.integrationConfig;
      }

      // chain entries are ApiKeyModel ids (one key can appear more than once
      // under different models) — link the underlying key once per unique
      // ApiKey id, not once per chain entry.
      const apiKeyIdsToLink = [...new Set(chain.map((id) => aiKeys.find((k) => k.id === id)?.apiKeyId).filter(Boolean))];

      if (apiKeyIdsToLink.length > 0) {
        const results = await Promise.allSettled(
          apiKeyIdsToLink.map((keyId) => api.post(`/ai-providers/keys/${keyId}/link/${campaignId}`)),
        );
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          console.error('Some AI keys failed to link to the new campaign:', failed);
        }
      }

      if (integrationConfig) {
        // Plaintext apiKey only ever exists in this one response — show the
        // download screen instead of navigating straight past it.
        setCreatedCampaign({ id: campaignId, integrationConfig });
        setSaving(false);
      } else {
        router.push(`/campaigns/${campaignId}`);
      }
    } catch (err) {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to create campaign');
      setSaving(false);
    }
  };

  const handleDownloadConfig = () => {
    if (!createdCampaign) return;
    const blob = new Blob([JSON.stringify(createdCampaign.integrationConfig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${createdCampaign.integrationConfig.campaignSlug}-integration-config.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (createdCampaign) {
    const cfg = createdCampaign.integrationConfig;
    return (
      <DashboardLayout title="Campaign Created">
        <div className="max-w-2xl space-y-6">
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-lg px-4 py-3">
            &quot;{cfg.campaignName}&quot; was created successfully.
          </div>

          <div className="bg-[#111111] border border-white/10 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Integration Config</h3>
            <p className="text-sm text-gray-400">
              This file has everything an external developer needs to build a frontend for this campaign —
              including an API key. <span className="text-amber-400">It&apos;s shown only this once</span>{' '}
              and cannot be recovered later; if you don&apos;t download it now, you&apos;ll need to generate
              a new key instead.
            </p>
            <button
              onClick={handleDownloadConfig}
              className="w-full bg-[#2563eb] hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
            >
              Download Integration Config (.json)
            </button>
          </div>

          <button
            onClick={() => router.push(`/campaigns/${createdCampaign.id}`)}
            className="w-full border border-white/10 hover:bg-white/5 text-gray-300 text-sm rounded-lg px-4 py-2.5 transition-colors"
          >
            Continue to Campaign →
          </button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Create Campaign">
      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <Section title="Basics">
          <Field label="Campaign Name">
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={inputClass}
              placeholder="Shah Cement Photobooth"
            />
          </Field>
          <Field label="Slug" hint="Lowercase letters, numbers, and hyphens only">
            <input
              type="text"
              required
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setForm((f) => ({ ...f, slug: slugify(e.target.value) }));
              }}
              className={`${inputClass} font-mono`}
              placeholder="shah-cement-2026"
            />
          </Field>
          <Field label="Processing Mode">
            <select
              value={form.processingMode}
              onChange={(e) => setForm((f) => ({ ...f, processingMode: e.target.value }))}
              className={inputClass}
            >
              <option value="non-ai">non-ai</option>
              <option value="ai">ai</option>
            </select>
          </Field>
        </Section>

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

        <Section title="Photo Settings">
          <Field label="Orientation">
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
              className={inputClass}
            >
              <option value="portrait">Portrait (1080 × 1920)</option>
              <option value="landscape">Landscape (1920 × 1080, 16:9)</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Output Width">
              <input
                type="number"
                required
                min={1}
                value={form.outputWidth}
                onChange={(e) => setForm((f) => ({ ...f, outputWidth: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Output Height">
              <input
                type="number"
                required
                min={1}
                value={form.outputHeight}
                onChange={(e) => setForm((f) => ({ ...f, outputHeight: e.target.value }))}
                className={inputClass}
              />
            </Field>
          </div>
        </Section>

        <Section title="Backgrounds">
          {draftCampaignId ? (
            <EnabledAssetGrid
              kind="backgrounds"
              enabled={backgroundsEnabled}
              onEnabledChange={setBackgroundsEnabled}
              campaignId={draftCampaignId}
              canManage
            />
          ) : (
            <StagedAssetSection
              kind="backgrounds"
              enabled={backgroundsEnabled}
              onEnabledChange={setBackgroundsEnabled}
              onEnsureCampaign={ensureDraftCampaign}
            />
          )}
          <label className="flex items-start gap-2.5 text-sm text-gray-300 pt-1 border-t border-white/5">
            <input
              type="checkbox"
              checked={form.backgroundRemoval}
              onChange={(e) => setForm((f) => ({ ...f, backgroundRemoval: e.target.checked }))}
              className="mt-0.5 rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
            />
            <span>
              Remove/change background
              <span className="block text-xs text-gray-500 mt-0.5">
                Applies to both AI and non-AI submissions; for AI mode, the swap happens before
                the photo is sent for generation.
              </span>
            </span>
          </label>
        </Section>

        <Section title="Frames">
          {draftCampaignId ? (
            <EnabledAssetGrid
              kind="frames"
              enabled={framesEnabled}
              onEnabledChange={setFramesEnabled}
              campaignId={draftCampaignId}
              canManage
            />
          ) : (
            <StagedAssetSection
              kind="frames"
              enabled={framesEnabled}
              onEnabledChange={setFramesEnabled}
              onEnsureCampaign={ensureDraftCampaign}
            />
          )}
        </Section>

        <Section title="Props">
          {draftCampaignId ? (
            <EnabledAssetGrid
              kind="props"
              enabled={propsEnabled}
              onEnabledChange={setPropsEnabled}
              campaignId={draftCampaignId}
              canManage
            />
          ) : (
            <StagedAssetSection
              kind="props"
              enabled={propsEnabled}
              onEnabledChange={setPropsEnabled}
              onEnsureCampaign={ensureDraftCampaign}
            />
          )}
        </Section>

        {aiModeSelected && (
          <Section title="AI Templates">
            {draftCampaignId ? (
              <EnabledAssetGrid
                kind="templates"
                enabled={templatesEnabled}
                onEnabledChange={setTemplatesEnabled}
                campaignId={draftCampaignId}
                canManage
              />
            ) : (
              <StagedAssetSection
                kind="templates"
                enabled={templatesEnabled}
                onEnabledChange={setTemplatesEnabled}
                onEnsureCampaign={ensureDraftCampaign}
              />
            )}
          </Section>
        )}

        <Section title="Submission">
          <Field label="Collect Fields">
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
          </Field>
          <Field label="Output Mode">
            <select
              value={form.outputMode}
              onChange={(e) => setForm((f) => ({ ...f, outputMode: e.target.value }))}
              className={inputClass}
            >
              <option value="qr">QR Code</option>
              <option value="download">Download</option>
              <option value="print">Print</option>
            </select>
          </Field>
        </Section>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-5 py-2.5 transition-colors"
          >
            {saving ? 'Saving…' : draftCampaignId ? 'Finish Campaign' : 'Create Campaign'}
          </button>
          <button
            type="button"
            onClick={async () => {
              // Anything added so far is already saved for real against
              // draftCampaignId — leaving without finishing would abandon a
              // half-configured DRAFT campaign in the database with no way
              // back to it from this screen, so offer to delete it outright
              // rather than silently orphaning it.
              if (draftCampaignId) {
                if (!confirm('This will delete the draft campaign and everything added to it so far. Continue?')) return;
                try {
                  await api.delete(`/campaigns/${draftCampaignId}`);
                } catch (err) {
                  console.error('Failed to delete abandoned draft campaign:', err);
                }
              }
              router.push('/campaigns');
            }}
            className="border border-white/10 hover:bg-white/5 text-gray-300 text-sm font-medium rounded-lg px-5 py-2.5 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </DashboardLayout>
  );
}

const inputClass =
  'w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent';

function Section({ title, children }) {
  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

