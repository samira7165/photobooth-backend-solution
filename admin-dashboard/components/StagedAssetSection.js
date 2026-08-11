'use client';

import { useState } from 'react';
import api from '@/lib/api';
import { AssetGrid, ASSET_TYPES } from './AssetsTab';

const POSITION_TYPES = ['HEAD_TOP', 'FACE_EYES', 'FACE_FULL', 'HEAD_HAIR', 'BODY_NECK', 'HAND_HELD'];

function labelFor(kind) {
  return ASSET_TYPES.find((t) => t.kind === kind)?.label || kind;
}

// Uploads every staged item for one asset kind, called once a campaign ID
// actually exists (right after POST /campaigns succeeds). Best-effort: one
// item failing doesn't stop the rest, matching how AI-key linking after
// create already behaves.
export async function uploadStagedItems(kind, campaignId, items) {
  const results = await Promise.allSettled(
    items.map((item) => {
      const fd = new FormData();
      fd.append('name', item.name);
      fd.append('campaignId', campaignId);
      fd.append('image', item.file);
      if (item.positionType) fd.append('positionType', item.positionType);
      if (item.prompt) fd.append('prompt', item.prompt);
      return api.post(`/assets/${kind}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    }),
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    console.error(`Some ${kind} failed to upload:`, failed);
  }
  return { total: items.length, failed: failed.length };
}

// Create-campaign flow: no campaign ID exists yet, so uploads can't actually
// happen items are held in browser memory (staged) and only sent via
// uploadStagedItems() once the campaign is created. Checking the box reveals
// this uploader; unchecking it just hides it (staged items are kept, in case
// it was an accidental click they're only discarded on unmount/submit).
export function StagedAssetSection({ kind, enabled, onEnabledChange, items, onItemsChange }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [positionType, setPositionType] = useState('HEAD_TOP');
  const [prompt, setPrompt] = useState('');
  const label = labelFor(kind);

  const addItem = () => {
    if (!name.trim() || !file) return;
    onItemsChange([
      ...items,
      {
        localId: `${Date.now()}-${Math.random()}`,
        name: name.trim(),
        file,
        previewUrl: URL.createObjectURL(file),
        positionType: kind === 'props' ? positionType : undefined,
        prompt: kind === 'templates' ? prompt || undefined : undefined,
      },
    ]);
    setName('');
    setFile(null);
    setPrompt('');
  };

  const removeItem = (localId) => onItemsChange(items.filter((i) => i.localId !== localId));

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
          {items.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {items.map((item) => (
                <div key={item.localId} className="bg-[#0a0a0a] border border-white/10 rounded-lg overflow-hidden relative group">
                  <div className="aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.previewUrl} alt={item.name} className="w-full h-full object-cover" />
                  </div>
                  <div className="px-1.5 py-1 text-[10px] text-white truncate">{item.name}</div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.localId)}
                    className="absolute top-1 right-1 bg-black/70 hover:bg-red-600 text-white text-xs w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

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
              disabled={!name.trim() || !file}
              className="text-xs text-[#2563eb] hover:underline disabled:opacity-40 disabled:no-underline"
            >
              + Add {label.replace(/s$/, '')}
            </button>
            {(!name.trim() || !file) && (
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

// Edit-campaign flow: the campaign already has a real ID, so there's nothing
// to stage — checking the box just reveals the same AssetGrid the Assets tab
// uses, which uploads/deletes immediately against the real API.
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
