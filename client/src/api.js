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
