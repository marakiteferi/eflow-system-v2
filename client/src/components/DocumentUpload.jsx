import { useState } from 'react';
import Tesseract from 'tesseract.js';
import api from '../api';

const DocumentUpload = ({ onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [extractedText, setExtractedText] = useState('');
  const [status, setStatus] = useState('');

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file || !title) return alert("Please provide a title and select a file");

    setLoading(true);
    setStatus('Scanning document with OCR...');

    try {
      // 1. Run OCR (Note: This works best with images. If it's a PDF, Tesseract needs additional config, so test with JPG/PNG for now)
      const result = await Tesseract.recognize(file, 'eng');
      setExtractedText(result.data.text);
      setStatus('OCR Complete. Uploading to server...');

      // 2. Prepare FormData for Multer
      const formData = new FormData();
      formData.append('document', file);
      formData.append('title', title);
      formData.append('extracted_text', result.data.text);

      // 3. Send to backend
      await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setStatus('Success! Document submitted.');
      setFile(null);
      setTitle('');
      if(onUploadSuccess) onUploadSuccess(); // Refresh the document list
      
    } catch (err) {
      console.error(err);
      setStatus('Error processing document.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h3 className="text-xl font-semibold mb-4">Submit New Document</h3>
      <form onSubmit={handleUpload} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Document Title</label>
          <input 
            type="text" 
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Upload File (Image)</label>
          <input 
            type="file" 
            accept="image/*"
            required
            onChange={(e) => setFile(e.target.files[0])} 
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" 
          />
        </div>

        {loading && <div className="text-blue-600 font-medium animate-pulse">{status}</div>}
        {!loading && status && <div className="text-green-600 font-medium">{status}</div>}

        {!loading && extractedText && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Extracted Text Preview</label>
            <textarea 
              readOnly
              className="w-full h-32 p-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-gray-600"
              value={extractedText}
            />
          </div>
        )}

        <button 
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Processing...' : 'Submit Document'}
        </button>
      </form>
    </div>
  );
};

export default DocumentUpload;