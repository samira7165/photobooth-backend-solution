import axios from 'axios';
import Cookies from 'js-cookie';

// Was a hardcoded 'http://localhost:3000' — worked fine from a browser on
// this same machine, but "localhost" on a phone means the phone itself, not
// this PC, so every request (including the public /dl/[code] guest page a
// QR code opens) silently failed for anyone not on the machine running the
// dev server. Deriving it from the page's own hostname means it's whatever
// host the page was actually opened from — localhost on this machine,
// the LAN IP from a phone on the same network, or the real domain in
// production — with no per-environment config needed.
// window is undefined during Next's server-side render pass; that's fine
// here since nothing calls api.* until a client-side effect runs post-
// hydration, in the browser, where window is always available.
const isBrowser = typeof window !== 'undefined';
export const API_ORIGIN = isBrowser ? `${window.location.protocol}//${window.location.hostname}:3000` : 'http://localhost:3000';
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = Cookies.get('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh token on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // _retry guards against looping forever if the refreshed token is also
    // rejected (e.g. the account was deactivated) — without it, a 401 on the
    // retried request would trigger another refresh attempt indefinitely.
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      const refreshToken = Cookies.get('refreshToken');
      if (refreshToken) {
        try {
          const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
          Cookies.set('accessToken', res.data.accessToken);
          Cookies.set('refreshToken', res.data.refreshToken);
          error.config.headers.Authorization = `Bearer ${res.data.accessToken}`;
          return api.request(error.config);
        } catch {
          Cookies.remove('accessToken');
          Cookies.remove('refreshToken');
          window.location.href = '/login';
        }
      } else {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
