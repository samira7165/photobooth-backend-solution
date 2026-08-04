'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import { resolveImageUrl, formatDate } from '@/lib/utils';
import { RotateCcw, Camera as CameraIcon, Upload } from 'lucide-react';

const POLL_MS = 3000;

export default function BoothTestPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [campaignSlug, setCampaignSlug] = useState('');
  const [boothConfig, setBoothConfig] = useState(null);
  const [boothConfigError, setBoothConfigError] = useState('');

  const [sessionId, setSessionId] = useState(null);
  const [sessionError, setSessionError] = useState('');

  const [photoBlob, setPhotoBlob] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [cameraActive, setCameraActive] = useState(false);

  const [formFields, setFormFields] = useState({ userName: '', userPhone: '', userEmail: '' });
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState(null); // latest status poll result
  const [history, setHistory] = useState([]);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  // ─── load campaigns ───

  useEffect(() => {
    api
      .get('/campaigns')
      .then((res) => setCampaigns(res.data))
      .catch(() => {})
      .finally(() => setLoadingCampaigns(false));
  }, []);

  // ─── fetch public booth config once a campaign is picked ───

  useEffect(() => {
    if (!campaignSlug) {
      setBoothConfig(null);
      return;
    }
    setBoothConfigError('');
    setBoothConfig(null);
    api
      .get(`/campaigns/booth/${campaignSlug}`)
      .then((res) => setBoothConfig(res.data))
      .catch((err) =>
        setBoothConfigError(
          err.response?.data?.message ||
            'Failed to load booth config — the campaign may not be ACTIVE.',
        ),
      );
  }, [campaignSlug]);

  // ─── camera ───

  const startCamera = useCallback(async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1920 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access, or upload a file instead below.'
          : 'Could not access a camera. Upload a file instead below.',
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setPhotoBlob(blob);
        setPhotoPreviewUrl(URL.createObjectURL(blob));
        stopCamera();
      },
      'image/jpeg',
      0.92,
    );
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBlob(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    stopCamera();
  };

  const retakePhoto = () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoBlob(null);
    setPhotoPreviewUrl(null);
  };

  // ─── booth session ───

  const createSession = async () => {
    setSessionError('');
    try {
      const res = await api.post(`/submissions/booth/${campaignSlug}/session`, {});
      setSessionId(res.data.sessionId);
    } catch (err) {
      setSessionError(err.response?.data?.message || 'Failed to create booth session');
    }
  };

  // ─── submit ───

  const collectFields = boothConfig?.collectFields || [];

  const handleSubmit = async () => {
    setSubmitError('');
    if (!photoBlob) {
      setSubmitError('Capture or upload a photo first');
      return;
    }
    for (const field of collectFields) {
      const key = `user${field.charAt(0).toUpperCase()}${field.slice(1)}`;
      if (!formFields[key]?.trim()) {
        setSubmitError(`This campaign requires "${field}"`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      if (formFields.userName) fd.append('userName', formFields.userName);
      if (formFields.userPhone) fd.append('userPhone', formFields.userPhone);
      if (formFields.userEmail) fd.append('userEmail', formFields.userEmail);
      if (sessionId) fd.append('sessionId', sessionId);
      fd.append('photo', photoBlob, 'test-photo.jpg');

      const res = await api.post(`/submissions/booth/${campaignSlug}/submit`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const newSubmission = { submissionId: res.data.submissionId, status: res.data.status };
      setSubmission(newSubmission);
      setHistory((h) => [{ ...newSubmission, createdAt: new Date().toISOString() }, ...h]);
    } catch (err) {
      setSubmitError(err.response?.data?.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── status polling ───

  useEffect(() => {
    if (!submission?.submissionId) return;

    const poll = async () => {
      try {
        const res = await api.get(`/submissions/booth/status/${submission.submissionId}`);
        setSubmission(res.data);
        if (res.data.status === 'COMPLETED' || res.data.status === 'FAILED') {
          clearInterval(pollRef.current);
        }
      } catch {
        clearInterval(pollRef.current);
      }
    };

    pollRef.current = setInterval(poll, POLL_MS);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission?.submissionId]);

  const resetTest = () => {
    clearInterval(pollRef.current);
    retakePhoto();
    setFormFields({ userName: '', userPhone: '', userEmail: '' });
    setSubmission(null);
    setSubmitError('');
    setSessionId(null);
  };

  return (
    <DashboardLayout title="Booth Test">
      <div className="max-w-3xl space-y-6">
        <div className="bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm rounded-lg px-4 py-3">
          Drives the real public booth API (session → submit → status poll) exactly like a kiosk
          tablet would — including the queue and processing pipeline, so a submitted photo will
          actually move through <span className="font-mono">QUEUED → PROCESSING → COMPLETED</span> and
          come back with a real result image and QR code.
        </div>

        {/* Step 1: campaign */}
        <Section step={1} title="Choose a campaign">
          {loadingCampaigns ? (
            <div className="text-gray-500 text-sm">Loading…</div>
          ) : (
            <select
              value={campaignSlug}
              onChange={(e) => {
                setCampaignSlug(e.target.value);
                setSessionId(null);
                resetTest();
              }}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            >
              <option value="">Select a campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name} — {c.status} · {c.processingMode}
                </option>
              ))}
            </select>
          )}
          {boothConfigError && <p className="text-red-400 text-xs mt-2">{boothConfigError}</p>}
          {boothConfig && (
            <div className="text-xs text-gray-400 mt-2">
              Mode: <span className="text-gray-200">{campaigns.find((c) => c.slug === campaignSlug)?.processingMode}</span>
              {' · '}
              Collects: <span className="text-gray-200">{collectFields.join(', ') || 'nothing'}</span>
            </div>
          )}
        </Section>

        {boothConfig && (
          <>
            {/* Step 2: photo */}
            <Section step={2} title="Take or upload a photo">
              {!photoPreviewUrl ? (
                <div className="space-y-3">
                  {cameraActive ? (
                    <div className="space-y-3">
                      <video
                        ref={videoRef}
                        muted
                        playsInline
                        className="w-full max-w-sm rounded-lg bg-black mx-auto"
                      />
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={capturePhoto}
                          className="flex items-center gap-2 bg-[#2563eb] hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                        >
                          <CameraIcon size={16} /> Capture
                        </button>
                        <button
                          onClick={stopCamera}
                          className="border border-white/10 hover:bg-white/5 text-gray-300 text-sm rounded-lg px-4 py-2 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={startCamera}
                        className="flex items-center gap-2 bg-[#2563eb] hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
                      >
                        <CameraIcon size={16} /> Use Camera
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 border border-white/10 hover:bg-white/5 text-gray-300 text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
                      >
                        <Upload size={16} /> Upload File
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </div>
                  )}
                  {cameraError && <p className="text-red-400 text-xs">{cameraError}</p>}
                  <canvas ref={canvasRef} className="hidden" />
                </div>
              ) : (
                <div className="space-y-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoPreviewUrl} alt="Captured" className="w-full max-w-sm rounded-lg mx-auto" />
                  <div className="flex justify-center">
                    <button
                      onClick={retakePhoto}
                      className="flex items-center gap-2 border border-white/10 hover:bg-white/5 text-gray-300 text-sm rounded-lg px-4 py-2 transition-colors"
                    >
                      <RotateCcw size={16} /> Retake
                    </button>
                  </div>
                </div>
              )}
            </Section>

            {/* Step 3: fields */}
            {collectFields.length > 0 && (
              <Section step={3} title="Fill required info">
                <div className="space-y-3">
                  {collectFields.includes('name') && (
                    <Field label="Name" value={formFields.userName} onChange={(v) => setFormFields((f) => ({ ...f, userName: v }))} />
                  )}
                  {collectFields.includes('phone') && (
                    <Field label="Phone" value={formFields.userPhone} onChange={(v) => setFormFields((f) => ({ ...f, userPhone: v }))} />
                  )}
                  {collectFields.includes('email') && (
                    <Field label="Email" value={formFields.userEmail} onChange={(v) => setFormFields((f) => ({ ...f, userEmail: v }))} />
                  )}
                </div>
              </Section>
            )}

            {/* Step 4: submit */}
            <Section step={collectFields.length > 0 ? 4 : 3} title="Submit">
              {!sessionId && (
                <div className="mb-3">
                  <button
                    onClick={createSession}
                    className="text-xs border border-white/10 hover:bg-white/5 text-gray-300 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Create booth session (optional — correlates the submission)
                  </button>
                  {sessionError && <p className="text-red-400 text-xs mt-1">{sessionError}</p>}
                </div>
              )}
              {sessionId && (
                <p className="text-xs text-gray-500 mb-3 font-mono">session: {sessionId}</p>
              )}

              {submitError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-3">
                  {submitError}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting || !photoBlob}
                className="bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-5 py-2.5 transition-colors"
              >
                {submitting ? 'Submitting…' : 'Submit Photo'}
              </button>
            </Section>

            {/* Result / polling */}
            {submission && (
              <Section step="✓" title="Result">
                <div className="flex items-center gap-3 mb-3">
                  <StatusBadge status={submission.status} />
                  <span className="text-xs text-gray-500 font-mono">{submission.submissionId}</span>
                  {(submission.status === 'UPLOADED' || submission.status === 'QUEUED' || submission.status === 'PROCESSING') && (
                    <span className="text-xs text-gray-500">polling every {POLL_MS / 1000}s…</span>
                  )}
                </div>

                {(submission.status === 'UPLOADED' || submission.status === 'QUEUED' || submission.status === 'PROCESSING') && (
                  <p className="text-gray-500 text-sm">
                    {submission.queuePosition != null
                      ? `Queue position ${submission.queuePosition}, ~${submission.estimatedWaitSeconds}s estimated`
                      : 'Waiting for the queue to pick this up…'}
                  </p>
                )}

                {submission.status === 'FAILED' && (
                  <p className="text-red-400 text-sm">{submission.error || 'Processing failed'}</p>
                )}

                {submission.status === 'COMPLETED' && (
                  <div className="space-y-4">
                    {submission.processingTime != null && (
                      <p className="text-xs text-gray-500">Processed in {submission.processingTime}ms</p>
                    )}
                    <div className="flex flex-wrap gap-4">
                      {submission.resultUrl && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Result</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={resolveImageUrl(submission.resultUrl)}
                            alt="Result"
                            className="max-w-xs rounded-lg border border-white/10"
                          />
                        </div>
                      )}
                      {submission.qrCodeUrl && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">QR Code</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={resolveImageUrl(submission.qrCodeUrl)}
                            alt="QR code"
                            className="w-32 h-32 rounded-lg border border-white/10 bg-white"
                          />
                        </div>
                      )}
                    </div>
                    {submission.downloadUrl && (
                      <p className="text-xs text-gray-400">
                        Download link:{' '}
                        <a
                          href={submission.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#2563eb] hover:underline font-mono"
                        >
                          {submission.downloadUrl}
                        </a>
                        {submission.downloadCode && ` (code: ${submission.downloadCode})`}
                      </p>
                    )}
                  </div>
                )}

                <button
                  onClick={resetTest}
                  className="mt-4 text-sm border border-white/10 hover:bg-white/5 text-gray-300 rounded-lg px-4 py-2 transition-colors"
                >
                  Test Again
                </button>
              </Section>
            )}
          </>
        )}

        {history.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">
              This Session&apos;s Test Submissions
            </h2>
            <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-white/10">
                    <th className="px-4 py-2 font-medium">Submission ID</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2 font-mono text-gray-400 text-xs">{h.submissionId}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={h.status} />
                      </td>
                      <td className="px-4 py-2 text-gray-400">{formatDate(h.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function Section({ step, title, children }) {
  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="w-6 h-6 rounded-full bg-[#2563eb] text-white text-xs font-semibold flex items-center justify-center shrink-0">
          {step}
        </span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
      />
    </div>
  );
}
