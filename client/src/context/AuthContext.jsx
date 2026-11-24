import { createContext, useState, useEffect } from 'react';
import { refreshFileToken } from '../api';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user exists in local storage on initial load
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    
    if (storedUser && token) {
      setUser(JSON.parse(storedUser));
      refreshFileToken(); // file links need a current token
    }
    setLoading(false);
  }, []);

  const login = (userData, token, fileToken) => {
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', token);
    if (fileToken) localStorage.setItem('fileToken', fileToken);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('fileToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};