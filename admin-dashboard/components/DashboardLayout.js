'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import api from '@/lib/api';
import Sidebar from './Sidebar';

export default function DashboardLayout({ title, children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="flex min-h-screen bg-[#0a0a0a]">
      <Sidebar user={user} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-6 md:px-8 py-4 border-b border-white/10 bg-[#0a0a0a] sticky top-0 z-30">
          <h1 className="text-xl font-semibold text-white pl-12 md:pl-0">{title}</h1>

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
        </header>

        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
