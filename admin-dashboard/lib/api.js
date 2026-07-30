import axios from 'axios';
import Cookies from 'js-cookie';

export const API_ORIGIN = 'http://localhost:3000';
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
