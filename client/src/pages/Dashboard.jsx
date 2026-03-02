import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import WorkflowBuilder from '../components/WorkflowBuilder';
import DocumentUpload from '../components/DocumentUpload';
import api from '../api';

const Dashboard = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);

  const fetchDocuments = async () => {
    try {
      const response = await api.get('/documents');
      setDocuments(response.data);
    } catch (error) {
      console.error("Failed to fetch documents", error);
    }
  };

  // Fetch documents when the dashboard loads
  useEffect(() => {
    if (user) fetchDocuments();
  }, [user]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const renderDashboardContent = () => {
    switch (user?.role_id) {
      case 1: // Student
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <DocumentUpload onUploadSuccess={fetchDocuments} />
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h3 className="text-xl font-semibold mb-4">My Submissions</h3>
              {documents.length === 0 ? (
                <p className="text-gray-500">You haven't submitted any documents yet.</p>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {documents.map((doc) => (
                    <li key={doc.id} className="py-3 flex justify-between items-center">
                      <div>
                        <p className="font-medium text-gray-900">{doc.title}</p>
                        <p className="text-sm text-gray-500">{new Date(doc.created_at).toLocaleDateString()}</p>
                      </div>
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                        {doc.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      case 2: // Staff
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
                      <button className="bg-blue-50 text-blue-600 px-3 py-1 rounded hover:bg-blue-100 font-medium text-sm">View Details</button>
                      <button className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 font-medium text-sm">Review & Approve</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      case 3: // Admin
        return (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h3 className="text-xl font-semibold mb-4">System Administration</h3>
              <p className="text-gray-600 mb-4">Use the canvas below to design and save document routing paths.</p>
            </div>
            <WorkflowBuilder />
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
      </main>
    </div>
  );
};

export default Dashboard;