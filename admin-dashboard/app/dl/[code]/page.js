'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Download } from 'lucide-react';
import api, { API_BASE_URL } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';

// Public, unauthenticated page — this is what the QR code / download link
// on a completed submission actually points to (see DeliveryService.
// generateQRCode). No DashboardLayout here on purpose: a guest scanning a
// QR code on their phone has no admin account and should never see (or be
// redirected to) the login screen.
export default function DownloadPage() {
  const { code } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/dl/${code}`);
      setInfo(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'This download link could not be found.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (code) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">📸</div>
          <h1 className="text-xl font-semibold text-white">
            {info?.campaignName || 'Your Photo'}
          </h1>
        </div>

        <div className="bg-[#111111] border border-white/10 rounded-xl p-6">
          {loading && (
            <p className="text-sm text-gray-400 text-center py-10">Loading your photo…</p>
          )}

          {!loading && error && (
            <div className="text-center py-6">
              <p className="text-sm text-red-400 mb-4">{error}</p>
              <button
                onClick={load}
                className="text-sm border border-white/10 hover:bg-white/5 text-gray-300 rounded-lg px-4 py-2 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && info && (
            <div className="space-y-4">
              {info.userName && (
                <p className="text-sm text-gray-400 text-center">Hi {info.userName}, here&apos;s your photo!</p>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveImageUrl(info.imageUrl)}
                alt="Your photobooth result"
                className="w-full rounded-lg border border-white/10"
              />

              <a
                href={`${API_BASE_URL}/dl/${code}/image`}
                download
                className="flex items-center justify-center gap-2 w-full bg-[#2563eb] hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
              >
                <Download size={16} /> Download Photo
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
