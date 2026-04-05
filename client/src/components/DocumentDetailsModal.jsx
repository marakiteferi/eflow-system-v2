import React, { useState, useEffect, useRef } from 'react';
import api from '../api';

const DocumentDetailsModal = ({ document, onClose }) => {
  const [history, setHistory] = useState([]);
  const [clearances, setClearances] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scale, setScale] = useState(1);
  
  const viewerRef = useRef(null);
  const imageContainerRef = useRef(null);

  // 1. Safely calculate file data BEFORE the hooks using optional chaining (?)
  const cleanPath = document?.file_path?.replace(/\\/g, '/') || '';
  const finalPath = cleanPath.startsWith('/') ? cleanPath.substring(1) : cleanPath;
  const fileUrl = finalPath ? `http://localhost:5000/${finalPath}?v=${Date.now()}` : '';
  const isPdf = finalPath.toLowerCase().endsWith('.pdf');
  const isImage = finalPath.match(/\.(jpg|jpeg|png)$/i);

  // HOOK 1: Fetch History
  useEffect(() => {
    const fetchHistory = async () => {
      if (!document) return; // Safe guard inside the hook
      try {
        const [histRes, clearRes] = await Promise.all([
          api.get(`/documents/${document.id}/history`),
          api.get(`/documents/${document.id}/clearances`).catch(() => ({ data: [] }))
        ]);
        setHistory(histRes.data);
        setClearances(clearRes.data);
      } catch (error) {
        console.error('Failed to fetch history:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchHistory();
  }, [document]);

  // HOOK 2: Lock dashboard background scroll
  useEffect(() => {
    window.document.body.style.overflow = 'hidden';
    return () => {
      window.document.body.style.overflow = 'unset';
    };
  }, []);

  // HOOK 3: Native Event Listener for the perfect zoom
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container || !isImage) return;

    const handleNativeWheel = (e) => {
      e.preventDefault(); 
      if (e.deltaY < 0) {
        setScale(prev => Math.min(prev + 0.15, 5));
      } else {
        setScale(prev => Math.max(prev - 0.15, 0.5));
      }
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  }, [isImage]);

  // ==========================================
  // All hooks have safely run! NOW we can do our early return.
  // ==========================================
  if (!document) return null;

  const handleDownload = async (e, customUrl, customTitle) => {
    if (e) e.preventDefault();
    const targetUrl = customUrl || fileUrl;
    const isTargetPdf = targetUrl.toLowerCase().endsWith('.pdf');
    const isTargetImage = targetUrl.match(/\.(jpg|jpeg|png)$/i);
    const targetTitle = customTitle || document.title;
    
    try {
      const response = await fetch(targetUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `Stamped_${targetTitle.replace(/\s+/g, '_')}${isTargetImage ? '.jpg' : isTargetPdf ? '.pdf' : '.pdf'}`;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
      alert("Failed to download file. Ensure your server is running.");
    }
  };

  const toggleFullScreen = () => {
    if (!window.document.fullscreenElement) {
      viewerRef.current.requestFullscreen().catch(err => {
        alert(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      window.document.exitFullscreen();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <div className="flex flex-col">
            <h2 className="text-xl font-bold text-gray-800">{document.title}</h2>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-sm text-gray-500">Submitted on: {new Date(document.created_at).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleDownload}
              className="bg-indigo-600 text-white px-4 py-2 rounded text-sm font-bold shadow hover:bg-indigo-700 transition-colors flex items-center gap-2"
            >
              📥 Download
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-red-600 font-bold text-3xl leading-none transition-colors">&times;</button>
          </div>
        </div>

        {/* Content Area - Split Screen */}
        <div className="flex flex-col md:flex-row flex-grow overflow-hidden">
          
          {/* Left Side: Document Viewer */}
          <div 
            ref={viewerRef}
            className="md:w-1/2 p-6 border-r border-gray-200 bg-white overflow-hidden flex flex-col items-center justify-center relative group"
          >
            {/* Fullscreen Button */}
            <button 
              onClick={toggleFullScreen}
              className="absolute top-4 right-4 bg-gray-800 bg-opacity-70 text-white p-2 rounded hover:bg-opacity-100 transition-opacity z-10 flex items-center gap-2 text-xs font-bold shadow-lg"
            >
              ⛶ Fullscreen
            </button>

            {isPdf ? (
              <iframe 
                src={`${fileUrl}#toolbar=0`} 
                title="PDF Viewer"
                className="w-full h-full min-h-[500px] border border-gray-300 shadow-md rounded bg-white"
              />
            ) : isImage ? (
              <div 
                ref={imageContainerRef}
                className="w-full h-full overflow-hidden flex items-center justify-center bg-gray-100 border border-gray-300 shadow-inner rounded cursor-crosshair relative"
              >
                {/* Reset Zoom Indicator */}
                {scale !== 1 && (
                  <button 
                    onClick={() => setScale(1)} 
                    className="absolute bottom-4 right-4 bg-white px-3 py-1 rounded shadow text-xs font-bold text-gray-600 hover:text-indigo-600 z-10"
                  >
                    Reset Zoom ({(scale * 100).toFixed(0)}%)
                  </button>
                )}
                <img 
                  src={fileUrl} 
                  alt="Uploaded Document" 
                  style={{ transform: `scale(${scale})`, transition: 'transform 0.1s ease-out', transformOrigin: 'center' }}
                  className="max-w-none shadow-md bg-white pointer-events-none"
                  onError={(e) => { e.target.onerror = null; e.target.src = 'https://via.placeholder.com/400x600?text=File+Not+Found'; }}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full w-full text-gray-500">
                Unsupported file format. Please download to view.
              </div>
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

            {/* Clearances Block */}
            {clearances.length > 0 && (
              <div className="flex flex-col bg-gray-50 p-4 border border-gray-200 rounded-xl">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Required Clearances</h3>
                  <span className="text-xs font-bold text-gray-500 bg-white px-2 py-1 rounded border border-gray-200">{clearances.filter(c => c.fulfilled_by_document_id).length} / {clearances.length} Completed</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 mb-4 overflow-hidden">
                  <div className="bg-blue-600 h-1.5 transition-all duration-300" style={{ width: `${(clearances.filter(c => c.fulfilled_by_document_id).length / clearances.length) * 100}%` }}></div>
                </div>
                <div className="space-y-3">
                  {clearances.map((c, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-gray-800">{c.required_workflow_name}</span>
                        {c.fulfilled_by_document_id ? (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded text-center leading-none">✓ Fulfilled</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded text-center leading-none">⏳ Pending</span>
                        )}
                      </div>
                      {c.fulfilled_by_document_id ? (
                        <div className="text-xs text-gray-600 flex items-center justify-between mt-1">
                          <span className="truncate max-w-[200px]" title={c.fulfilling_document_title}>Via: {c.fulfilling_document_title}</span>
                          <button 
                            onClick={(e) => {
                              const fp = c.fulfilling_file_path.replace(/\\/g, '/');
                              const targetUrl = `http://localhost:5000/${fp.startsWith('/') ? fp.substring(1) : fp}?v=${Date.now()}`;
                              handleDownload(e, targetUrl, c.fulfilling_document_title);
                            }}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-semibold transition-colors"
                          >
                            ⬇ View File
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500 italic mt-1">Applicant must submit a separate document for this workflow.</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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