import { createContext, useState, useEffect, useCallback } from 'react';
import api, { refreshFileToken } from '../api';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const store = (userData) => {
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  /** Re-read the account type, permissions and offices (they can change while signed in). */
  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      store(res.data);
      return res.data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    // Check if user exists in local storage on initial load
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');

    if (storedUser && token) {
      setUser(JSON.parse(storedUser));
      refreshFileToken(); // file links need a current token
      refreshUser();
    }
    setLoading(false);
  }, [refreshUser]);

  const login = (userData, token, fileToken) => {
    localStorage.setItem('token', token);
    if (fileToken) localStorage.setItem('fileToken', fileToken);
    store(userData);
  };

  const logout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('fileToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
