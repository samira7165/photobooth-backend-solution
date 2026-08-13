'use client';

import { useState } from 'react';
import api from '@/lib/api';
import { AssetGrid, ASSET_TYPES } from './AssetsTab';

const POSITION_TYPES = ['HEAD_TOP', 'FACE_EYES', 'FACE_FULL', 'HEAD_HAIR', 'BODY_NECK', 'HAND_HELD'];

function labelFor(kind) {
  return ASSET_TYPES.find((t) => t.kind === kind)?.label || kind;
}

// Create-campaign flow, before any asset has been added yet: there's no
// campaign ID to upload against, so the first "+ Add" click (for whichever
// kind the admin touches first) calls onEnsureCampaign() to create a real
// DRAFT campaign, then uploads straight to it — same as every add after
// that. Once a draft exists, the page that renders this swaps every section
// over to EnabledAssetGrid below instead (a real campaign ID always exists
// by then), so this component's own upload path only ever runs once, for
// whichever section is touched first.
export function StagedAssetSection({ kind, enabled, onEnabledChange, onEnsureCampaign }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [positionType, setPositionType] = useState('HEAD_TOP');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const label = labelFor(kind);

  const addItem = async () => {
    if (!name.trim() || !file) return;
    setSaving(true);
    try {
      const campaignId = await onEnsureCampaign();
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('campaignId', campaignId);
      fd.append('image', file);
      if (kind === 'props') fd.append('positionType', positionType);
      if (kind === 'templates' && prompt) fd.append('prompt', prompt);
      await api.post(`/assets/${kind}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      alert(`Saved — "${name.trim()}" was uploaded successfully.`);
      setName('');
      setFile(null);
      setPrompt('');
    } catch (err) {
      alert(err.response?.data?.message || `Failed to save ${label.toLowerCase().replace(/s$/, '')}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label className="flex items-center gap-2.5 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
        />
        Enable {label}
      </label>

      {enabled && (
        <div className="mt-3 pl-6 space-y-3">
          <div className="border border-white/10 rounded-lg p-3 space-y-2">
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#111111] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            />
            {kind === 'props' && (
              <select
                value={positionType}
                onChange={(e) => setPositionType(e.target.value)}
                className="w-full bg-[#111111] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              >
                {POSITION_TYPES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}
            {kind === 'templates' && (
              <textarea
                placeholder="Prompt (optional) — leave blank to use the campaign's default AI prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                className="w-full bg-[#111111] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              />
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#2563eb] file:text-white file:text-xs hover:file:bg-blue-700"
            />
            <button
              type="button"
              onClick={addItem}
              disabled={saving || !name.trim() || !file}
              className="text-xs text-[#2563eb] hover:underline disabled:opacity-40 disabled:no-underline"
            >
              {saving ? 'Saving…' : `+ Add ${label.replace(/s$/, '')}`}
            </button>
            {!saving && (!name.trim() || !file) && (
              <p className="text-[11px] text-gray-500">
                {!name.trim() && !file
                  ? 'Enter a name and choose a file to enable Add.'
                  : !name.trim()
                    ? 'Enter a name to enable Add.'
                    : 'Choose a file to enable Add.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Edit-campaign flow, and the create-campaign flow once a draft campaign
// exists: a real campaign ID is always available, so this is just the same
// AssetGrid the Assets tab uses — uploads/deletes immediately against the
// real API, no staging involved.
export function EnabledAssetGrid({ kind, enabled, onEnabledChange, campaignId, canManage }) {
  const label = labelFor(kind);
  return (
    <div>
      <label className="flex items-center gap-2.5 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
        />
        Enable {label}
      </label>
      {enabled && (
        <div className="mt-3 pl-6">
          <AssetGrid kind={kind} campaignId={campaignId} canManage={canManage} />
        </div>
      )}
    </div>
  );
}
