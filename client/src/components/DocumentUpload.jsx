import React, { useState, useEffect } from 'react';
import api from '../api';

const DocumentUpload = ({ onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [workflows, setWorkflows] = useState([]); 
  const [isUploading, setIsUploading] = useState(false);

  // Fetch available workflows when component loads
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const response = await api.get('/workflows');
        setWorkflows(response.data);
        if (response.data.length > 0) {
          setWorkflowId(response.data[0].id); // Default to the first workflow
        }
      } catch (error) {
        console.error('Error fetching workflows:', error);
      }
    };
    fetchWorkflows();
  }, []);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !title) {
      alert('Please provide a title and select a file.');
      return;
    }
    if (workflows.length > 0 && !workflowId) {
      alert('Please select a workflow.');
      return;
    }

    const formData = new FormData();
    formData.append('document', file);
    formData.append('title', title);
    if (workflowId) formData.append('workflow_id', workflowId);

    setIsUploading(true);

    try {
      await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      alert('Document uploaded successfully!');
      setFile(null);
      setTitle('');
      onUploadSuccess();
    } catch (error) {
      console.error('Error uploading document:', error);
      alert('Failed to upload document.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h3 className="text-xl font-semibold mb-4">Submit New Document</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Document Title</label>
          <input 
            type="text" 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="e.g., Registration Form"
          />
        </div>

        {/* The Missing Dropdown Menu */}
        {workflows.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Workflow</label>
            <select 
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            >
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>{wf.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Upload File (Image)</label>
          <input 
            type="file" 
            accept="image/*"
            onChange={handleFileChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
          />
        </div>

        <button 
          type="submit" 
          disabled={isUploading}
          className={`w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${isUploading ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
        >
          {isUploading ? 'Processing OCR...' : 'Submit Document'}
        </button>
      </form>
    </div>
  );
};

export default DocumentUpload;