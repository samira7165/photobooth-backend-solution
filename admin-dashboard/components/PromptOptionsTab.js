'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Modal from './Modal';
import { resolveImageUrl } from '@/lib/utils';

const EMPTY_FORM = { name: '', description: '', prompt: '', isActive: true };

// Same overall shape as AssetGrid (components/AssetsTab.js) — list, create,
// delete — plus edit and reorder, which assets don't need here since a
// PromptOption has no image to replace and (unlike backgrounds/frames/props)
// this is the only place its text ever gets set.
export default function PromptOptionsTab({ campaignId, canManage, campaign, onCampaignUpdated }) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reordering, setReordering] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = creating, else the option being edited
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [preview, setPreview] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/prompt-options', { params: { campaignId, includeInactive: true } });
      setOptions(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load prompt options');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFile(null);
    setSaveError('');
    setModalOpen(true);
  };

  const openEdit = (option) => {
    setEditing(option);
    setForm({
      name: option.name,
      description: option.description || '',
      prompt: option.prompt,
      isActive: option.isActive,
    });
    setFile(null);
    setSaveError('');
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.prompt.trim()) {
      setSaveError('Name and Prompt are required.');
      return;
    }
    setSaving(true);
    setSaveError('');

    try {
      const formData = new FormData();
      if (!editing) formData.append('campaignId', campaignId);
      formData.append('name', form.name);
      formData.append('description', form.description || '');
      formData.append('prompt', form.prompt);
      formData.append('isActive', String(form.isActive));
      if (file) formData.append('thumbnail', file);

      if (editing) {
        await api.patch(`/prompt-options/${editing.id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        await api.post('/prompt-options', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      alert(`Saved — "${form.name}" was saved successfully.`);
      setModalOpen(false);
      load();
    } catch (err) {
      const msg = err.response?.data?.message;
      setSaveError(Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to save prompt option');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (option) => {
    if (!confirm(`Delete "${option.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/prompt-options/${option.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete prompt option');
    }
  };

  // Swaps the option at `index` with its neighbor and sends the FULL
  // resulting order — POST /prompt-options/reorder sets sortOrder from each
  // id's position in the array, not just the two that moved.
  const move = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= options.length) return;

    const reordered = [...options];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setOptions(reordered); // optimistic — reorder() below reconciles with the server's response either way
    setReordering(true);
    try {
      const res = await api.post('/prompt-options/reorder', { ids: reordered.map((o) => o.id) });
      setOptions(res.data);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to reorder');
      load(); // roll back the optimistic update
    } finally {
      setReordering(false);
    }
  };

  return (
    <div className="space-y-6">
      <PromptModeSettings campaign={campaign} canManage={canManage} onSaved={onCampaignUpdated} />

      <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-white">Prompt Options ({options.length})</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Booth-selectable text prompts — no reference image, just the user&apos;s photo + this prompt.
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="shrink-0 text-sm bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors"
          >
            + Add Option
          </button>
        )}
      </div>

      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

      {loading ? (
        <div className="text-gray-500 text-sm py-6 text-center">Loading…</div>
      ) : options.length === 0 ? (
        <div className="text-gray-500 text-sm py-6 text-center">No prompt options yet</div>
      ) : (
        <div className="space-y-2">
          {options.map((option, index) => (
            <div
              key={option.id}
              className="flex items-center gap-3 bg-[#0a0a0a] border border-white/10 rounded-lg p-3"
            >
              <button
                onClick={() => setPreview(option)}
                className="shrink-0 w-14 h-14 rounded-lg bg-[#1a1a1a] flex items-center justify-center overflow-hidden"
                title="View prompt"
              >
                {option.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveImageUrl(option.thumbnailUrl)}
                    alt={option.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-gray-600 text-[10px] text-center px-1">No thumb</span>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium truncate">{option.name}</span>
                  {!option.isActive && (
                    <span className="text-[10px] text-gray-500 border border-white/10 rounded px-1.5 py-0.5 shrink-0">
                      inactive
                    </span>
                  )}
                </div>
                {option.description && (
                  <div className="text-xs text-gray-400 truncate">{option.description}</div>
                )}
                <div className="text-[11px] text-gray-500 truncate" title={option.prompt}>
                  {option.prompt}
                </div>
              </div>

              {canManage && (
                <div className="shrink-0 flex items-center gap-1">
                  <button
                    onClick={() => move(index, -1)}
                    disabled={reordering || index === 0}
                    className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed w-7 h-7 rounded"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={reordering || index === options.length - 1}
                    className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed w-7 h-7 rounded"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => openEdit(option)}
                    className="text-sm border border-white/10 hover:bg-white/5 text-gray-300 rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(option)}
                    className="text-sm border border-red-500/30 hover:bg-red-500/10 text-red-400 rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit "${editing.name}"` : 'Add Prompt Option'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          {saveError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2">
              {saveError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Name <span className="text-gray-500 font-normal">(shown on the booth screen)</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Doctor"
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Description <span className="text-gray-500 font-normal">(optional, shown below the name)</span>
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Become a professional doctor"
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Prompt <span className="text-gray-500 font-normal">(sent to the AI provider — never shown to the booth user)</span>
            </label>
            <textarea
              required
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              rows={6}
              placeholder="e.g. Transform this person into a professional doctor wearing a white lab coat with a stethoscope around their neck, standing in a modern hospital. Keep their face exactly the same. Professional studio lighting, photorealistic."
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Thumbnail <span className="text-gray-500 font-normal">(optional preview image for the booth selection screen)</span>
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#2563eb] file:text-white file:text-sm hover:file:bg-blue-700"
            />
            {editing?.thumbnailUrl && !file && (
              <p className="text-xs text-gray-500 mt-1.5">Leave blank to keep the current thumbnail.</p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
            />
            Active (shown on the booth)
          </label>

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name || ''} maxWidth="max-w-lg">
        {preview && (
          <div className="space-y-3">
            {preview.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveImageUrl(preview.thumbnailUrl)} alt={preview.name} className="w-full rounded-lg" />
            )}
            {preview.description && <p className="text-sm text-gray-300">{preview.description}</p>}
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Prompt</div>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{preview.prompt}</p>
            </div>
          </div>
        )}
      </Modal>
      </div>
    </div>
  );
}

// Owns campaign.aiConfig.promptMode / .customInput end-to-end (its own PATCH
// call) — previously split across this tab (the options themselves) and a
// buried section of the Edit Campaign modal (the "use these at all?" +
// "Other" toggles), which was confusing enough that admins couldn't find
// where to turn "Other" on. Now everything prompt-option-related lives in
// one place. EditCampaignModal still owns the separate AI Templates toggle,
// and passes promptMode/customInput through untouched when it saves — see
// the comment above its own aiConfig payload.
function PromptModeSettings({ campaign, canManage, onSaved }) {
  const [promptOptionsEnabled, setPromptOptionsEnabled] = useState(false);
  const [customInputEnabled, setCustomInputEnabled] = useState(false);
  const [customInputLabel, setCustomInputLabel] = useState('');
  const [customInputMaxLength, setCustomInputMaxLength] = useState(50);
  const [customInputTemplate, setCustomInputTemplate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    const promptMode = campaign.aiConfig?.promptMode;
    setPromptOptionsEnabled(promptMode === 'prompt-option' || promptMode === 'both');

    const customInput = campaign.aiConfig?.customInput || {};
    setCustomInputEnabled(!!customInput.enabled);
    setCustomInputLabel(customInput.label || 'Type what you want to be...');
    setCustomInputMaxLength(customInput.maxLength || 50);
    setCustomInputTemplate(customInput.promptTemplate || '');
  }, [campaign]);

  if (!campaign) return null;

  const aiCapable = campaign.processingMode === 'ai' || campaign.processingMode === 'both';
  if (!aiCapable) {
    return (
      <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
        <p className="text-sm text-gray-500">
          This campaign&apos;s Processing Mode is &quot;{campaign.processingMode}&quot; — Prompt Options only apply
          to AI-mode campaigns. Change Processing Mode to &quot;ai&quot; under Edit Campaign first.
        </p>
      </div>
    );
  }

  const handleSave = async () => {
    setError('');
    if (customInputEnabled && !customInputTemplate.trim()) {
      setError('Custom input needs a Prompt Template before saving.');
      return;
    }
    setSaving(true);
    try {
      // Preserve every other aiConfig field (prompt, keyChain,
      // fallbackProviders, templatesEnabled) exactly as-is — this save only
      // ever touches promptMode/customInput.
      const templateCapable = !!campaign.aiConfig?.templatesEnabled;
      await api.patch(`/campaigns/${campaign.id}`, {
        aiConfig: {
          ...campaign.aiConfig,
          promptMode: promptOptionsEnabled && templateCapable ? 'both' : promptOptionsEnabled ? 'prompt-option' : 'template',
          customInput:
            promptOptionsEnabled && customInputEnabled
              ? {
                  enabled: true,
                  label: customInputLabel || 'Type what you want to be...',
                  maxLength: Number(customInputMaxLength) || 50,
                  promptTemplate: customInputTemplate,
                }
              : { enabled: false },
        },
      });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      onSaved?.();
    } catch (err) {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <h3 className="font-semibold text-white mb-1">Booth Prompt Mode</h3>
      <p className="text-xs text-gray-500 mb-4">
        Controls whether the booth shows the Prompt Options below at all, and whether it also offers an
        &quot;Other&quot; option for the user to type their own answer.
      </p>

      <fieldset disabled={!canManage} className="space-y-4">
        <label className="flex items-start gap-2.5 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={promptOptionsEnabled}
            onChange={(e) => setPromptOptionsEnabled(e.target.checked)}
            className="mt-0.5 rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
          />
          <span>
            Show Prompt Options at the booth
            <span className="block text-xs text-gray-500 mt-0.5">
              Off = the booth uses AI Templates (if any) instead. Turn this on for the options below to actually
              appear to customers.
            </span>
          </span>
        </label>

        {promptOptionsEnabled && (
          <div className="pl-6 space-y-3 border-l border-white/10">
            <label className="flex items-start gap-2.5 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={customInputEnabled}
                onChange={(e) => setCustomInputEnabled(e.target.checked)}
                className="mt-0.5 rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
              />
              <span>
                Allow custom input (&quot;Other&quot;)
                <span className="block text-xs text-gray-500 mt-0.5">
                  Adds an extra tile at the end of the booth&apos;s list where the user types their own answer
                  instead of picking one of the options below.
                </span>
              </span>
            </label>

            {customInputEnabled && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">&quot;Other&quot; input label</label>
                  <input
                    type="text"
                    value={customInputLabel}
                    onChange={(e) => setCustomInputLabel(e.target.value)}
                    placeholder="Type what you want to be..."
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Max characters</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={customInputMaxLength}
                    onChange={(e) => setCustomInputMaxLength(e.target.value)}
                    className="w-32 bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Prompt Template <span className="text-gray-500 font-normal">(this is where the &quot;Other&quot; prompt goes)</span>
                  </label>
                  <textarea
                    value={customInputTemplate}
                    onChange={(e) => setCustomInputTemplate(e.target.value)}
                    rows={5}
                    placeholder="e.g. Transform this person into a {user_input}. Keep their face exactly the same. Photorealistic, professional studio lighting."
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  />
                  <p className="text-xs text-gray-500 mt-1.5">
                    Must include the literal text <code className="text-gray-400">{'{user_input}'}</code> — it&apos;s
                    replaced with whatever the booth user typed. Leave it out and their answer is just appended to
                    the end instead.
                  </p>
                  {customInputTemplate && !customInputTemplate.includes('{user_input}') && (
                    <p className="text-xs text-amber-400 mt-1">
                      No <code>{'{user_input}'}</code> placeholder found — the typed answer will be appended to the
                      end instead of substituted in place.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {error && <div className="text-red-400 text-sm mt-3">{error}</div>}

      {canManage && (
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {justSaved && <span className="text-xs text-green-400">Saved</span>}
        </div>
      )}
    </div>
  );
}
