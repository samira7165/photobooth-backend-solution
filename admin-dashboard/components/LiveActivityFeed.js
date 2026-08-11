'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Activity, X } from 'lucide-react';
import { getSocket } from '@/lib/socket';

const MAX_EVENTS = 20;

function secondsAgo(iso) {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// Mounted once in app/layout.js, so it lives for the whole session and
// listens on the same shared socket DashboardLayout/analytics pages use —
// see lib/socket.js for why nothing here ever disconnects it.
export default function LiveActivityFeed() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [unseen, setUnseen] = useState(0);
  const [, setTick] = useState(0);

  // /dl/[code] is the guest-facing download page (see app/dl/[code]/page.js)
  // — reachable by anyone who scans a QR code, with no admin session at all.
  // This widget is an internal admin tool, so it shouldn't render (or open a
  // socket) on that page or /login, same as it already skipped /login.
  const isPublicPage = pathname === '/login' || pathname?.startsWith('/dl/');

  useEffect(() => {
    if (isPublicPage) return;
    const socket = getSocket();

    const pushEvent = (text, timestamp) => {
      setEvents((prev) => [{ id: `${timestamp}-${Math.random()}`, text, timestamp }, ...prev].slice(0, MAX_EVENTS));
      setUnseen((n) => n + 1);
    };

    const onNewSubmission = (data) => {
      pushEvent(`New submission — ${data.campaignSlug}`, data.timestamp);
    };

    const onJobUpdate = (data) => {
      const label = data.status ? data.status.charAt(0) + data.status.slice(1).toLowerCase() : 'Job updated';
      pushEvent(`${label} — ${(data.submissionId || '').slice(0, 8)}`, data.timestamp);
    };

    socket.on('admin:new_submission', onNewSubmission);
    socket.on('admin:job_update', onJobUpdate);

    return () => {
      socket.off('admin:new_submission', onNewSubmission);
      socket.off('admin:job_update', onJobUpdate);
    };
  }, [isPublicPage]);

  // Re-render once a second so "Ns ago" stays fresh while the panel is open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) setUnseen(0);
  };

  if (isPublicPage) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <div className="mb-3 w-80 max-h-96 bg-[#111111] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Live Activity</span>
            <button onClick={toggle} className="text-gray-500 hover:text-white">
              <X size={16} />
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
            {events.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-500 text-center">No activity yet</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {events.map((e) => (
                  <li key={e.id} className="px-4 py-2.5 text-sm">
                    <div className="text-gray-200">{e.text}</div>
                    <div className="text-xs text-gray-500">{secondsAgo(e.timestamp)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <button
        onClick={toggle}
        className="relative w-12 h-12 rounded-full bg-[#2563eb] hover:bg-blue-700 shadow-lg flex items-center justify-center text-white transition-colors"
        title="Live activity feed"
      >
        <Activity size={20} />
        {!open && unseen > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </button>
    </div>
  );
}
