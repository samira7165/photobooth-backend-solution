'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

// Public, unauthenticated landing page — the fallback for a guest whose QR
// scan didn't work (see DeliveryService.generateDelivery's shortCode
// instructions text, which points here). Just normalizes and forwards to
// the existing /dl/[code] page; the actual prefix-stripping + lookup logic
// lives entirely server-side (DeliveryService.getDownloadInfo), so a code
// typed with or without its campaign's prefix ("DREAM-4K7X" or "4K7X") both
// work identically once redirected — no client-side parsing needed here.
export default function DownloadEntryPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter your download code first.');
      return;
    }
    router.push(`/dl/${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">📸</div>
          <h1 className="text-xl font-semibold text-white">Get Your Photo</h1>
          <p className="text-sm text-gray-400 mt-1">Enter the code shown on the booth screen.</p>
        </div>

        <div className="bg-[#111111] border border-white/10 rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                autoFocus
                autoCapitalize="characters"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError('');
                }}
                placeholder="e.g. DREAM-4K7X"
                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white text-center text-lg tracking-wider font-mono uppercase placeholder:normal-case placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              />
              {error && <p className="text-red-400 text-xs mt-2 text-center">{error}</p>}
            </div>

            <button
              type="submit"
              className="flex items-center justify-center gap-2 w-full bg-[#2563eb] hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-3 transition-colors"
            >
              <Search size={16} /> Find My Photo
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
