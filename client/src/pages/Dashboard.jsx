import { useContext, useEffect, useState, useCallback } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import WorkflowBuilder from '../components/WorkflowBuilder';
import DocumentUpload from '../components/DocumentUpload';
import DocumentDetailsModal from '../components/DocumentDetailsModal';
import OfficeManager from '../components/OfficeManager';
import StudentPortal from './StudentPortal';
import api from '../api';
import AdminOverview from '../components/admin/AdminOverview';
import PeopleManager from '../components/admin/PeopleManager';
import PermissionsPanel from '../components/admin/PermissionsPanel';
import AuditLog from '../components/admin/AuditLog';
import { PageHeader, Modal, Button, Badge } from '../components/ui';
import { can, hasAnyAdminPower, accountType } from '../access';

const Dashboard = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  // Each page has its own address (/dashboard/tasks, /dashboard/people...), so links and the back button work
  const { page } = useParams();
  const activeTab = page || 'dashboard';
  const setActiveTab = useCallback((next) => navigate(next === 'dashboard' ? '/dashboard' : `/dashboard/${next}`), [navigate]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [viewingDocument, setViewingDocument] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // NEW: upload state for staff services
  const [uploadWf, setUploadWf] = useState(null);

  const [myOffices, setMyOffices] = useState([]); // offices I work in (as head or officer)
  const [showAllRecent, setShowAllRecent] = useState(false);

  // NEW: Workflows state for the checklist logic
  const [workflows, setWorkflows] = useState([]);

  // Modal States
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [otpInput, setOtpInput] = useState('');
  const [otpHint, setOtpHint] = useState('');
  const [savedSignature, setSavedSignature] = useState('');

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [showResubmitModal, setShowResubmitModal] = useState(false);
  const [resubmitDocId, setResubmitDocId] = useState(null);
  const [resubmitFile, setResubmitFile] = useState(null);
  const [isResubmitting, setIsResubmitting] = useState(false);

  // Loading States and Toasts
  const [isApproving, setIsApproving] = useState(false);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [toastMessage, setToastMessage] = useState({ type: '', text: '' });

  const showToast = (type, text) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage({ type: '', text: '' }), 4000);
  };

  // Review step before signing: the step's required checklist and its decision outcomes
  const [showChecklistModal, setShowChecklistModal] = useState(false);
  const [currentChecklist, setCurrentChecklist] = useState([]);
  const [currentOutcomes, setCurrentOutcomes] = useState([]);
  const [chosenOutcome, setChosenOutcome] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [checkedItems, setCheckedItems] = useState([]);

  // NEW: In-app notifications
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Derive permissions securely (Preventing ID overlap with custom roles)
  const isStudent = user?.role_id === 1;
  const canDesignWorkflows = can(user, 'design_workflows');
  const canManageOffices = can(user, 'manage_offices');
  const canManagePeople = can(user, 'manage_people');
  const canViewAudit = can(user, 'view_audit_log');
  const showAdminOverview = hasAnyAdminPower(user);

  const fetchData = useCallback(async () => {
    try {
      const docResponse = await api.get('/documents');
      setDocuments(docResponse.data);
      if (!isStudent) {
        // Anyone who can be assigned a step needs the checklists and their signature
        const wfResponse = await api.get('/workflows');
        setWorkflows(wfResponse.data);
        const officesRes = await api.get('/offices/mine').catch(() => ({ data: [] }));
        setMyOffices(officesRes.data);
        const profileRes = await api.get('/auth/profile');
        if (profileRes.data?.signature_data) {
          setSavedSignature(profileRes.data.signature_data);
        }
      }
      // Always fetch notifications for logged-in users
      try {
        const notifRes = await api.get('/notifications');
        setNotifications(notifRes.data);
        setUnreadCount(notifRes.data.filter(n => !n.is_read).length);
      } catch (_) { /* non-critical */ }
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setDataLoaded(true);
    }
  }, [isStudent]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  // Pages someone may not open (an old link, or a permission taken away) fall back to the dashboard
  const allowedPages = {
    dashboard: true, services: true, tasks: true, notifications: true,
    office: myOffices.length > 0,
    workflows: canDesignWorkflows,
    offices: canManageOffices,
    people: canManagePeople,
    permissions: canManagePeople,
    audit: canViewAudit,
  };
  // My Office depends on data still loading, so it is only refused once that has arrived
  const pageBlocked = allowedPages[activeTab] === undefined
    || (allowedPages[activeTab] === false && (activeTab !== 'office' || dataLoaded));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // The workflow step this user is working on for `doc` (their own branch of a parallel review)
  const myStepNode = (doc) => {
    if (!doc?.workflow_id) return null;
    const wf = workflows.find(w => w.id === doc.workflow_id);
    if (!wf) return null;
    const flowData = typeof wf.flow_structure === 'string' ? JSON.parse(wf.flow_structure) : wf.flow_structure;
    let nodeId = doc.current_node_id;
    if (Array.isArray(doc.parallel_branch_data)) {
      const pending = doc.parallel_branch_data.filter(b => b.status === 'Pending');
      const myOfficeIds = myOffices.map(o => o.id);
      const branch = pending.find(b => b.assigneeId === user?.id)
        || pending.find(b => !b.assigneeId && b.officeId && myOfficeIds.includes(b.officeId))
        || pending.find(b => b.roleId != null && b.roleId === user?.role_id)
        || pending[0];
      nodeId = branch?.nodeId;
    }
    return (flowData?.nodes || []).find(n => n.id === nodeId) || null;
  };
  const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(Boolean);

  // Approving: confirm the step's checklist and choose its outcome first (the server checks both too)
  const handleRequestApproval = async (docId) => {
    const doc = documents.find(d => d.id === docId);
    setSelectedDocId(docId);
    const step = myStepNode(doc);
    const checklist = listOf(step?.data?.checklist);
    const outcomes = listOf(step?.data?.allowedTags);
    setCurrentChecklist(checklist);
    setCurrentOutcomes(outcomes);
    setCheckedItems([]);
    const preset = doc?.metadata_tag || '';
    setChosenOutcome(outcomes.find(o => o.toLowerCase() === String(preset).toLowerCase()) || '');
    setApprovalNote('');
    if (checklist.length > 0 || outcomes.length > 0) setShowChecklistModal(true);
    else proceedToOtp(docId);
  };

  const proceedToOtp = async (docId) => {
    setIsRequestingOtp(true);
    try {
      const res = await api.post('/approvals/request-otp', { documentId: docId });
      // Without SMTP (local demo), the server returns the code in its message
      setOtpHint(res.data?.message?.includes('dev mode') ? res.data.message : '');
      setShowChecklistModal(false);
      setShowOtpModal(true);
    } catch (err) {
      console.error(err);
      showToast('error', err.response?.data?.message || 'Failed to request OTP');
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleSubmitOtp = async () => {
    setIsApproving(true);
    const signatureDrawing = savedSignature || null;
    try {
      await api.post('/approvals/approve', {
        documentId: selectedDocId, otp: otpInput, comments: approvalNote.trim() || 'Verified by Staff', signatureDrawing,
        checklist: currentChecklist, outcome: chosenOutcome || undefined,
      });
      setShowOtpModal(false);
      setOtpInput('');
      fetchData();
      showToast('success', 'Approved successfully!');
    } catch (err) {
      showToast('error', err.response?.data?.message || 'Invalid OTP');
    } finally {
      setIsApproving(false);
    }
  };

  // ... (Reject and Resubmit logic remains exactly the same) ...
  const openRejectModal = (docId) => {
    setSelectedDocId(docId);
    setRejectComment('');
    setShowRejectModal(true);
  };

  const handleRejectSubmit = async () => {
    if (!rejectComment.trim()) return showToast('error', 'Reason required.');
    setIsRejecting(true);
    try {
      await api.post('/approvals/reject', { documentId: selectedDocId, comments: rejectComment });
      setShowRejectModal(false);
      setRejectComment('');
      fetchData();
      showToast('success', 'Document rejected.');
    } catch (error) {
      console.error(error);
      showToast('error', 'Failed to reject document.');
    } finally {
      setIsRejecting(false);
    }
  };

  const openResubmitModal = (docId) => {
    setResubmitDocId(docId);
    setResubmitFile(null);
    setShowResubmitModal(true);
  };

  const handleResubmit = async () => {
    if (!resubmitFile) return showToast('error', 'Please select a new file.');
    setIsResubmitting(true);
    const formData = new FormData();
    formData.append('document', resubmitFile);

    try {
      await api.put(`/documents/resubmit/${resubmitDocId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      showToast('success', 'Document successfully resubmitted!');
      setShowResubmitModal(false);
      setResubmitFile(null);
      fetchData();
    } catch (error) {
      showToast('error', 'Failed to resubmit document.');
    } finally {
      setIsResubmitting(false);
    }
  };

  const filteredDocs = documents.filter(doc => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const titleMatch = doc.title?.toLowerCase().includes(query);
    const textMatch = doc.extracted_text?.toLowerCase().includes(query);
    const statusMatch = doc.status?.toLowerCase().includes(query);
    const idString = doc.id ? doc.id.toString() : '';
    const idMatch = idString.includes(query) || `tsk-${idString.substring(0, 4)}`.includes(query);
    const workflowName = doc.workflow_id ? workflows.find(w => w.id === doc.workflow_id)?.name?.toLowerCase() : '';
    const workflowMatch = workflowName && workflowName.includes(query);
    
    return titleMatch || textMatch || statusMatch || idMatch || workflowMatch;
  });

  // The outcomes the reviewer can choose at this step (e.g. Undergraduate / Postgraduate)
  const getNodeAllowedTags = (doc) => listOf(myStepNode(doc)?.data?.allowedTags);

  // Which of approve / send back / attach files the step allows
  const getNodeAllowedActions = (doc) => {
    const allowed = myStepNode(doc)?.data?.allowedActions;
    return Array.isArray(allowed) ? allowed : ['approve', 'reject'];
  };

  const renderDashboardView = () => {
    const waitingForMe = documents.filter(isMyPendingTask).length;
    const myRequests = documents.filter(d => d.submitter_id === user?.id);
    const myInReview = myRequests.filter(d => d.status === 'Pending').length;
    const approvedDocs = documents.filter(d => d.status === 'Approved').length;
    const rejectedDocs = documents.filter(d => d.status === 'Rejected').length;
    const myRoles = (user?.offices || []).map(o => `${o.is_head ? 'Head' : (o.position_name || 'Officer')}, ${o.name}`);

    return (
      <div className="space-y-8 animate-fade-in">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Welcome back, {user?.name?.split(' ')[0]}</h2>
            <p className="text-gray-500 mt-1">
              {accountType(user)}{myRoles.length > 0 && <> · {myRoles.join(' · ')}</>}
            </p>
          </div>
          <button
            onClick={() => setActiveTab('services')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-semibold shadow-md transition-all flex items-center gap-2">
            <span className="text-xl font-bold leading-none mb-0.5">+</span>
            New Request
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500 mb-1">Waiting for me</p>
              <h3 className="text-4xl font-black text-gray-900">{waitingForMe}</h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center text-orange-500">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500 mb-1">Approved</p>
              <h3 className="text-4xl font-black text-gray-900">{approvedDocs}</h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center text-green-500">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500 mb-1">Rejected</p>
              <h3 className="text-4xl font-black text-gray-900">{rejectedDocs}</h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-500">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500 mb-1">My requests in review</p>
              <h3 className="text-4xl font-black text-gray-900">{myInReview}</h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-500">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </div>
          </div>
        </div>

        {showAdminOverview && <AdminOverview />}

        {/* Global Recent Items Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex justify-between items-center p-6 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">Recent Items</h3>
            <button onClick={() => setShowAllRecent(!showAllRecent)} className="text-sm text-blue-600 font-bold hover:underline">
              {showAllRecent ? 'Show Less' : 'View All'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Document</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white text-sm">
                {(showAllRecent ? documents : documents.slice(0, 5)).map(doc => (
                  <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-bold text-gray-900 cursor-pointer hover:text-blue-600" onClick={() => setViewingDocument(doc)}>{doc.title}</p>
                      <p className="text-xs text-gray-500">{doc.submitter_id === user.id ? 'My submission' : (doc.metadata_tag ? `Tag: ${doc.metadata_tag}` : 'Submitted document')}</p>
                    </td>
                    <td className="px-6 py-4">
                      {doc.status === 'Pending' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800"><span className="w-1.5 h-1.5 rounded-full bg-orange-500 mr-1.5"></span>Pending Review</span>}
                      {doc.status === 'Approved' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800"><span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5"></span>Approved</span>}
                      {doc.status === 'Rejected' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800"><span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5"></span>Rejected</span>}
                    </td>
                    <td className="px-6 py-4 text-gray-500">{new Date(doc.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {doc.status === 'Rejected' && doc.submitter_id === user.id && (
                          <button onClick={() => openResubmitModal(doc.id)} className="text-xs font-bold text-red-600 border border-red-200 hover:bg-red-600 hover:text-white px-2.5 py-1 rounded transition-colors">
                            Fix & Resubmit
                          </button>
                        )}
                        <button onClick={() => setViewingDocument(doc)} className="text-gray-400 hover:text-blue-600" title="View details">
                          <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {documents.length === 0 && (
                  <tr><td colSpan="4" className="px-6 py-8 text-center text-gray-500">No documents found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderTasksView = () => {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Tasks</h2>
            <p className="text-gray-500 mt-1">Documents waiting on you, or in your office's queue to claim.</p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <input
              type="text" placeholder="Search tasks, ID, or status..."
              className="w-full sm:w-64 px-4 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Task List replacing Staff Review Queue */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Task ID</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[18rem]">Task Title</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Assigned</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100 text-sm">
                {filteredDocs.filter(isMyPendingTask).length === 0 ? (
                  <tr><td colSpan="5" className="px-6 py-12 text-center text-gray-500">No pending assignments.</td></tr>
                ) : (
                  filteredDocs.filter(isMyPendingTask).map((doc) => {
                    const allowedTags = getNodeAllowedTags(doc);
                    const officeStep = officeStepFor(doc);
                    // Someone else in the office has claimed it: show it, but leave the actions to them
                    const allowedActions = officeStep && !officeStep.canAct ? [] : getNodeAllowedActions(doc);
                    const currentTag = doc.metadata_tag || '';
                    const stepChecklist = listOf(myStepNode(doc)?.data?.checklist);
                    return (
                      <tr key={doc.id} className="hover:bg-gray-50 transition-colors group">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-medium">#TSK-{doc.id.toString().substring(0, 4)}</td>
                        <td className="px-6 py-4">
                          <p className="font-bold text-gray-900 cursor-pointer group-hover:text-blue-600" onClick={() => setViewingDocument(doc)}>{doc.title}</p>
                          {officeStep ? (
                            <p className="text-xs mt-0.5 flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">{officeStep.headStep ? officeStep.office.name : `${officeStep.office.name} queue`}</span>
                              {officeStep.position && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-semibold">For: {officeStep.position.name}</span>}
                              <span className={officeStep.unclaimed ? 'text-amber-700 font-semibold' : 'text-gray-500'}>
                                {officeStep.headStep
                                  ? (officeStep.mine ? 'Head of office sign-off: assigned to you' : `Head of office sign-off: ${doc.current_assignee_name || 'the head'}`)
                                  : officeStep.unclaimed ? 'Unclaimed' : officeStep.mine ? 'Claimed by you' : `Claimed by ${doc.current_assignee_name || 'a colleague'}`}
                              </span>
                            </p>
                          ) : (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {Array.isArray(doc.parallel_branch_data) ? 'Parallel review: your branch' : doc.current_assignee_id === user?.id ? 'Assigned to you' : 'Assigned to your role'}
                            </p>
                          )}

                          {(currentTag || allowedTags.length > 0 || stepChecklist.length > 0) && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {currentTag && <Badge tone="indigo" title="Outcome chosen at an earlier step">Outcome: {currentTag}</Badge>}
                              {allowedTags.length > 0 && <Badge tone="amber" title={allowedTags.join(' / ')}>Decide: {allowedTags.join(' / ')}</Badge>}
                              {stepChecklist.length > 0 && <Badge tone="gray">{stepChecklist.length}-item checklist</Badge>}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">{new Date(doc.created_at).toLocaleDateString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-200">
                            Pending
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center space-x-2">
                          {/* Quick Action Buttons */}
                          <button onClick={() => setViewingDocument(doc)} className="text-gray-400 hover:text-blue-600 px-2 py-1 rounded text-xs font-bold border border-transparent hover:border-blue-200 hover:bg-blue-50 transition-colors">View</button>
                          {officeStep?.canClaim && (
                            <button onClick={() => handleClaim(doc.id)} className="text-indigo-600 hover:text-white px-3 py-1 rounded text-xs font-bold border border-indigo-200 hover:bg-indigo-600 transition-colors">Claim</button>
                          )}
                          {officeStep && !officeStep.unclaimed && !officeStep.headStep && (officeStep.mine || officeStep.office.i_am_head) && (
                            <button onClick={() => handleClaim(doc.id, true)} className="text-gray-500 hover:text-gray-800 px-2 py-1 rounded text-xs font-bold border border-gray-200 hover:bg-gray-100 transition-colors" title="Put it back in the office queue">Release</button>
                          )}
                          {allowedActions.includes('approve') && (
                            <button onClick={() => handleRequestApproval(doc.id)} className="text-green-600 hover:text-white px-3 py-1 rounded text-xs font-bold border border-green-200 hover:bg-green-600 transition-colors">Approve</button>
                          )}
                          {allowedActions.includes('reject') && (
                            <button onClick={() => openRejectModal(doc.id)} className="text-red-500 hover:text-white px-3 py-1 rounded text-xs font-bold border border-red-200 hover:bg-red-500 transition-colors">Reject</button>
                          )}
                          {allowedActions.includes('attach_documents') && (
                            <button onClick={() => setViewingDocument(doc)} className="text-indigo-500 hover:text-white px-3 py-1 rounded text-xs font-bold border border-indigo-200 hover:bg-indigo-500 transition-colors">Attach</button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // A document is in my queue if it's pending and waiting on me: directly, through my role,
  // or as one of the open branches of a parallel step.
  const isMyPendingTask = (d) => {
    if (d.status !== 'Pending' || d.resume_at) return false;
    const step = officeStepFor(d);
    if (step) return true; // in one of my offices' queues (claimed or not)
    const matches = (assigneeId, roleId, departmentId) => {
      if (assigneeId) return assigneeId === user?.id;
      return roleId != null && roleId === user?.role_id && (!departmentId || departmentId === user?.department_id);
    };
    if (Array.isArray(d.parallel_branch_data)) {
      return d.parallel_branch_data.some(b => b.status === 'Pending' && matches(b.assigneeId, b.roleId, b.departmentId));
    }
    return matches(d.current_assignee_id, d.current_role_id, d.current_department_id);
  };

  // If the document is waiting in one of my offices, describe that step:
  // { office, assigneeId, mine (claimed by me), unclaimed, canAct }
  const officeStepFor = (d) => {
    if (d.status !== 'Pending' || d.resume_at) return null;
    const flowNodes = (() => {
      const wf = workflows.find(w => w.id === d.workflow_id);
      const flow = wf ? (typeof wf.flow_structure === 'string' ? JSON.parse(wf.flow_structure) : wf.flow_structure) : null;
      return flow?.nodes || [];
    })();
    const describe = (officeId, assigneeId, nodeId, positionId) => {
      const office = myOffices.find(o => o.id === officeId);
      if (!office) return null;
      const mine = assigneeId === user?.id;
      // Steps for the office head don't go through the shared queue
      const headStep = flowNodes.find(n => n.id === nodeId)?.data?.officePosition === 'head';
      // A step for one position: only its holders (and the head) can claim or act on it
      const position = positionId ? (office.positions || []).find(p => p.id === positionId) : null;
      const myPosition = office.members?.find(m => m.id === user?.id)?.position_id;
      const eligible = !positionId || myPosition === positionId || office.i_am_head;
      const unclaimed = !assigneeId && !headStep;
      return { office, assigneeId, mine, headStep, position, unclaimed, canClaim: unclaimed && eligible, canAct: (!assigneeId && eligible) || mine || office.i_am_head };
    };
    if (Array.isArray(d.parallel_branch_data)) {
      for (const b of d.parallel_branch_data) {
        if (b.status === 'Pending' && b.officeId) {
          const step = describe(b.officeId, b.assigneeId, b.nodeId, b.positionId);
          if (step && (step.mine || step.canClaim)) return step;
        }
      }
      for (const b of d.parallel_branch_data) {
        if (b.status === 'Pending' && b.officeId) { const step = describe(b.officeId, b.assigneeId, b.nodeId, b.positionId); if (step) return step; }
      }
      return null;
    }
    return d.current_office_id ? describe(d.current_office_id, d.current_assignee_id, d.current_node_id, d.current_position_id) : null;
  };

  const handleClaim = async (docId, release = false) => {
    try {
      const res = await api.post(`/offices/queue/${docId}/${release ? 'release' : 'claim'}`);
      showToast('success', res.data.message);
      fetchData();
    } catch (err) {
      showToast('error', err.response?.data?.message || 'Could not update the claim.');
      fetchData();
    }
  };

  const renderServicesView = () => {
    // Filter workflows based on user's role
    // Admins can see all workflows regardless of allowedSubmitters restriction
    const staffWorkflows = workflows.filter(wf => {
      const flowData = typeof wf.flow_structure === 'string' ? JSON.parse(wf.flow_structure) : (wf.flow_structure || {});
      const meta = flowData.metadata || {};
      
      // Drafts (Unpublished workflows) are hidden from the services list entirely
      const isDraft = meta.isPublished === false || (meta.isPublished === undefined && meta.isComplete === false);
      if (isDraft) return false;

      if (canDesignWorkflows) return true; // Workflow designers see every live workflow, to try them

      const allowed = meta.allowedSubmitters || [];
      if (allowed.length === 0) return true; // Global service
      return allowed.includes(user.role_id);
    });

    const SERVICE_COLORS = [
      { bg: 'bg-blue-100', icon: 'text-blue-600', emoji: '📄' },
      { bg: 'bg-green-100', icon: 'text-green-600', emoji: '🎓' },
      { bg: 'bg-purple-100', icon: 'text-purple-600', emoji: '🪪' },
      { bg: 'bg-orange-100', icon: 'text-orange-600', emoji: '💻' },
    ];

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Select a Service</h2>
          <p className="text-gray-500 mt-1">Services displayed here are global or filtered specifically for your role.</p>
        </div>

        {staffWorkflows.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
            <p className="text-lg font-semibold mb-2">No services available</p>
            <p className="text-sm">There are currently no workflows assigned for your role to initiate.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {staffWorkflows.map((wf, idx) => {
              const { bg, icon, emoji } = SERVICE_COLORS[idx % SERVICE_COLORS.length];
              return (
                <button
                  key={wf.id}
                  onClick={() => setUploadWf(wf)}
                  className="bg-white rounded-xl border border-gray-200 p-6 text-left hover:shadow-lg hover:border-blue-300 transition-all group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center text-2xl shadow-sm`}>
                      {emoji}
                    </div>
                    <span className={`${icon} opacity-0 group-hover:opacity-100 transition-opacity bg-blue-50 p-1.5 rounded-full`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </span>
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">{wf.name}</h3>
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {wf.description || 'Initiate this workflow to create a new submission and trigger the approval process.'}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderNotificationsView = () => {
    const typeStyles = {
      success: { border: 'border-l-green-500', bg: 'hover:bg-green-50', dot: 'bg-green-500', icon: '✅' },
      danger:  { border: 'border-l-red-500',   bg: 'hover:bg-red-50',   dot: 'bg-red-500',   icon: '🚨' },
      warning: { border: 'border-l-amber-400', bg: 'hover:bg-amber-50', dot: 'bg-amber-500', icon: '⚠️' },
      info:    { border: 'border-l-blue-400',  bg: 'hover:bg-blue-50',  dot: 'bg-blue-400',  icon: '📄' },
    };
    const timeAgo = (dateStr) => {
      const diff = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins} min ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
      return new Date(dateStr).toLocaleDateString();
    };
    const markAllRead = async () => {
      try {
        await api.patch('/notifications/mark-all-read');
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        setUnreadCount(0);
      } catch (err) {
        showToast('error', 'Failed to mark notifications as read.');
      }
    };
    const markOneRead = async (id) => {
      try {
        await api.patch(`/notifications/${id}/read`);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (_) {}
    };

    return (
      <div className="space-y-6 animate-fade-in w-full max-w-4xl">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Notifications</h2>
            <p className="text-gray-500 mt-1">Stay updated with your latest alerts and workflow events.</p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-sm font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
            >
              ✓ Mark all as read ({unreadCount})
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
            <p className="text-4xl mb-3">🔔</p>
            <p className="font-semibold text-lg">No notifications yet</p>
            <p className="text-sm mt-1">You're all caught up!</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
            {notifications.map(notif => {
              const style = typeStyles[notif.type] || typeStyles.info;
              return (
                <div
                  key={notif.id}
                  onClick={() => {
                    if (!notif.is_read) markOneRead(notif.id);
                    if (notif.document_id) {
                      const doc = documents.find(d => d.id === notif.document_id);
                      if (doc) setViewingDocument(doc);
                    }
                  }}
                  className={`p-5 flex items-start gap-4 transition-colors cursor-pointer border-l-4 ${style.border} ${style.bg} ${notif.is_read ? 'opacity-60' : ''}`}
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg bg-gray-100 shrink-0">{style.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className={`text-sm font-bold ${notif.is_read ? 'text-gray-600' : 'text-gray-900'}`}>{notif.title}</h4>
                      <div className="flex items-center gap-2 shrink-0">
                        {!notif.is_read && <span className={`w-2 h-2 rounded-full ${style.dot} shrink-0`} />}
                        <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(notif.created_at)}</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{notif.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderSearchResultsView = () => {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Search Results for "{searchQuery}"</h2>
            <p className="text-gray-500 mt-1">Found {filteredDocs.length} items matching your query.</p>
          </div>
          <button onClick={() => setSearchQuery('')} className="text-sm font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg transition-colors">Clear Search</button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type / ID</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Title & Text Match</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100 text-sm">
                {filteredDocs.length === 0 ? (
                  <tr><td colSpan="4" className="px-6 py-12 text-center text-gray-500">No results found for "{searchQuery}".</td></tr>
                ) : (
                  filteredDocs.map(doc => {
                    const isTask = doc.status === 'Pending' && doc.submitter_id !== user?.id;
                    return (
                      <tr key={doc.id} className="hover:bg-gray-50 transition-colors group">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          {isTask ? (
                            <span className="inline-flex items-center gap-1.5 text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                              Task #{doc.id.toString().substring(0, 4)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                              Doc #{doc.id.toString().substring(0, 4)}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-bold text-gray-900 cursor-pointer group-hover:text-blue-600" onClick={() => setViewingDocument(doc)}>{doc.title}</p>
                          {doc.extracted_text && doc.extracted_text.toLowerCase().includes(searchQuery.toLowerCase()) && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2 italic">
                              "... {doc.extracted_text.substring(Math.max(0, doc.extracted_text.toLowerCase().indexOf(searchQuery.toLowerCase()) - 30), doc.extracted_text.toLowerCase().indexOf(searchQuery.toLowerCase()) + 60)} ..."
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {doc.status === 'Pending' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800"><span className="w-1.5 h-1.5 rounded-full bg-orange-500 mr-1.5"></span>Pending Review</span>}
                          {doc.status === 'Approved' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800"><span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5"></span>Approved</span>}
                          {doc.status === 'Rejected' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800"><span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5"></span>Rejected</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <button onClick={() => setViewingDocument(doc)} className="text-blue-600 hover:text-white px-3 py-1.5 rounded text-xs font-bold border border-blue-200 hover:bg-blue-600 transition-colors">View Details</button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ── Students get redirected to the new dedicated student portal ──────────
  if (isStudent) return <StudentPortal />;

  const go = (id) => { setActiveTab(id); setSearchQuery(''); setMobileNavOpen(false); };
  const ICONS = {
    dashboard: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
    tasks: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    services: 'M12 6v6m0 0v6m0-6h6m-6 0H6',
    notifications: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    office: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    workflows: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4zM7 10v4a2 2 0 002 2h5',
    offices: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01',
    people: 'M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m6-4.13a4 4 0 11-8 0 4 4 0 018 0zm6 2a3 3 0 11-6 0 3 3 0 016 0z',
    permissions: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
    audit: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  };
  const item = (id, label, count = 0) => ({ id, label, count, icon: ICONS[id] });
  const navGroups = [
    { title: 'Work', items: [
      item('dashboard', 'Dashboard'),
      item('tasks', 'Tasks', documents.filter(isMyPendingTask).length),
      item('services', 'Services'),
      item('notifications', 'Notifications', unreadCount),
      ...(myOffices.length > 0 ? [item('office', 'My Office')] : []),
    ] },
    { title: 'Administration', items: [
      ...(canDesignWorkflows ? [item('workflows', 'Workflows')] : []),
      ...(canManageOffices ? [item('offices', 'Offices & Positions')] : []),
      ...(canManagePeople ? [item('people', 'People'), item('permissions', 'Permissions')] : []),
      ...(canViewAudit ? [item('audit', 'Audit Log')] : []),
    ] },
  ].filter(g => g.items.length > 0);

  return (
    <div className="min-h-screen bg-[#f8f9fc] flex font-sans">
      {/* SIDEBAR NAVIGATION (a drawer on small screens) */}
      {mobileNavOpen && <div className="fixed inset-0 bg-gray-900/40 z-30 md:hidden" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`w-64 bg-white border-r border-gray-100 flex-col flex-shrink-0 h-screen z-40 fixed md:sticky top-0 transition-transform ${mobileNavOpen ? 'flex translate-x-0' : 'hidden md:flex'}`}>
        <div className="p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm leading-none">E-Flow</p>
            <p className="text-xs text-gray-500 mt-0.5">{accountType(user)}</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto" aria-label="Main">
          {navGroups.map(group => (
            <div key={group.title}>
              <p className="px-3 mb-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest">{group.title}</p>
              <div className="space-y-1">
                {group.items.map(item => (
                  <button key={item.id} onClick={() => go(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === item.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
                    <span className="flex items-center gap-3">
                      <svg className="w-5 h-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} /></svg>
                      {item.label}
                    </span>
                    {item.count > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${item.id === 'notifications' ? 'bg-red-500 text-white' : 'bg-blue-100 text-blue-700'}`}>{item.count}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-100 mt-auto">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors">
            <svg className="w-5 h-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Log out
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-20 bg-white border-b border-gray-100 flex items-center justify-between px-4 sm:px-8 sticky top-0 z-20 w-full gap-3">
          <button onClick={() => setMobileNavOpen(true)} className="md:hidden p-2 -ml-2 text-gray-500 hover:text-gray-900" aria-label="Open menu">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="w-full max-w-xl">
            <div className="relative">
              <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                type="text"
                placeholder={activeTab === 'tasks' ? "Search tasks, ID, or status..." : "Search documents, tasks..."}
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-transparent rounded-lg text-sm focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all outline-none text-gray-700"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-6 ml-4">
            <button onClick={() => window.document.documentElement.classList.toggle('dark-theme')} className="relative text-gray-400 hover:text-gray-600 transition-colors">
              <span className="w-6 h-6 block text-center leading-6">🌙</span>
            </button>
            <button onClick={() => { setActiveTab('notifications'); setSearchQuery(''); }} className="relative text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-white rounded-full text-white text-[9px] font-bold flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
            <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/profile')}>
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-gray-900">{user?.name}</p>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{accountType(user)}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold border-2 border-white shadow-sm overflow-hidden">
                {(user?.name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')}
              </div>
            </div>
          </div>
        </header>

        {/* Global Toast Notification */}
        {toastMessage.text && (
          <div className="fixed top-24 right-8 z-50 animate-fade-in">
            <div className={`px-6 py-4 rounded-xl shadow-2xl border-l-4 font-semibold text-sm flex items-center gap-3 ${toastMessage.type === 'error' ? 'bg-white border-red-500 text-red-700' : 'bg-white border-green-500 text-green-700'}`}>
              <span className="text-xl">{toastMessage.type === 'error' ? '🚨' : '✅'}</span>
              {toastMessage.text}
            </div>
          </div>
        )}

        {/* Dynamic Page Content */}
        <main className={`flex-1 overflow-y-auto relative ${activeTab === 'workflows' && !searchQuery ? 'p-3 sm:p-4' : 'p-4 sm:p-8'}`}>
          <div className={activeTab === 'workflows' && !searchQuery ? 'h-full' : 'max-w-[1400px] mx-auto'}>
            {searchQuery ? renderSearchResultsView() : pageBlocked ? (
              <div className="max-w-lg mx-auto mt-16 text-center bg-white border border-gray-200 rounded-xl p-10">
                <h2 className="text-xl font-bold text-gray-900">This page isn't available to you</h2>
                <p className="text-gray-500 mt-2 text-sm">It may need a permission you don't have. Ask an administrator if you think you should have access.</p>
                <button onClick={() => go('dashboard')} className="mt-6 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg">Back to the dashboard</button>
              </div>
            ) : (
              <>
                {activeTab === 'dashboard' && renderDashboardView()}
                {activeTab === 'services' && renderServicesView()}
                {activeTab === 'tasks' && renderTasksView()}
                {activeTab === 'notifications' && renderNotificationsView()}
                {activeTab === 'office' && (
                  <div className="space-y-6">
                    <PageHeader
                      title="My Office"
                      subtitle={myOffices.some(o => o.i_am_head)
                        ? `You head ${myOffices.filter(o => o.i_am_head).map(o => o.name).join(' and ')}: set up its positions, add officers and say who covers when someone is away. Documents sent to an office appear in Tasks for the right people to claim.`
                        : 'Documents sent to your office, or to your position in it, appear in Tasks where you can claim them.'}
                    />
                    <OfficeManager mode="mine" showToast={showToast} />
                  </div>
                )}
                {activeTab === 'workflows' && (
                  <WorkflowBuilder onExit={() => go('dashboard')} />
                )}
                {activeTab === 'offices' && (
                  <div className="space-y-6">
                    <PageHeader
                      title="Offices & Positions"
                      subtitle="Every office has a head, positions such as Deputy or Cashier, and officers. Workflow steps go to an office or a position in it, and late work escalates up the office."
                    />
                    <OfficeManager mode="admin" showToast={showToast} />
                  </div>
                )}
                {activeTab === 'people' && <PeopleManager showToast={showToast} />}
                {activeTab === 'permissions' && <PermissionsPanel showToast={showToast} onOpenPeople={() => go('people')} />}
                {activeTab === 'audit' && <AuditLog showToast={showToast} />}
              </>
            )}
          </div>
        </main>

        {/* MODAL 1: REVIEW BEFORE SIGNING (outcome + required checklist) */}
        {showChecklistModal && (() => {
          const ready = checkedItems.length === currentChecklist.length && (currentOutcomes.length === 0 || chosenOutcome);
          const doc = documents.find(d => d.id === selectedDocId);
          return (
            <Modal
              title="Review before signing"
              subtitle={doc ? doc.title : undefined}
              onClose={() => setShowChecklistModal(false)}
              footer={<>
                <Button variant="secondary" onClick={() => setShowChecklistModal(false)}>Cancel</Button>
                <Button onClick={() => proceedToOtp(selectedDocId)} disabled={!ready || isRequestingOtp}>
                  {isRequestingOtp ? 'Sending code...' : 'Continue to sign'}
                </Button>
              </>}
            >
              {currentOutcomes.length > 0 && (
                <div className="mb-5">
                  <p className="text-sm font-semibold text-gray-900">Decision</p>
                  <p className="text-xs text-gray-500 mb-2">Choose the outcome of this step. Later steps can route the document on it.</p>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Outcome">
                    {currentOutcomes.map(o => (
                      <button key={o} type="button" role="radio" aria-checked={chosenOutcome === o}
                        onClick={() => setChosenOutcome(o)}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${chosenOutcome === o ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:border-indigo-400'}`}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {currentChecklist.length > 0 && (
                <div className="mb-5">
                  <div className="flex items-baseline justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-900">Required checks</p>
                    <span className="text-xs text-gray-500">{checkedItems.length} of {currentChecklist.length} confirmed</span>
                  </div>
                  <div className="space-y-2">
                    {currentChecklist.map((item, idx) => (
                      <label key={idx} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${checkedItems.includes(idx) ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
                        <input
                          type="checkbox"
                          className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                          checked={checkedItems.includes(idx)}
                          onChange={(e) => {
                            if (e.target.checked) setCheckedItems([...checkedItems, idx]);
                            else setCheckedItems(checkedItems.filter(i => i !== idx));
                          }}
                        />
                        <span className="text-sm text-gray-800 leading-snug">{item}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Your confirmations are saved with your signature in the document history.</p>
                </div>
              )}

              <label className="block">
                <span className="text-sm font-semibold text-gray-900">Note (optional)</span>
                <textarea rows="2" value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)}
                  placeholder="Anything the next reviewer should know"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500" />
              </label>
            </Modal>
          );
        })()}

        {/* MODAL 2: OTP / 2FA */}
        {showOtpModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-md">
              <h3 className="text-lg font-bold mb-2">Verify & Approve</h3>
              <p className="text-sm text-gray-600 mb-4">Enter the OTP sent to your email to confirm your approval.</p>
              {otpHint && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">{otpHint}</p>}
              
              <input type="text" placeholder="Enter OTP from email" className="w-full px-3 py-2 border rounded-md mb-4" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} />

              {/* Signature preview — always from profile, no live drawing */}
              <div className="border border-gray-200 rounded-md bg-gray-50 mb-4 p-3">
                {savedSignature ? (
                  <div className="text-center">
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">Your Registered Signature</p>
                    <img src={savedSignature} alt="Registered Signature" className="h-16 mx-auto object-contain" />
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-amber-700 font-semibold">⚠️ No signature registered</p>
                    <p className="text-xs text-gray-500 mt-1">Go to your <strong>Profile</strong> to register your signature before approving documents.</p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => setShowOtpModal(false)} className="px-4 py-2 text-gray-600">Cancel</button>
                <button 
                  onClick={handleSubmitOtp} 
                  disabled={isApproving || !savedSignature}
                  className={`px-4 py-2 text-white rounded font-bold transition-colors ${isApproving || !savedSignature ? 'bg-green-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                >
                  {isApproving ? 'Approving...' : 'Sign & Approve'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 3: REJECT */}
        {showRejectModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-md">
              <h3 className="text-lg font-bold text-red-600 mb-2">Reject Document</h3>
              <textarea className="w-full px-3 py-2 border rounded-md mb-4" rows="3" placeholder="Reason..." value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowRejectModal(false)} className="px-4 py-2 text-gray-600">Cancel</button>
                <button onClick={handleRejectSubmit} disabled={isRejecting} className={`px-4 py-2 text-white rounded font-bold ${isRejecting ? 'bg-red-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}>
                  {isRejecting ? 'Rejecting...' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 4: RESUBMIT */}
        {showResubmitModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-md">
              <h3 className="text-lg font-bold text-indigo-600 mb-2">Fix & Resubmit</h3>
              <input type="file" accept="image/*,.pdf" onChange={(e) => setResubmitFile(e.target.files[0])} className="w-full px-3 py-2 border rounded-md mb-4" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowResubmitModal(false)} className="px-4 py-2 text-gray-600">Cancel</button>
                <button onClick={handleResubmit} disabled={isResubmitting} className={`px-4 py-2 text-white rounded font-bold ${isResubmitting ? 'bg-indigo-400' : 'bg-indigo-600'}`}>
                  {isResubmitting ? 'Processing...' : 'Upload & Resubmit'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DOCUMENT VIEWER MODAL */}
        {viewingDocument && (
          <DocumentDetailsModal document={viewingDocument} onClose={() => setViewingDocument(null)} />
        )}

        {/* Upload Modal for Services */}
        {uploadWf && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="w-full max-w-lg bg-white rounded-xl overflow-hidden shadow-2xl">
              <div className="flex justify-between items-center p-4 border-b border-gray-100">
                <div>
                  <h3 className="font-bold text-gray-900">{uploadWf.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Submit your request details below.</p>
                </div>
                <button onClick={() => setUploadWf(null)} className="text-gray-400 hover:text-gray-800 text-xl font-bold">&times;</button>
              </div>
              <div className="p-2">
                {/* Leveraging the existing DocumentUpload component but forcing workflow ID */}
                <DocumentUpload
                  onUploadSuccess={() => { setUploadWf(null); fetchData(); setActiveTab('tasks'); }}
                  forcedWorkflowId={uploadWf.id}
                />
              </div>
            </div>
          </div>
        )}

        {/* MODAL 6: EXPORT AUDIT LOGS */}
      </div>
    </div>
  );
};

export default Dashboard;