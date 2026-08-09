'use client';

import Modal from './Modal';
import StatusBadge from './StatusBadge';
import { formatDate, resolveImageUrl } from '@/lib/utils';

export default function SubmissionDetailModal({ submission, onClose }) {
  return (
    <Modal open={!!submission} onClose={onClose} title="Submission Details">
      {submission && (
        <div className="space-y-2 text-sm">
          <DetailRow label="ID" value={submission.id} mono />
          <DetailRow label="Campaign" value={submission.campaign?.name} />
          <DetailRow label="Status" value={<StatusBadge status={submission.status} />} />
          <DetailRow label="Name" value={submission.userName} />
          <DetailRow label="Phone" value={submission.userPhone} />
          <DetailRow label="Email" value={submission.userEmail} />
          <DetailRow label="Mode" value={submission.mode} />
          <DetailRow label="Orientation" value={submission.orientation} />
          <DetailRow label="Background Used" value={submission.backgroundUsed} />
          <DetailRow label="Frame Used" value={submission.frameUsed} />
          <DetailRow label="Style Used" value={submission.styleUsed} />
          <DetailRow label="Template Used" value={submission.templateUsed} mono />
          <DetailRow label="AI Provider" value={submission.aiProvider} />
          <DetailRow label="AI Model" value={submission.aiModel} />
          <DetailRow label="Prompt Used" value={submission.promptUsed} className="whitespace-pre-wrap text-left max-w-[70%]" />
          <DetailRow label="Tokens Used" value={submission.tokensUsed} />
          <DetailRow label="Cost Estimate" value={submission.costEstimate ? `$${submission.costEstimate}` : null} />
          {submission.referenceImageUrl && (
            <div className="py-1.5 border-b border-white/5">
              <div className="text-gray-400 mb-1.5">Reference Image Sent to AI</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveImageUrl(submission.referenceImageUrl)}
                alt="AI reference"
                className="w-24 h-24 object-cover rounded-lg border border-white/10"
              />
            </div>
          )}
          <DetailRow label="Processing Time" value={submission.processingTime ? `${submission.processingTime}ms` : null} />
          <DetailRow label="Retry Count" value={submission.retryCount} />
          {submission.errorMessage && (
            <DetailRow label="Error" value={submission.errorMessage} className="text-red-400" />
          )}
          <DetailRow label="Created At" value={formatDate(submission.createdAt)} />
          <DetailRow label="Updated At" value={formatDate(submission.updatedAt)} />
        </div>
      )}
    </Modal>
  );
}

function DetailRow({ label, value, mono, className }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className={`text-right ${mono ? 'font-mono text-xs' : ''} ${className || 'text-white'}`}>
        {value ?? '—'}
      </span>
    </div>
  );
}
