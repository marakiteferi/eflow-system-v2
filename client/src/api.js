import axios from 'axios';

// Backend location. Override with REACT_APP_API_URL in client/.env (see client/.env.example).
export const SERVER_URL = (process.env.REACT_APP_API_URL || 'http://localhost:5000').replace(/\/$/, '');

const api = axios.create({
  baseURL: `${SERVER_URL}/api`,
});

// Automatically add the JWT token to every request header
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;

/**
 * URL for an uploaded file (stored as "uploads/<name>"). Files are not public: the
 * short-lived file token from sign-in is added so <iframe> and links can open them.
 */
export const fileUrl = (storedPath) => {
  if (!storedPath) return '';
  const clean = String(storedPath).replace(/\\/g, '/').replace(/^\/+/, '');
  const ft = localStorage.getItem('fileToken') || '';
  return `${SERVER_URL}/${clean}?ft=${encodeURIComponent(ft)}`;
};

/** Get a new file token (after sign-in, or when an older session has none). */
export const refreshFileToken = async () => {
  try {
    const res = await api.get('/auth/file-token');
    localStorage.setItem('fileToken', res.data.fileToken);
  } catch {
    // Not signed in: nothing to refresh
  }
};
