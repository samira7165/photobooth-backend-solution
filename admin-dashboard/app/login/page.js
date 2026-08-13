'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { Camera, Loader2 } from 'lucide-react';
import api from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (Cookies.get('accessToken')) {
      router.replace('/');
    }
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/auth/login', { email, password });
      Cookies.set('accessToken', res.data.accessToken);
      Cookies.set('refreshToken', res.data.refreshToken);
      router.push('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,_#132048_0%,_#0a0a0a_65%)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#2563eb] to-purple-600 flex items-center justify-center shadow-lg shadow-blue-950/50">
            <Camera size={28} className="text-white" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-semibold text-white">XRI Photobooth Admin</h1>
          <div className="h-1 w-14 mx-auto mt-3 mb-3 rounded-full bg-gradient-to-r from-[#2563eb] to-purple-500" />
          <p className="text-sm text-gray-400">Sign in to manage campaigns</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#111111] border border-white/10 rounded-xl p-6 space-y-4"
        >
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white text-sm
                focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent
                focus:shadow-[0_0_0_4px_rgba(37,99,235,0.15)] transition-shadow motion-reduce:transition-none"
              placeholder="admin@xri.com.bd"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-300">Password</label>
              <button
                type="button"
                tabIndex={-1}
                className="text-xs text-[#2563eb] hover:text-blue-400 hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white text-sm
                focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent
                focus:shadow-[0_0_0_4px_rgba(37,99,235,0.15)] transition-shadow motion-reduce:transition-none"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-3 text-sm transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
