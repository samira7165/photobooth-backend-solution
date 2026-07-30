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
import { hasRole, CAMPAIGN_STATUS_TRANSITIONS, formatDate } from '@/lib/utils';

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConfigSection title="Photo Settings" config={campaign.photoSettings} />
        <ConfigSection title="Brand Config" config={campaign.brandConfig} />
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

  useEffect(() => {
    if (campaign) {
      setForm({
        name: campaign.name,
        processingMode: campaign.processingMode,
        orientation: campaign.photoSettings?.orientation || 'portrait',
        outputWidth: campaign.photoSettings?.outputWidth || 1080,
        outputHeight: campaign.photoSettings?.outputHeight || 1920,
        outputMode: campaign.outputMode,
      });
    }
  }, [campaign]);

  if (!form) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
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
      });
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
            <option value="both">both</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Orientation</label>
          <select
            value={form.orientation}
            onChange={(e) => setForm((f) => ({ ...f, orientation: e.target.value }))}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
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
