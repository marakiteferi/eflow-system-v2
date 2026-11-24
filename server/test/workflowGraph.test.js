const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/services/workflowGraph');

// Small helpers to build graphs
const task = (id, assignee = '1') => ({ id, type: 'task', data: { label: id, assignee } });
const node = (id, type, data = {}) => ({ id, type, data: { label: id, ...data } });
const edge = (source, target, sourceHandle) => ({ source, target, ...(sourceHandle ? { sourceHandle } : {}) });
const flow = (nodes, edges, metadata = {}) => g.parseFlow({ nodes, edges, metadata });

test('parseFlow accepts JSON strings and tolerates bad input', () => {
    assert.deepEqual(g.parseFlow('{"nodes":[{"id":"a"}],"edges":[]}').nodes, [{ id: 'a' }]);
    assert.deepEqual(g.parseFlow('not json'), { nodes: [], edges: [], metadata: {} });
    assert.deepEqual(g.parseFlow(null), { nodes: [], edges: [], metadata: {} });
});

test('findStartNode picks the node with no incoming edges', () => {
    const f = flow([task('b'), task('a')], [edge('a', 'b')]);
    assert.equal(g.findStartNode(f).id, 'a');
    assert.equal(g.findStartNode(flow([], [])), null);
});

test('linear flow: entering a task stops there, leaving the last task ends the workflow', () => {
    const f = flow([task('a'), task('b')], [edge('a', 'b')]);
    assert.equal(g.enterNode(f, 'a').node.id, 'a');
    assert.equal(g.leaveNode(f, 'a').node.id, 'b');
    assert.equal(g.leaveNode(f, 'b').kind, 'end');
});

test('condition routes on the document tag (case-insensitive, comma-separated values)', () => {
    const f = flow(
        [node('c', 'condition', { conditionValue: 'Finance, Admin' }), task('yes'), task('no')],
        [edge('c', 'yes', 'true'), edge('c', 'no', 'false')]
    );
    assert.equal(g.enterNode(f, 'c', { tag: 'finance' }).node.id, 'yes');
    assert.equal(g.enterNode(f, 'c', { tag: ' ADMIN ' }).node.id, 'yes');
    assert.equal(g.enterNode(f, 'c', { tag: 'library' }).node.id, 'no');
    assert.equal(g.enterNode(f, 'c', {}).node.id, 'no', 'an untagged document takes the FALSE path');
});

test('condition with an unconnected output ends the workflow on that path', () => {
    const f = flow([node('c', 'condition', { conditionValue: 'x' }), task('yes')], [edge('c', 'yes', 'true')]);
    assert.equal(g.enterNode(f, 'c', { tag: 'y' }).kind, 'end');
});

test('email and spawn steps are collected as side effects and the walk continues', () => {
    const f = flow(
        [node('e', 'email', { recipient: 'a@b.c' }), node('s', 'spawn', { spawnIds: '2' }), task('t')],
        [edge('e', 's'), edge('s', 't')]
    );
    const out = g.enterNode(f, 'e');
    assert.equal(out.kind, 'task');
    assert.deepEqual(out.effects.map((n) => n.id), ['e', 's']);
});

test('delay pauses with its duration; a zero delay is skipped', () => {
    const f = flow([node('d', 'delay', { delayHours: '24' }), task('t')], [edge('d', 't')]);
    const out = g.enterNode(f, 'd');
    assert.equal(out.kind, 'delay');
    assert.equal(out.hours, 24);
    assert.equal(g.leaveNode(f, 'd').node.id, 't');

    const zero = flow([node('d', 'delay', { delayHours: '0' }), task('t')], [edge('d', 't')]);
    assert.equal(g.enterNode(zero, 'd').node.id, 't');
});

test('parallel fans out to every branch and each branch stops at its merge gate', () => {
    const f = flow(
        [node('p', 'parallel'), task('a'), task('b'), node('j', 'join'), task('final')],
        [edge('p', 'a'), edge('p', 'b'), edge('a', 'j'), edge('b', 'j'), edge('j', 'final')]
    );
    const out = g.enterNode(f, 'p');
    assert.equal(out.kind, 'parallel');
    assert.deepEqual(out.branches.map((b) => b.node.id), ['a', 'b']);
    // Inside a branch, leaving a task reaches the join and stops
    const branchDone = g.leaveNode(f, 'a', { inBranch: true });
    assert.equal(branchDone.kind, 'join');
    assert.equal(branchDone.node.id, 'j');
    // Outside a branch, the join is transparent
    assert.equal(g.leaveNode(f, 'j').node.id, 'final');
});

test('a branch may have several steps before the merge gate', () => {
    const f = flow(
        [node('p', 'parallel'), task('a1'), task('a2'), task('b'), node('j', 'join')],
        [edge('p', 'a1'), edge('a1', 'a2'), edge('a2', 'j'), edge('p', 'b'), edge('b', 'j')]
    );
    assert.equal(g.leaveNode(f, 'a1', { inBranch: true }).node.id, 'a2');
    assert.equal(g.leaveNode(f, 'a2', { inBranch: true }).kind, 'join');
});

test('nested parallel splits are rejected', () => {
    const f = flow([node('p1', 'parallel'), node('p2', 'parallel'), task('a')], [edge('p1', 'p2'), edge('p2', 'a')]);
    assert.throws(() => g.enterNode(f, 'p1'), /Nested parallel/);
});

test('hasCycle detects loops, including self-loops', () => {
    assert.equal(g.hasCycle(flow([task('a'), task('b')], [edge('a', 'b')])), false);
    assert.equal(g.hasCycle(flow([task('a'), task('b')], [edge('a', 'b'), edge('b', 'a')])), true);
    assert.equal(g.hasCycle(flow([task('a')], [edge('a', 'a')])), true);
});

test('validateFlow accepts a well-formed workflow', () => {
    const f = flow(
        [task('a'), node('c', 'condition', { conditionValue: 'x' }), task('b'), node('e', 'email', { recipient: '{{submitter_email}}' })],
        [edge('a', 'c'), edge('c', 'b', 'true'), edge('c', 'e', 'false')]
    );
    assert.deepEqual(g.validateFlow(f), []);
});

test('validateFlow reports the problems a designer needs to fix', () => {
    const problems = g.validateFlow(flow(
        [
            { id: 'a', type: 'task', data: { label: 'No approver' } },
            node('c', 'condition', {}),
            node('p', 'parallel'),
            task('lonely'),
            node('e', 'email', {}),
        ],
        [edge('a', 'c'), edge('c', 'p', 'true'), edge('p', 'e'), edge('e', 'a')]
    ));
    const text = problems.join('\n');
    assert.match(text, /loop/);
    assert.match(text, /"No approver" has no approver/);
    assert.match(text, /no tag to compare/);
    assert.match(text, /at least two outgoing branches/);
    assert.match(text, /has no recipient/);
    assert.deepEqual(g.validateFlow(flow([], [])), ['The workflow has no steps.']);
});

test('validateFlow flags disconnected steps as extra starting points', () => {
    const problems = g.validateFlow(flow([task('a'), task('b'), task('orphan')], [edge('a', 'b')]));
    assert.match(problems.join('\n'), /2 starting points/);
});
