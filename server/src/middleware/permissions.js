const pool = require('../db');

const { requirePermission } = require('../services/access');

const STUDENT_ROLE_ID = 1;

// Administrators, and staff given the "Design workflows" permission,
// may create, edit or delete workflows.
const requireWorkflowManager = requirePermission('design_workflows');

// Students may only read details of documents they submitted.
// Staff and admins can read documents, since they review them in the approval queue.
const requireDocumentAccess = async (req, res, next) => {
    try {
        if (req.user.role_id !== STUDENT_ROLE_ID) return next();
        const result = await pool.query('SELECT submitter_id FROM documents WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Document not found.' });
        if (result.rows[0].submitter_id === req.user.id) return next();
        return res.status(403).json({ message: 'You are not authorized to view this document.' });
    } catch (err) {
        console.error('Error checking document access:', err);
        return res.status(500).json({ message: 'Server error verifying permissions.' });
    }
};

module.exports = { requireWorkflowManager, requireDocumentAccess };
