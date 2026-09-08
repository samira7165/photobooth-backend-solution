'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Modal from './Modal';
import StatusBadge from './StatusBadge';
import { formatDate, resolveImageUrl, resultExtension, downloadFile, printImageUrl } from '@/lib/utils';

export default function SubmissionDetailModal({ submission, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  // Overrides submission.printStatus/printedAt once this modal itself
  // successfully records a print — the `submission` prop is a snapshot
  // handed down from the table row at the moment it was clicked and
  // wouldn't otherwise reflect that until the table's own next reload.
  const [printOverride, setPrintOverride] = useState(null);

  useEffect(() => {
    setPrintOverride(null);
  }, [submission?.id]);

  const resultUrl = submission?.resultUrl ? resolveImageUrl(submission.resultUrl) : null;
  const printStatus = printOverride?.printStatus ?? submission?.printStatus;
  const printedAt = printOverride?.printedAt ?? submission?.printedAt;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadFile(resultUrl, `${submission.id}-result${resultExtension(submission?.resultUrl)}`);
    } catch (err) {
      alert(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  // Same claim-before-print ordering as app/submissions/page.js's
  // handlePrint — the backend recording the print is what actually
  // prevents a duplicate physical print, not the browser dialog itself.
  const handlePrint = async () => {
    setPrinting(true);
    try {
      const res = await api.patch(`/submissions/${submission.id}/print`);
      if (res.data.alreadyPrinted) {
        alert(res.data.message || 'This image has already been printed.');
      } else {
        printImageUrl(resultUrl);
      }
      if (res.data.printedAt) setPrintOverride({ printStatus: 'PRINTED', printedAt: res.data.printedAt });
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to record print');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Modal open={!!submission} onClose={onClose} title="Submission Details">
      {submission && (
        <div className="space-y-2 text-sm">
          {submission.status === 'COMPLETED' && resultUrl && (
            <div className="pb-3 mb-1 border-b border-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resultUrl}
                alt="Result"
                className="w-full max-w-xs mx-auto rounded-lg border border-white/10"
              />
              <div className="flex justify-center gap-2 mt-3">
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="text-xs bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
                >
                  {downloading ? 'Downloading…' : 'Download'}
                </button>
                {printStatus === 'PRINTED' ? (
                  <span
                    title={printedAt ? `Printed ${formatDate(printedAt)}` : undefined}
                    className="text-xs text-gray-500 border border-white/10 rounded-lg px-3 py-1.5 inline-flex items-center cursor-default"
                  >
                    Already Printed
                  </span>
                ) : (
                  <button
                    onClick={handlePrint}
                    disabled={printing}
                    className="text-xs border border-white/10 hover:bg-white/5 disabled:opacity-50 text-gray-300 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    {printing ? 'Printing…' : 'Print'}
                  </button>
                )}
              </div>
            </div>
          )}
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
          <DetailRow label="Download Code" value={submission.displayCode || submission.downloadCode} mono />
          <DetailRow label="Download Count" value={submission.downloadCount} />
          <DetailRow
            label="Code Expires"
            value={submission.downloadCodeExpiresAt ? formatDate(submission.downloadCodeExpiresAt) : 'Never'}
          />
          <DetailRow label="Processing Time" value={submission.processingTime ? `${submission.processingTime}ms` : null} />
          <DetailRow label="Retry Count" value={submission.retryCount} />
          {submission.errorMessage && (
            <DetailRow label="Error" value={submission.errorMessage} className="text-red-400" />
          )}
          <DetailRow label="Print Status" value={printStatus} />
          <DetailRow label="Printed At" value={printedAt ? formatDate(printedAt) : null} />
          {submission.printAttempts > 0 && <DetailRow label="Print Attempts" value={submission.printAttempts} />}
          {submission.printerId && <DetailRow label="Printer" value={submission.printerId} mono />}
          {printStatus === 'FAILED' && submission.printError && (
            <DetailRow label="Print Error" value={submission.printError} className="text-red-400" />
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
