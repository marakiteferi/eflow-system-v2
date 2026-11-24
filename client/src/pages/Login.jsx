import { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { SERVER_URL } from '../api';
import { AuthContext } from '../context/AuthContext';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  
  // Extract the login function from our global state
  const { login } = useContext(AuthContext);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await axios.post(`${SERVER_URL}/api/auth/login`, {
        email,
        password,
      });

      // Pass the user data and token to the global context instead of just localStorage
      login(response.data.user, response.data.token);

      // Now redirect to the dashboard
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to login. Please try again.');
      setLoading(false);
    }
  };

  const features = [
    ['Visual workflow builder', 'Drag and drop approval steps, conditions, parallel reviews and deadlines.'],
    ['Signed approvals', 'Every approval is OTP-confirmed and chained with an HMAC signature.'],
    ['Public verification', 'Anyone with the QR link can confirm a document is authentic.'],
  ];

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 text-white p-12 flex-col justify-between">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10" aria-hidden="true" />
        <div className="absolute -bottom-32 -left-16 w-[28rem] h-[28rem] rounded-full bg-white/5" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <span className="text-xl font-bold tracking-tight">E-Flow</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Document approvals, without the paper trail.</h1>
          <p className="mt-4 text-blue-100 text-lg">Submit, route, sign and verify institutional documents in one place.</p>
          <ul className="mt-10 space-y-5">
            {features.map(([title, text]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-1 flex-shrink-0 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </span>
                <span><span className="font-semibold">{title}.</span> <span className="text-blue-100">{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-blue-200">© {new Date().getFullYear()} E-Flow</p>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <span className="text-lg font-bold text-gray-900">E-Flow</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
          <p className="mt-1 text-sm text-gray-500">Sign in to continue to your dashboard.</p>

          <form className="mt-8 space-y-5" onSubmit={handleLogin}>
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="email-address" className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="block w-full px-3 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="you@university.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                <Link to="/forgot-password" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="block w-full px-3 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
