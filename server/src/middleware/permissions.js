const pool = require('../db');

const SUPER_ADMIN_ROLE_ID = 3;
const STUDENT_ROLE_ID = 1;

// Only Super Admins, or users whose active dynamic role has can_create_workflows,
// may create, edit or delete workflows.
const requireWorkflowManager = async (req, res, next) => {
    try {
        if (req.user.role_id === SUPER_ADMIN_ROLE_ID) return next();
        const result = await pool.query(
            'SELECT can_create_workflows FROM dynamic_roles WHERE id = $1 AND is_active = TRUE',
            [req.user.role_id]
        );
        if (result.rows.length > 0 && result.rows[0].can_create_workflows) return next();
        return res.status(403).json({ message: 'Access Denied: You do not have permission to manage workflows.' });
    } catch (err) {
        console.error('Error checking workflow permission:', err);
        return res.status(500).json({ message: 'Server error verifying permissions.' });
    }
};

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
