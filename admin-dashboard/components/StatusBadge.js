import { SUBMISSION_STATUS_COLORS, CAMPAIGN_STATUS_COLORS } from '@/lib/utils';

export default function StatusBadge({ status, type = 'submission' }) {
  const colors = type === 'campaign' ? CAMPAIGN_STATUS_COLORS : SUBMISSION_STATUS_COLORS;
  const className = colors[status] || 'bg-gray-500/20 text-gray-300 border-gray-500/40';

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${className}`}
    >
      {status}
    </span>
  );
}
