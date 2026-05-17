import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';

const PublicVerification = () => {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchVerification = async () => {
      try {
        const res = await api.get(`/documents/verify-link/${token}`);
        setData(res.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Unable to verify this document. The link may be invalid.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchVerification();
  }, [token]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600 font-medium">Verifying Document Integrity...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center border-t-4 border-red-500">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Verification Failed</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link to="/" className="text-indigo-600 font-bold hover:underline">Return to Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
          
          {/* Header */}
          <div className="bg-indigo-900 px-8 py-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 320"><path fill="#ffffff" fillOpacity="1" d="M0,160L48,144C96,128,192,96,288,106.7C384,117,480,171,576,165.3C672,160,768,96,864,80C960,64,1056,96,1152,112C1248,128,1344,128,1392,128L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path></svg>
            </div>
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-lg border-4 border-indigo-700">
                <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h1 className="text-3xl font-extrabold text-white tracking-tight uppercase">Certificate of Authenticity</h1>
              <p className="text-indigo-200 mt-2 font-medium">Official E-flow Verification Record</p>
            </div>
          </div>

          <div className="p-8">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-8 flex items-start gap-4">
              <div className="p-2 bg-green-100 rounded-full text-green-600 mt-1">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-green-800">Verified Authentic</h3>
                <p className="text-sm text-green-700 mt-1">
                  This document has been successfully verified against the E-flow cryptographic ledger. The approval chain is intact and no tampering has been detected.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Document Title</h4>
                <p className="text-lg font-bold text-gray-900">{data.title}</p>
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Final Status</h4>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${data.status === 'Approved' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                  {data.status}
                </span>
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Submission Date</h4>
                <p className="text-sm font-medium text-gray-800">{new Date(data.submission_date).toLocaleString()}</p>
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Final Approval Date</h4>
                <p className="text-sm font-medium text-gray-800">{data.final_approval_date ? new Date(data.final_approval_date).toLocaleString() : 'Pending'}</p>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6 mb-8">
              <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                Approval Chain Metadata
              </h4>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
                <div className="space-y-4">
                  {data.approvals.map((app, idx) => (
                    <div key={idx} className="flex items-start gap-4">
                      <div className="mt-1 flex-shrink-0">
                        <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                          {idx + 1}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{app.role}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-green-600 font-bold uppercase tracking-wider">{app.status}</span>
                          <span className="text-gray-300">•</span>
                          <span className="text-xs text-gray-500 font-mono">{new Date(app.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.approvals.length === 0 && (
                    <p className="text-sm text-gray-500 italic">No approvals recorded.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-2">Cryptographic Fingerprint (SHA-256)</h4>
              <p className="text-xs font-mono text-gray-500 break-all bg-gray-100 p-3 rounded border border-gray-200">
                {data.document_hash || 'Hash not available'}
              </p>
              <p className="text-[10px] text-gray-400 mt-2">
                This hash acts as a digital fingerprint for the document. If even a single byte of the original file is modified, the hash will completely change.
              </p>
            </div>
          </div>
          
          <div className="bg-gray-50 px-8 py-4 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-500 font-medium">E-flow Automated Verification System</p>
            {data.purpose && (
              <p className="text-xs text-gray-400 mt-1">Link issued for: "{data.purpose}"</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicVerification;
