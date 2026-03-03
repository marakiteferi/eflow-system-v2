import React, { useState, useEffect } from 'react';
import api from '../api';

const DocumentDetailsModal = ({ document, onClose }) => {
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch the history timeline when the modal opens
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await api.get(`/documents/${document.id}/history`);
        setHistory(response.data);
      } catch (error) {
        console.error('Failed to fetch history:', error);
      } finally {
        setIsLoading(false);
      }
    };
    if (document) fetchHistory();
  }, [document]);

  if (!document) return null;

  // Format the file path to create a valid URL
  let cleanPath = document.file_path.replace(/\\/g, '/');
  if (cleanPath.startsWith('/')) cleanPath = cleanPath.substring(1);
  const fileUrl = `http://localhost:5000/${cleanPath}`;

  // NEW: Check if the file is a PDF
  const isPdf = cleanPath.toLowerCase().endsWith('.pdf');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="text-xl font-bold text-gray-800">{document.title}</h2>
            <p className="text-sm text-gray-500">Submitted on: {new Date(document.created_at).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 font-bold text-3xl leading-none">&times;</button>
        </div>

        {/* Content Area - Split Screen */}
        <div className="flex flex-col md:flex-row flex-grow overflow-hidden">
          
          {/* Left Side: Document Viewer (Smartly handles PDF vs Image) */}
          <div className="md:w-1/2 p-6 border-r border-gray-200 bg-gray-100 overflow-y-auto flex justify-center items-start h-full">
            {isPdf ? (
              <iframe 
                src={`${fileUrl}#toolbar=0`} 
                title="PDF Viewer"
                className="w-full h-full min-h-[500px] border border-gray-300 shadow-md rounded bg-white"
              />
            ) : (
              <img 
                src={fileUrl} 
                alt="Uploaded Document" 
                className="max-w-full h-auto shadow-md border border-gray-300"
                onError={(e) => { e.target.onerror = null; e.target.src = 'https://via.placeholder.com/400x600?text=File+Not+Found'; }}
              />
            )}
          </div>

          {/* Right Side: Data, OCR, and Timeline */}
          <div className="md:w-1/2 p-6 overflow-y-auto bg-white flex flex-col gap-6">
            
            {/* Status Badge */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-2">Current Status</h3>
              <span className={`px-4 py-1 text-sm font-bold rounded-full ${document.status === 'Approved' ? 'bg-green-100 text-green-800' : document.status === 'Rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                {document.status}
              </span>
            </div>

            {/* OCR Text */}
            <div className="flex flex-col">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-2">Extracted OCR Text</h3>
              <textarea 
                readOnly
                className="w-full h-32 p-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 font-mono text-sm resize-none focus:outline-none"
                value={document.extracted_text || 'No text extracted from this document.'}
              />
            </div>

            {/* Document History Timeline */}
            <div className="flex-grow flex flex-col">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 border-b pb-2">Approval History</h3>
              
              {isLoading ? (
                <p className="text-sm text-gray-500">Loading timeline...</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No actions have been taken on this document yet.</p>
              ) : (
                <div className="space-y-6 pl-2 border-l-2 border-indigo-100 ml-2">
                  {history.map((entry, index) => (
                    <div key={index} className="relative pl-6">
                      <span className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${entry.status === 'Approved' ? 'bg-green-500' : entry.status === 'Rejected' ? 'bg-red-500' : 'bg-gray-400'}`}></span>
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-500 font-medium">{new Date(entry.created_at).toLocaleString()}</span>
                        <span className="text-sm font-bold text-gray-800">
                          {entry.status} by {entry.approver_name}
                        </span>
                        {entry.comments && (
                          <div className={`mt-1 text-sm p-2 rounded ${entry.status === 'Rejected' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700 border border-gray-100'}`}>
                            "{entry.comments}"
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentDetailsModal;