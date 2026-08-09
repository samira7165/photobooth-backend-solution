'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Modal from './Modal';
import { resolveImageUrl } from '@/lib/utils';

export const ASSET_TYPES = [
  { kind: 'backgrounds', label: 'Backgrounds' },
  { kind: 'frames', label: 'Frames' },
  { kind: 'props', label: 'Props' },
  { kind: 'templates', label: 'AI Templates' },
];

const POSITION_TYPES = ['HEAD_TOP', 'FACE_EYES', 'FACE_FULL', 'HEAD_HAIR', 'BODY_NECK', 'HAND_HELD'];

export function AssetGrid({ kind, campaignId, canManage }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);

  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [positionType, setPositionType] = useState('HEAD_TOP');
  const [prompt, setPrompt] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/assets/${kind}/${campaignId}`, { params: { includeInactive: true } });
      setAssets(res.data);
    } catch (err) {
      setError(err.response?.data?.message || `Failed to load ${kind}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, campaignId]);

  const resetForm = () => {
    setName('');
    setFile(null);
    setPositionType('HEAD_TOP');
    setPrompt('');
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('campaignId', campaignId);
      formData.append('image', file);
      if (kind === 'props') formData.append('positionType', positionType);
      if (kind === 'templates' && prompt) formData.append('prompt', prompt);

      await api.post(`/assets/${kind}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadOpen(false);
      resetForm();
      load();
    } catch (err) {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this asset? This cannot be undone.')) return;
    try {
      await api.delete(`/assets/${kind}/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete asset');
    }
  };

  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">
          {ASSET_TYPES.find((t) => t.kind === kind)?.label} ({assets.length})
        </h3>
        {canManage && (
          <button
            onClick={() => setUploadOpen(true)}
            className="text-sm bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors"
          >
            + Upload
          </button>
        )}
      </div>

      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

      {loading ? (
        <div className="text-gray-500 text-sm py-6 text-center">Loading…</div>
      ) : assets.length === 0 ? (
        <div className="text-gray-500 text-sm py-6 text-center">No {kind} yet</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="bg-[#0a0a0a] border border-white/10 rounded-lg overflow-hidden group relative"
            >
              <button
                onClick={() => setPreview(asset)}
                className="w-full aspect-square bg-[#1a1a1a] flex items-center justify-center overflow-hidden"
              >
                {asset.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveImageUrl(asset.thumbnailUrl)}
                    alt={asset.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-gray-600 text-xs">No preview</span>
                )}
              </button>
              <div className="p-2">
                <div className="text-xs text-white truncate font-medium">{asset.name}</div>
                <div className="text-[10px] text-gray-500">
                  order: {asset.sortOrder} {!asset.isActive && '· inactive'}
                </div>
                {kind === 'templates' && (
                  <div className="text-[10px] text-gray-500 truncate mt-0.5" title={asset.prompt || ''}>
                    {asset.prompt ? asset.prompt : <span className="italic">uses campaign default prompt</span>}
                  </div>
                )}
              </div>
              {canManage && (
                <button
                  onClick={() => handleDelete(asset.id)}
                  className="absolute top-1.5 right-1.5 bg-black/70 hover:bg-red-600 text-white text-xs w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          resetForm();
        }}
        title={`Upload ${ASSET_TYPES.find((t) => t.kind === kind)?.label.slice(0, -1)}`}
      >
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            />
          </div>

          {kind === 'props' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Position Type</label>
              <select
                value={positionType}
                onChange={(e) => setPositionType(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              >
                {POSITION_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === 'templates' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Prompt <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="e.g. Turn this person into Spider-Man in the classic red-and-blue suit, web-slinging pose. Leave blank to use the campaign's default AI prompt for this template too."
                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Image</label>
            <input
              type="file"
              required
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#2563eb] file:text-white file:text-sm hover:file:bg-blue-700"
            />
          </div>

          <button
            type="submit"
            disabled={uploading}
            className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name || ''} maxWidth="max-w-2xl">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolveImageUrl(preview.imageUrl)}
            alt={preview.name}
            className="w-full rounded-lg"
          />
        )}
      </Modal>
    </div>
  );
}

export default function AssetsTab({ campaignId, canManage }) {
  return (
    <div className="space-y-6">
      {ASSET_TYPES.map((t) => (
        <AssetGrid key={t.kind} kind={t.kind} campaignId={campaignId} canManage={canManage} />
      ))}
    </div>
  );
}
