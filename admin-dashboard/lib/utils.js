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

// A photo submission's resultUrl is always .png, but a video-booth
// submission's is .webm/.mp4/etc — hardcoding ".png" on download would save
// a real video under a filename that lies about its content (Windows then
// refuses to open it as a video). Matches the extension right before the
// end of the string or a "?" so it works on both a bare local path and a
// presigned S3 URL with a query string.
export function resultExtension(url) {
  const match = url?.match(/\.[a-zA-Z0-9]+(?=$|\?)/);
  return match ? match[0] : '.png';
}

// Fetches the image into a Blob first rather than a plain `<a href download>`
// — the `download` attribute is silently ignored by browsers for a
// cross-origin href (the dashboard on :3001 fetching from the API on :3000,
// or a presigned S3 URL), so without this the browser would just navigate to
// the image instead of downloading it. Same technique already used for the
// integration-config JSON download on the campaign detail page.
export async function downloadFile(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

// Opens a plain new window with just the image and triggers the browser's
// native print dialog once it's actually loaded — printing directly out of
// the dashboard page itself would print the whole page chrome (sidebar,
// nav, other rows) along with it.
export function printImageUrl(url) {
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) {
    alert('Please allow pop-ups for this site to print.');
    return;
  }
  win.document.write(
    '<!DOCTYPE html><html><head><title>Print</title><style>' +
      'body{margin:0;display:flex;align-items:center;justify-content:center;background:#fff;min-height:100vh;}' +
      'img{max-width:100%;max-height:100vh;}' +
      '</style></head><body><img id="print-target" alt="" /></body></html>',
  );
  win.document.close();
  const img = win.document.getElementById('print-target');
  const triggerPrint = () => {
    win.focus();
    win.print();
  };
  img.onload = triggerPrint;
  img.onerror = () => {
    win.document.body.textContent = 'Failed to load image.';
  };
  img.src = url;
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

// Campaign processingMode is the free-text string "ai" / "non-ai" from the
// backend — normalized to uppercase for the lookup so casing changes there
// don't silently fall through to the gray default.
export const PROCESSING_MODE_COLORS = {
  AI: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  'NON-AI': 'bg-slate-500/20 text-slate-300 border-slate-500/40',
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
