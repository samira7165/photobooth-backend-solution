import { API_ORIGIN } from './api';

// Asset/submission image URLs are stored as either:
//  - a local path starting with "/uploads/..." (dev fallback — servable
//    directly from the backend's static file middleware)
//  - a bare S3 key (production, once AWS credentials are configured) — those
//    need a presigned URL to be viewable, which most list endpoints don't
//    generate, so we just pass them through as a best effort.
export function resolveImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/uploads/')) return `${API_ORIGIN}${url}`;
  return `${API_ORIGIN}/uploads/${url}`;
}

export const COLLECT_FIELD_OPTIONS = ['name', 'phone', 'email'];

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function truncateId(id, len = 8) {
  if (!id) return '—';
  return id.slice(0, len);
}

export function timeAgo(value) {
  if (!value) return null;
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const SUBMISSION_STATUS_COLORS = {
  UPLOADED: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
  QUEUED: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  PROCESSING: 'bg-blue-500/20 text-blue-300 border-blue-500/40 animate-pulse',
  COMPLETED: 'bg-green-500/20 text-green-300 border-green-500/40',
  FAILED: 'bg-red-500/20 text-red-300 border-red-500/40',
};

export const CAMPAIGN_STATUS_COLORS = {
  DRAFT: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
  ACTIVE: 'bg-green-500/20 text-green-300 border-green-500/40',
  PAUSED: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  COMPLETED: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  ARCHIVED: 'bg-gray-600/20 text-gray-400 border-gray-600/40',
};

// Mirrors CampaignsService.updateStatus()'s validTransitions in the backend —
// keep in sync if that state machine changes.
export const CAMPAIGN_STATUS_TRANSITIONS = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['PAUSED', 'COMPLETED'],
  PAUSED: ['ACTIVE', 'COMPLETED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
};

export const ROLE_HIERARCHY = ['VIEWER', 'OPERATOR', 'ADMIN', 'SUPER_ADMIN'];

export function hasRole(userRole, minRole) {
  return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(minRole);
}
