import React from 'react';

const DocumentDetailsModal = ({ document, onClose }) => {
  if (!document) return null;

  // Force all slashes to be forward slashes for the web (Windows fix)
  // 1. Extract ONLY the exact filename, ignoring all Windows or Mac folder paths
  const fileName = document.file_path.replace(/\\/g, '/').split('/').pop();
  
  // 2. Build a perfect, strictly formatted web URL
  const imageUrl = `http://localhost:5000/uploads/${fileName}`;
  
  console.log("Loading image strictly from:", imageUrl);
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="text-xl font-bold text-gray-800">{document.title}</h2>
            <p className="text-sm text-gray-500">Submitted on: {new Date(document.created_at).toLocaleString()}</p>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 font-bold text-3xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Content Area - Split Screen */}
        <div className="flex flex-col md:flex-row flex-grow overflow-hidden">
          
          {/* Left Side: Original Image */}
          <div className="md:w-1/2 p-6 border-r border-gray-200 bg-gray-100 overflow-y-auto flex justify-center items-start">
            <img 
              src={imageUrl} 
              alt="Uploaded Document" 
              className="max-w-full h-auto shadow-md border border-gray-300"
              onError={(e) => { e.target.onerror = null; e.target.src = 'https://via.placeholder.com/400x600?text=Image+Not+Found'; }}
            />
          </div>

          {/* Right Side: Data & Extracted Text */}
          <div className="md:w-1/2 p-6 overflow-y-auto bg-white flex flex-col gap-6">
            <div>
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-2">Status</h3>
              <span className={`px-4 py-1 text-sm font-bold rounded-full ${document.status === 'Approved' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                {document.status}
              </span>
            </div>

            <div className="flex-grow flex flex-col">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-2">Extracted OCR Text</h3>
              <textarea 
                readOnly
                className="w-full flex-grow min-h-[300px] p-4 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 font-mono text-sm resize-none focus:outline-none"
                value={document.extracted_text || 'No text extracted from this document.'}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default DocumentDetailsModal;