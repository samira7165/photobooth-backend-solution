'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import Cookies from 'js-cookie';
import {
  LayoutDashboard,
  Megaphone,
  Image as ImageIcon,
  Bot,
  Camera,
  Users,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { hasRole } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/assets', label: 'Assets', icon: ImageIcon },
  { href: '/providers', label: 'AI Providers', icon: Bot },
  { href: '/submissions', label: 'Submissions', icon: Camera },
  { href: '/users', label: 'Users', icon: Users, minRole: 'ADMIN' },
];

export default function Sidebar({ user }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleLogout = () => {
    Cookies.remove('accessToken');
    Cookies.remove('refreshToken');
    router.push('/login');
  };

  const isActive = (href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const items = NAV_ITEMS.filter((item) => !item.minRole || !user || hasRole(user.role, item.minRole));

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(!open)}
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-[#111111] border border-white/10 text-white"
        aria-label="Toggle menu"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Overlay on mobile */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-[250px] bg-[#111111] border-r border-white/10 flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex items-center gap-2.5 px-6 py-5 border-b border-white/10">
          <Camera size={22} className="text-[#2563eb]" strokeWidth={2} />
          <span className="text-white font-semibold text-lg">XRI Photobooth</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {items.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#2563eb] text-white'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon size={18} strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut size={18} strokeWidth={1.75} />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
