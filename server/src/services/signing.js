/**
 * Tamper-evident approval signatures.
 *
 * Every approval stores:
 *   document_hash           SHA-256 of the file at the moment it was approved
 *   previous_approval_hash  SHA-256 over the previous signed approval (links the chain)
 *   approval_signature      HMAC-SHA256 over (document hash | approver | time | previous hash)
 *
 * Because the previous hash is inside the HMAC, editing or deleting any earlier
 * approval breaks every signature after it, and nobody without the server's
 * secret can forge a replacement.
 */
const crypto = require('crypto');
const fs = require('fs');

const secret = () => {
    if (!process.env.APPROVAL_SIGNING_SECRET) throw new Error('APPROVAL_SIGNING_SECRET is not set');
    return process.env.APPROVAL_SIGNING_SECRET;
};

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('hex');

const hashFile = (filePath) => sha256(fs.readFileSync(filePath));

/** Hash that links an approval to the one before it. */
const linkHash = (prev) => (prev ? sha256(`${prev.document_hash}|${prev.approver_id}|${prev.approval_signature}`) : null);

const signaturePayload = ({ documentHash, approverId, createdAt, previousApprovalHash }) =>
    `${documentHash}|${approverId}|${new Date(createdAt).toISOString()}|${previousApprovalHash || ''}`;

// Signatures created before the previous hash was included in the HMAC
const legacyPayload = ({ documentHash, approverId, createdAt }) =>
    `${documentHash}|${approverId}|${new Date(createdAt).toISOString()}`;

/** Build the signed fields for a new approval, chained to the latest signed approval on the document. */
const signApproval = async (db, { documentId, approverId, filePath, createdAt = new Date() }) => {
    const documentHash = hashFile(filePath);
    const prevResult = await db.query(
        `SELECT id, approval_signature, document_hash, approver_id
         FROM approvals
         WHERE document_id = $1 AND approval_signature IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
        [documentId]
    );
    const prev = prevResult.rows[0] || null;
    const previousApprovalHash = linkHash(prev);
    const approvalSignature = hmac(signaturePayload({ documentHash, approverId, createdAt, previousApprovalHash }));
    return {
        documentHash,
        approvalSignature,
        previousApprovalId: prev ? prev.id : null,
        previousApprovalHash,
        createdAt,
    };
};

/**
 * Verify every signed approval on a document, in order.
 * Unsigned records (rejections, automatic escalations) are listed but not verified.
 *
 * fileIntact says whether the file on disk is still the one that was approved. Once a
 * document is fully approved, a certificate page is added to the PDF, so the stamped
 * file's hash (documents.final_file_hash) is what it is compared against.
 */
const verifyChain = (approvals, { currentFileHash = null, finalFileHash = null } = {}) => {
    const results = [];
    let chainValid = true;
    let prevSigned = null;

    approvals.forEach((a, i) => {
        const entry = {
            order: i + 1,
            approver_id: a.approver_id,
            status: a.status,
            timestamp: a.created_at,
            signed: Boolean(a.approval_signature),
        };

        if (!a.approval_signature) {
            results.push(entry);
            return;
        }

        const fields = {
            documentHash: a.document_hash,
            approverId: a.approver_id,
            createdAt: a.created_at,
            previousApprovalHash: a.previous_approval_hash,
        };
        const signatureValid =
            a.approval_signature === hmac(signaturePayload(fields)) ||
            a.approval_signature === hmac(legacyPayload(fields));

        const expectedLink = linkHash(prevSigned);
        const linkValid = prevSigned ? a.previous_approval_hash === expectedLink : true;

        entry.signature_valid = signatureValid;
        entry.link_valid = linkValid;

        if (!signatureValid || !linkValid) chainValid = false;
        results.push(entry);
        prevSigned = a;
    });

    let fileIntact = null;
    if (currentFileHash) {
        if (finalFileHash) fileIntact = currentFileHash === finalFileHash;
        else if (prevSigned) fileIntact = currentFileHash === prevSigned.document_hash;
    }

    return { chainValid, fileIntact, approvals: results };
};

module.exports = { hashFile, signApproval, verifyChain, linkHash, sha256 };
