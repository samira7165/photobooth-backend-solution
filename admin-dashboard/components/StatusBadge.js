import { SUBMISSION_STATUS_COLORS, CAMPAIGN_STATUS_COLORS, PROCESSING_MODE_COLORS } from '@/lib/utils';

export default function StatusBadge({ status, type = 'submission' }) {
  const colors =
    type === 'campaign' ? CAMPAIGN_STATUS_COLORS : type === 'mode' ? PROCESSING_MODE_COLORS : SUBMISSION_STATUS_COLORS;
  const label = type === 'mode' ? (status || '').toUpperCase() : status;
  const className = colors[label] || 'bg-gray-500/20 text-gray-300 border-gray-500/40';

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${className}`}
    >
      {type === 'mode' ? (label === 'AI' ? 'AI' : 'Non-AI') : status}
    </span>
  );
}
