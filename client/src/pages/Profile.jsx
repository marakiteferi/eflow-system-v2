import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const Profile = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  
  // ==========================================
  // STATE: Account Settings (Your existing logic)
  // ==========================================
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoading, setIsLoading] = useState(false);

  // ==========================================
  // STATE: Out of Office / Delegation
  // ==========================================
  const [isOOO, setIsOOO] = useState(false);
  const [delegateId, setDelegateId] = useState('');
  const [availableDelegates, setAvailableDelegates] = useState([]);
  const [isSavingOOO, setIsSavingOOO] = useState(false);
  const [oooMessage, setOooMessage] = useState({ type: '', text: '' });

  // Only Staff/Admins need delegation (ID > 1)
  const isStaffMember = user && user.role_id !== 1;

  // Fetch OOO data on load
  useEffect(() => {
    const fetchDelegationData = async () => {
      try {
        const oooRes = await api.get('/users/ooo');
        if (oooRes.data) {
          setIsOOO(oooRes.data.is_out_of_office);
          setDelegateId(oooRes.data.delegate_id || '');
        }
        const delegatesRes = await api.get('/users/delegates');
        setAvailableDelegates(delegatesRes.data);
      } catch (err) {
        console.error('Failed to load OOO data', err);
      }
    };

    if (isStaffMember) {
      fetchDelegationData();
    }
  }, [isStaffMember]);

  // ==========================================
  // HANDLERS
  // ==========================================
  const handleUpdate = async (e) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (newPassword && newPassword !== confirmPassword) {
      return setMessage({ type: 'error', text: 'New passwords do not match.' });
    }

    setIsLoading(true);
    try {
      const payload = { name };
      if (currentPassword && newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }

      const res = await api.put('/auth/profile', payload);
      setMessage({ type: 'success', text: res.data.message });
      
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to update profile.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveOOO = async (e) => {
    e.preventDefault();
    if (isOOO && !delegateId) {
      return setOooMessage({ type: 'error', text: 'Please select a delegate if you are going Out of Office.' });
    }

    setIsSavingOOO(true);
    setOooMessage({ type: '', text: '' });
    try {
      await api.post('/users/ooo', { 
        is_out_of_office: isOOO, 
        delegate_id: delegateId || null 
      });
      setOooMessage({ type: 'success', text: 'Out of Office settings saved!' });
      setTimeout(() => setOooMessage({ type: '', text: '' }), 3000);
    } catch (err) {
      setOooMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setIsSavingOOO(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center border-b border-gray-200">
        <h1 className="text-2xl font-bold text-indigo-700 cursor-pointer" onClick={() => navigate('/dashboard')}>E-flow</h1>
        <div className="flex gap-4">
          <button onClick={() => navigate('/dashboard')} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Back to Dashboard</button>
          <button onClick={logout} className="text-sm font-medium text-red-600 hover:text-red-800">Logout</button>
        </div>
      </nav>

      <div className="flex-grow flex flex-col md:flex-row items-start justify-center p-4 pt-10 gap-8 max-w-5xl mx-auto w-full">
        
        {/* ========================================== */}
        {/* CARD 1: ACCOUNT SETTINGS (Your existing UI)  */}
        {/* ========================================== */}
        <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Account Settings</h2>
          
          {message.text && (
            <div className={`p-3 rounded mb-4 text-sm font-medium text-center ${message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input 
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" 
                required 
              />
            </div>

            <div className="pt-4 border-t border-gray-200 mt-6">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Change Password (Optional)</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                  <input 
                    type="password" 
                    value={currentPassword} 
                    onChange={(e) => setCurrentPassword(e.target.value)} 
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" 
                    placeholder="Leave blank to keep current"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <input 
                    type="password" 
                    value={newPassword} 
                    onChange={(e) => setNewPassword(e.target.value)} 
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                  <input 
                    type="password" 
                    value={confirmPassword} 
                    onChange={(e) => setConfirmPassword(e.target.value)} 
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" 
                  />
                </div>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className={`w-full py-2 px-4 rounded-md text-white font-bold mt-6 shadow-sm transition-colors ${isLoading ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* ========================================== */}
        {/* CARD 2: OUT OF OFFICE (Staff Only)           */}
        {/* ========================================== */}
        {isStaffMember && (
          <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md border-t-4 border-t-amber-400 border-l border-r border-b border-gray-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
              ✈️ Out of Office
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              Automatically forward incoming documents to a trusted colleague while you are away.
            </p>

            {oooMessage.text && (
              <div className={`p-3 rounded mb-4 text-sm font-bold text-center ${oooMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                {oooMessage.text}
              </div>
            )}

            <form onSubmit={handleSaveOOO} className="space-y-6">
              
              {/* Custom Toggle Switch */}
              <label className="flex items-center cursor-pointer bg-gray-50 p-4 rounded border border-gray-200">
                <div className="relative">
                  <input type="checkbox" className="sr-only" checked={isOOO} onChange={(e) => setIsOOO(e.target.checked)} />
                  <div className={`block w-14 h-8 rounded-full transition-colors ${isOOO ? 'bg-indigo-500' : 'bg-gray-300'}`}></div>
                  <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${isOOO ? 'transform translate-x-6' : ''}`}></div>
                </div>
                <div className="ml-4 font-bold text-gray-800">
                  {isOOO ? 'I am Out of Office' : 'I am Active'}
                </div>
              </label>

              {/* Delegate Dropdown */}
              <div className={`transition-opacity ${isOOO ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                <label className="block text-sm font-bold text-gray-700 mb-2">Forward my documents to:</label>
                <select 
                  value={delegateId} 
                  onChange={(e) => setDelegateId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-md bg-white focus:ring-indigo-500 focus:border-indigo-500"
                  required={isOOO}
                >
                  <option value="">-- Select a Backup Reviewer --</option>
                  {availableDelegates.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.email})</option>
                  ))}
                </select>
              </div>

              <button 
                type="submit" 
                disabled={isSavingOOO}
                className={`w-full py-2 px-4 rounded-md text-white font-bold shadow-sm transition-colors ${isSavingOOO ? 'bg-amber-400' : 'bg-amber-500 hover:bg-amber-600'}`}
              >
                {isSavingOOO ? 'Saving...' : 'Save Vacation Settings'}
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
};

export default Profile;