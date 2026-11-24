const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.APPROVAL_SIGNING_SECRET = 'test-secret';
const { verifyChain, linkHash } = require('../src/services/signing');

const sign = (fields) =>
    crypto.createHmac('sha256', 'test-secret')
        .update(`${fields.document_hash}|${fields.approver_id}|${fields.created_at.toISOString()}|${fields.previous_approval_hash || ''}`)
        .digest('hex');

// Build a valid chain of signed approvals the same way the server does
const buildChain = (n, fileHash = 'f'.repeat(64)) => {
    const chain = [];
    for (let i = 0; i < n; i++) {
        const prev = chain[chain.length - 1];
        const a = {
            id: i + 1,
            status: 'Approved',
            approver_id: 10 + i,
            document_hash: fileHash,
            created_at: new Date(Date.UTC(2026, 0, 1, 9, i)),
            previous_approval_hash: linkHash(prev),
        };
        a.approval_signature = sign(a);
        chain.push(a);
    }
    return chain;
};

test('a valid chain verifies', () => {
    const r = verifyChain(buildChain(3), { currentFileHash: 'f'.repeat(64) });
    assert.equal(r.chainValid, true);
    assert.equal(r.fileIntact, true);
    assert.ok(r.approvals.every((a) => a.signature_valid && a.link_valid));
});

test('changing who approved an earlier step breaks the chain', () => {
    const chain = buildChain(3);
    chain[0].approver_id = 99;
    const r = verifyChain(chain);
    assert.equal(r.chainValid, false);
    assert.equal(r.approvals[0].signature_valid, false);
    assert.equal(r.approvals[1].link_valid, false, 'the next approval no longer links to it');
});

test('deleting an approval from the middle breaks the chain', () => {
    const chain = buildChain(3);
    chain.splice(1, 1);
    assert.equal(verifyChain(chain).chainValid, false);
});

test('unsigned records such as rejections are listed but do not invalidate the chain', () => {
    const chain = buildChain(2);
    chain.splice(1, 0, { id: 99, status: 'Rejected', approver_id: 5, created_at: new Date(), approval_signature: null });
    const r = verifyChain(chain);
    assert.equal(r.chainValid, true);
    assert.equal(r.approvals[1].signed, false);
});

test('fileIntact compares against the stamped final file once a document is complete', () => {
    const chain = buildChain(1, 'a'.repeat(64));
    assert.equal(verifyChain(chain, { currentFileHash: 'b'.repeat(64), finalFileHash: 'b'.repeat(64) }).fileIntact, true);
    assert.equal(verifyChain(chain, { currentFileHash: 'c'.repeat(64), finalFileHash: 'b'.repeat(64) }).fileIntact, false);
    assert.equal(verifyChain(chain, { currentFileHash: 'c'.repeat(64) }).fileIntact, false);
});
