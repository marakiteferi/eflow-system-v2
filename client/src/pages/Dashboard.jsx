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
  
  const [documents, setDocuments] = useState([]);
  const [viewingDocument, setViewingDocument] = useState(null);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  
  const [auditLogs, setAuditLogs] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [adminView, setAdminView] = useState('overview');
  const [adminStats, setAdminStats] = useState(null);

  const [showOtpModal, setShowOtpModal] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState('');

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const [showResubmitModal, setShowResubmitModal] = useState(false);
  const [resubmitDocId, setResubmitDocId] = useState(null);
  const [resubmitFile, setResubmitFile] = useState(null);
  const [isResubmitting, setIsResubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      if (user?.role_id === 1 || user?.role_id === 2) {
        const docResponse = await api.get('/documents');
        setDocuments(docResponse.data);
      }
      if (user?.role_id === 3) {
        const logsResponse = await api.get('/admin/audit-logs');
        setAuditLogs(logsResponse.data);
        const usersResponse = await api.get('/admin/users');
        setUsersList(usersResponse.data);
        const statsResponse = await api.get('/admin/stats');
        setAdminStats(statsResponse.data);
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

  const handleRoleChange = async (targetUserId, newRoleId) => {
    if (targetUserId === user.id) return alert("You cannot change your own role!");
    try {
      await api.put(`/admin/users/${targetUserId}/role`, { role_id: parseInt(newRoleId) });
      alert('User role updated!');
      fetchData(); 
    } catch (error) {
      console.error('Failed to update role', error);
    }
  };

  const handleRequestApproval = async (docId) => {
    try {
      await api.post('/approvals/request-otp', { documentId: docId });
      setSelectedDocId(docId);
      setShowOtpModal(true);
      setOtpError('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmitOtp = async () => {
    try {
      await api.post('/approvals/approve', { documentId: selectedDocId, otp: otpInput, comments: 'Verified by Staff' });
      setShowOtpModal(false);
      setOtpInput('');
      fetchData(); 
      alert('Approved successfully!');
    } catch (err) {
      setOtpError(err.response?.data?.message || 'Invalid OTP');
    }
  };

  const openRejectModal = (docId) => {
    setSelectedDocId(docId);
    setRejectComment('');
    setShowRejectModal(true);
  };

  const handleRejectSubmit = async () => {
    if (!rejectComment.trim()) return alert('Reason required.');
    try {
      await api.post('/approvals/reject', { documentId: selectedDocId, comments: rejectComment });
      setShowRejectModal(false);
      setRejectComment('');
      fetchData();
    } catch (error) {
      console.error(error);
    }
  };

  const openResubmitModal = (docId) => {
    setResubmitDocId(docId);
    setResubmitFile(null);
    setShowResubmitModal(true);
  };

  const handleResubmit = async () => {
    if (!resubmitFile) return alert('Please select a new file.');
    setIsResubmitting(true);
    const formData = new FormData();
    formData.append('document', resubmitFile);

    try {
      await api.put(`/documents/resubmit/${resubmitDocId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      alert('Document successfully resubmitted!');
      setShowResubmitModal(false);
      setResubmitFile(null);
      fetchData(); 
    } catch (error) {
      console.error('Error resubmitting:', error);
      alert('Failed to resubmit document.');
    } finally {
      setIsResubmitting(false);
    }
  };

  // The Live Search Filter Logic
  const filteredDocs = documents.filter(doc => {
    const titleMatch = doc.title?.toLowerCase().includes(searchQuery.toLowerCase());
    const textMatch = doc.extracted_text?.toLowerCase().includes(searchQuery.toLowerCase());
    return titleMatch || textMatch;
  });

  const renderDashboardContent = () => {
    switch (user?.role_id) {
      case 1:
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <DocumentUpload onUploadSuccess={fetchData} />
            
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              {/* STUDENT SEARCH BAR UI */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
                <h3 className="text-xl font-semibold">My Submissions</h3>
                <input 
                  type="text" 
                  placeholder="Search title or OCR text..." 
                  className="w-full sm:w-auto px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {filteredDocs.length === 0 ? (
                <p className="text-gray-500">No documents found matching your search.</p>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {filteredDocs.map((doc) => (
                    <li key={doc.id} className="py-3 flex flex-col gap-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-blue-600 cursor-pointer hover:underline" onClick={() => setViewingDocument(doc)}>
                            {doc.title}
                          </p>
                          <p className="text-sm text-gray-500">{new Date(doc.created_at).toLocaleDateString()}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className={`px-3 py-1 text-xs font-semibold rounded-full ${doc.status === 'Approved' ? 'bg-green-100 text-green-800' : doc.status === 'Rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {doc.status}
                          </span>
                          {doc.status === 'Rejected' && (
                            <button onClick={() => openResubmitModal(doc.id)} className="text-xs bg-indigo-100 text-indigo-700 px-3 py-1 rounded hover:bg-indigo-200 font-bold transition-colors">
                              Fix & Resubmit
                            </button>
                          )}
                        </div>
                      </div>
                      {doc.status === 'Rejected' && doc.latest_comment && (
                        <div className="mt-1 p-2 bg-red-50 border-l-2 border-red-500 rounded text-xs text-red-700">
                          <strong>Feedback:</strong> {doc.latest_comment}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );

      case 2:
        return (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            {/* STAFF SEARCH BAR UI */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
              <h3 className="text-xl font-semibold">Review Queue</h3>
              <input 
                type="text" 
                placeholder="Search title or OCR text..." 
                className="w-full sm:w-auto px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {filteredDocs.length === 0 ? (
              <p className="text-gray-500">No pending documents match your search.</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {filteredDocs.map((doc) => (
                  <li key={doc.id} className="py-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{doc.title}</p>
                      <p className="text-sm text-gray-500">Submitted on: {new Date(doc.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setViewingDocument(doc)} className="bg-blue-50 text-blue-600 px-3 py-1 rounded hover:bg-blue-100 font-medium text-sm">View Details</button>
                      <button onClick={() => openRejectModal(doc.id)} className="bg-red-50 text-red-600 px-3 py-1 rounded hover:bg-red-100 font-medium text-sm">Reject</button>
                      <button onClick={() => handleRequestApproval(doc.id)} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 font-medium text-sm">Approve</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div>
                <h3 className="text-xl font-semibold">System Administration</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setAdminView('overview')} className={`px-4 py-2 rounded text-sm font-medium transition-colors ${adminView === 'overview' ? 'bg-indigo-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>Overview</button>
                <button onClick={() => setAdminView('workflows')} className={`px-4 py-2 rounded text-sm font-medium transition-colors ${adminView === 'workflows' ? 'bg-indigo-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>Workflows</button>
                <button onClick={() => setAdminView('users')} className={`px-4 py-2 rounded text-sm font-medium transition-colors ${adminView === 'users' ? 'bg-indigo-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>Users</button>
                <button onClick={() => setAdminView('logs')} className={`px-4 py-2 rounded text-sm font-medium transition-colors ${adminView === 'logs' ? 'bg-indigo-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>Audit Logs</button>
              </div>
            </div>
            
            {adminView === 'overview' && adminStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 border-l-4 border-l-blue-500">
                  <h4 className="text-gray-500 text-sm font-medium uppercase tracking-wider mb-2">Total Documents</h4>
                  <p className="text-3xl font-bold text-gray-800">{adminStats.documents.total}</p>
                </div>
                <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 border-l-4 border-l-yellow-400">
                  <h4 className="text-gray-500 text-sm font-medium uppercase tracking-wider mb-2">Pending Review</h4>
                  <p className="text-3xl font-bold text-gray-800">{adminStats.documents.pending}</p>
                </div>
                <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 border-l-4 border-l-green-500">
                  <h4 className="text-gray-500 text-sm font-medium uppercase tracking-wider mb-2">Fully Approved</h4>
                  <p className="text-3xl font-bold text-gray-800">{adminStats.documents.approved}</p>
                </div>
                <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 border-l-4 border-l-red-500">
                  <h4 className="text-gray-500 text-sm font-medium uppercase tracking-wider mb-2">Rejected</h4>
                  <p className="text-3xl font-bold text-gray-800">{adminStats.documents.rejected}</p>
                </div>
              </div>
            )}

            {adminView === 'workflows' && <WorkflowBuilder />}
            
            {adminView === 'logs' && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                {/* NEW: Export Header */}
                <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                  <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wider">System Audit Trail</h4>
                  <button 
                    onClick={() => {
                      if (auditLogs.length === 0) return alert('No logs to export.');
                      // 1. Create CSV Headers
                      let csvContent = "data:text/csv;charset=utf-8,";
                      csvContent += "Timestamp,Action,Document,User\n";
                      // 2. Add Data Rows
                      auditLogs.forEach(log => {
                        const date = new Date(log.timestamp).toLocaleString().replace(/,/g, ''); // Remove commas to prevent CSV breaking
                        const action = `"${log.action}"`; // Wrap in quotes in case of commas
                        const doc = `"${log.document_title || 'System Action'}"`;
                        const user = `"${log.user_name || 'System'}"`;
                        csvContent += `${date},${action},${doc},${user}\n`;
                      });
                      // 3. Trigger Download
                      const encodedUri = encodeURI(csvContent);
                      const link = document.createElement("a");
                      link.setAttribute("href", encodedUri);
                      link.setAttribute("download", `Eflow_Audit_Logs_${new Date().toISOString().split('T')[0]}.csv`);
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700 shadow-sm transition-colors flex items-center gap-2"
                  >
                    📥 Export to CSV
                  </button>
                </div>

                {/* Existing Table */}
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Document</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200 text-sm">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                          <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{log.action}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-600">{log.document_title || 'System Action'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-600">{log.user_name || 'System'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {adminView === 'users' && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200 text-sm">
                    {usersList.map((listUser) => (
                      <tr key={listUser.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{listUser.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">{listUser.email}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <select 
                            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 rounded-md"
                            defaultValue={listUser.role_name === 'Admin' ? 3 : listUser.role_name === 'Staff' ? 2 : 1}
                            onChange={(e) => handleRoleChange(listUser.id, e.target.value)}
                            disabled={listUser.id === user.id}
                          >
                            <option value={1}>Student</option>
                            <option value={2}>Staff</option>
                            <option value={3}>Admin</option>
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
          {/* NEW PROFILE BUTTON HERE */}
          <button onClick={() => navigate('/profile')} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium border-r border-gray-300 pr-4">My Profile</button>
          <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-800 font-medium">Logout</button>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {renderDashboardContent()}

        {/* Modals... */}
        {showOtpModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-sm">
              <h3 className="text-lg font-bold mb-2">2FA Authentication</h3>
              <input type="text" placeholder="Enter OTP" className="w-full px-3 py-2 border rounded-md mb-4" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowOtpModal(false)} className="px-4 py-2 text-gray-600">Cancel</button>
                <button onClick={handleSubmitOtp} className="px-4 py-2 bg-green-600 text-white rounded">Verify</button>
              </div>
            </div>
          </div>
        )}

        {showRejectModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-md">
              <h3 className="text-lg font-bold text-red-600 mb-2">Reject Document</h3>
              <textarea className="w-full px-3 py-2 border rounded-md mb-4" rows="3" placeholder="Reason..." value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowRejectModal(false)} className="px-4 py-2 text-gray-600">Cancel</button>
                <button onClick={handleRejectSubmit} className="px-4 py-2 bg-red-600 text-white rounded">Submit</button>
              </div>
            </div>
          </div>
        )}

        {showResubmitModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-md">
              <h3 className="text-lg font-bold text-indigo-600 mb-2">Fix & Resubmit</h3>
              <input type="file" accept="image/*,.pdf" onChange={(e) => setResubmitFile(e.target.files[0])} className="w-full px-3 py-2 border rounded-md mb-4" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowResubmitModal(false)} className="px-4 py-2 text-gray-600">Cancel</button>
                <button onClick={handleResubmit} disabled={isResubmitting} className={`px-4 py-2 text-white rounded ${isResubmitting ? 'bg-indigo-400' : 'bg-indigo-600'}`}>
                  {isResubmitting ? 'Processing...' : 'Upload & Resubmit'}
                </button>
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