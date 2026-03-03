import { useContext, useEffect, useState, useCallback } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import WorkflowBuilder from '../components/WorkflowBuilder';
import DocumentUpload from '../components/DocumentUpload';
import DocumentDetailsModal from '../components/DocumentDetailsModal';
import api from '../api';

const Dashboard = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  
  // Shared State
  const [documents, setDocuments] = useState([]);
  const [viewingDocument, setViewingDocument] = useState(null);
  
  // Admin State
  const [auditLogs, setAuditLogs] = useState([]);
  const [usersList, setUsersList] = useState([]); // NEW: State for users
  const [adminView, setAdminView] = useState('workflows');

  // Staff 2FA State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState('');

  // Fetch Data based on Role
  const fetchData = useCallback(async () => {
    try {
      if (user?.role_id === 1 || user?.role_id === 2) {
        const docResponse = await api.get('/documents');
        setDocuments(docResponse.data);
      }
      if (user?.role_id === 3) {
        const logsResponse = await api.get('/admin/audit-logs');
        setAuditLogs(logsResponse.data);
        
        // NEW: Fetch all users for the Admin panel
        const usersResponse = await api.get('/admin/users');
        setUsersList(usersResponse.data);
      }
    } catch (error) {
      console.error("Failed to fetch data", error);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // --- NEW: Admin Role Change Handler ---
  const handleRoleChange = async (targetUserId, newRoleId) => {
    // Prevent the admin from accidentally demoting themselves
    if (targetUserId === user.id) {
      alert("You cannot change your own role!");
      return;
    }

    try {
      await api.put(`/admin/users/${targetUserId}/role`, { role_id: parseInt(newRoleId) });
      alert('User role updated successfully!');
      fetchData(); // Refresh the lists to show the new role and the new audit log
    } catch (error) {
      console.error('Failed to update role', error);
      alert('Error updating role. Check console.');
    }
  };

  // --- 2FA Handlers ---
  const handleRequestApproval = async (docId) => {
    try {
      await api.post('/approvals/request-otp', { documentId: docId });
      setSelectedDocId(docId);
      setShowOtpModal(true);
      setOtpError('');
    } catch (err) {
      console.error(err);
      alert('Failed to request OTP.');
    }
  };

  const handleSubmitOtp = async () => {
    try {
      await api.post('/approvals/approve', { 
        documentId: selectedDocId, 
        otp: otpInput,
        comments: 'Verified by Staff Dashboard'
      });
      setShowOtpModal(false);
      setOtpInput('');
      fetchData(); 
      alert('Document successfully securely approved!');
    } catch (err) {
      setOtpError(err.response?.data?.message || 'Invalid OTP');
    }
  };

  const renderDashboardContent = () => {
    switch (user?.role_id) {
      case 1: // Student View
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <DocumentUpload onUploadSuccess={fetchData} />
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h3 className="text-xl font-semibold mb-4">My Submissions</h3>
              {documents.length === 0 ? (
                <p className="text-gray-500">You haven't submitted any documents yet.</p>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {documents.map((doc) => (
                    <li key={doc.id} className="py-3 flex justify-between items-center">
                      <div>
                        <p className="font-medium text-blue-600 cursor-pointer hover:underline" onClick={() => setViewingDocument(doc)}>
                          {doc.title}
                        </p>
                        <p className="text-sm text-gray-500">{new Date(doc.created_at).toLocaleDateString()}</p>
                      </div>
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${doc.status === 'Approved' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                        {doc.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );

      case 2: // Staff View
        return (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-xl font-semibold mb-4">Review Queue</h3>
            {documents.length === 0 ? (
              <p className="text-gray-500">No pending documents to review.</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {documents.map((doc) => (
                  <li key={doc.id} className="py-4 flex justify-between items-center">
                    <div>
                      <p className="font-medium text-gray-900">{doc.title}</p>
                      <p className="text-sm text-gray-500">Submitted on: {new Date(doc.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setViewingDocument(doc)} className="bg-blue-50 text-blue-600 px-3 py-1 rounded hover:bg-blue-100 font-medium text-sm">
                        View Details
                      </button>
                      <button onClick={() => handleRequestApproval(doc.id)} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 font-medium text-sm transition-colors">
                        Review & Approve
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );

      case 3: // Admin View
        return (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">System Administration</h3>
                <p className="text-gray-600 text-sm">Manage workflows, users, and audit logs.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setAdminView('workflows')} className={`px-4 py-2 rounded font-medium text-sm transition-colors ${adminView === 'workflows' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Workflow Builder
                </button>
                <button onClick={() => setAdminView('users')} className={`px-4 py-2 rounded font-medium text-sm transition-colors ${adminView === 'users' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  User Management
                </button>
                <button onClick={() => setAdminView('logs')} className={`px-4 py-2 rounded font-medium text-sm transition-colors ${adminView === 'logs' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Audit Logs
                </button>
              </div>
            </div>
            
            {/* Conditional Admin Views */}
            {adminView === 'workflows' && <WorkflowBuilder />}
            
            {adminView === 'logs' && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Document / Details</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Performed By</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200 text-sm">
                    {auditLogs.length === 0 ? (
                      <tr><td colSpan="4" className="px-6 py-4 text-center text-gray-500">No logs found.</td></tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                          <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{log.action}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-600">{log.document_title || 'System Action'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-600">{log.user_name || 'System'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {adminView === 'users' && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">System Role</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200 text-sm">
                    {usersList.map((listUser) => (
                      <tr key={listUser.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">{listUser.id}</td>
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{listUser.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">{listUser.email}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {/* Dropdown to change roles */}
                          <select 
                            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md bg-white border"
                            defaultValue={
                              listUser.role_name === 'Admin' ? 3 : 
                              listUser.role_name === 'Staff' ? 2 : 1
                            }
                            onChange={(e) => handleRoleChange(listUser.id, e.target.value)}
                            disabled={listUser.id === user.id} // Cannot change own role
                          >
                            <option value={1}>Student (Uploader)</option>
                            <option value={2}>Staff (Reviewer)</option>
                            <option value={3}>Admin (System Manager)</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      default:
        return <p>Role not recognized.</p>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">System Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">Logged in as: <span className="font-semibold text-gray-900">{user?.name}</span></span>
          <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-800 font-medium">Logout</button>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {renderDashboardContent()}

        {showOtpModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-lg max-w-sm w-full">
              <h3 className="text-lg font-bold mb-2">Two-Factor Authentication</h3>
              <p className="text-sm text-gray-600 mb-4">An OTP has been generated. Check your terminal.</p>
              {otpError && <p className="text-red-500 text-sm mb-3">{otpError}</p>}
              <input type="text" placeholder="Enter 6-digit OTP" className="w-full px-3 py-2 border border-gray-300 rounded-md mb-4 focus:outline-none focus:ring-green-500 focus:border-green-500" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} />
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowOtpModal(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
                <button onClick={handleSubmitOtp} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">Verify & Approve</button>
              </div>
            </div>
          </div>
        )}

        {viewingDocument && (
          <DocumentDetailsModal document={viewingDocument} onClose={() => setViewingDocument(null)} />
        )}
      </main>
    </div>
  );
};

export default Dashboard;