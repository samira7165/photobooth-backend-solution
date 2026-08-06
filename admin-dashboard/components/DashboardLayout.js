'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import Sidebar from './Sidebar';

export default function DashboardLayout({ title, children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [queueStats, setQueueStats] = useState(null);

  useEffect(() => {
    if (!Cookies.get('accessToken')) {
      router.replace('/login');
      return;
    }

    api
      .get('/auth/profile')
      .then((res) => setUser(res.data))
      .catch(() => router.replace('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const socket = getSocket();
    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onQueueStats = (stats) => setQueueStats(stats);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('admin:queue_stats', onQueueStats);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('admin:queue_stats', onQueueStats);
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-[#0a0a0a]">
      <Sidebar user={user} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-6 md:px-8 py-4 border-b border-white/10 bg-[#0a0a0a] sticky top-0 z-30">
          <h1 className="text-xl font-semibold text-white pl-12 md:pl-0">{title}</h1>

          <div className="flex items-center gap-4">
            {queueStats && (
              <div className="hidden md:block text-xs text-gray-400">
                Live Queue: <span className="text-white">{queueStats.waiting}</span> waiting,{' '}
                <span className="text-white">{queueStats.active}</span> active
              </div>
            )}

            <div className="flex items-center gap-1.5 text-xs" title={connected ? 'WebSocket connected' : 'WebSocket disconnected'}>
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
              <span className={connected ? 'text-green-400' : 'text-gray-500'}>{connected ? 'Live' : 'Offline'}</span>
            </div>

            {!loading && user && (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-medium text-white">{user.name}</div>
                  <div className="text-xs text-gray-400">{user.role}</div>
                </div>
                <div className="w-9 h-9 rounded-full bg-[#2563eb] flex items-center justify-center text-white text-sm font-semibold">
                  {user.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
