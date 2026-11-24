/**
 * Pure workflow-graph logic: no database, no email, no side effects.
 *
 * A workflow is a React Flow graph: { nodes: [{ id, type, data }], edges: [{ source, target, sourceHandle }] }.
 * Node types:
 *   task       a human approval step (stops the walk)
 *   condition  if/else on the document's tag, using the "true" / "false" output handles
 *   email      sends an email, then continues
 *   spawn      starts other workflows, then continues
 *   delay      pauses the document for data.delayHours, then continues
 *   parallel   fans out to every connected branch at once
 *   join       merge gate: waits until every parallel branch has reached it
 *
 * The routing engine (workflowEngine.js) uses these functions to decide where a
 * document goes next, then applies the side effects and saves the result.
 */

const MAX_STEPS = 500; // guards against malformed graphs that slipped past cycle detection

const parseFlow = (flowStructure) => {
    let flow = flowStructure;
    if (typeof flow === 'string') {
        try { flow = JSON.parse(flow); } catch (e) { flow = {}; }
    }
    flow = flow || {};
    return {
        nodes: Array.isArray(flow.nodes) ? flow.nodes : [],
        edges: Array.isArray(flow.edges) ? flow.edges : [],
        metadata: flow.metadata || {},
    };
};

const getNode = (flow, id) => flow.nodes.find((n) => n.id === id) || null;
const outgoingEdges = (flow, id) => flow.edges.filter((e) => e.source === id);
const incomingEdges = (flow, id) => flow.edges.filter((e) => e.target === id);

/** The entry point is the node nothing points to. */
const findStartNode = (flow) => {
    if (flow.nodes.length === 0) return null;
    return flow.nodes.find((n) => incomingEdges(flow, n.id).length === 0) || flow.nodes[0];
};

/** Condition nodes compare the document's tag with one or more comma-separated values (case-insensitive). */
const evaluateCondition = (node, documentTag) => {
    const tag = (documentTag || '').toLowerCase().trim();
    const values = String(node.data?.conditionValue || '')
        .split(',')
        .map((v) => v.toLowerCase().trim())
        .filter(Boolean);
    return tag !== '' && values.includes(tag);
};

/** True if the graph contains a cycle (a document could loop forever). */
const hasCycle = (flow) => {
    const adj = {};
    flow.nodes.forEach((n) => { adj[n.id] = []; });
    flow.edges.forEach((e) => { if (adj[e.source]) adj[e.source].push(e.target); });

    const WHITE = 0, GREY = 1, BLACK = 2;
    const color = {};
    const visit = (id) => {
        color[id] = GREY;
        for (const next of adj[id] || []) {
            if (color[next] === GREY) return true;
            if (!color[next] && visit(next)) return true;
        }
        color[id] = BLACK;
        return false;
    };
    return flow.nodes.some((n) => !color[n.id] && visit(n.id));
};

/**
 * Walk the graph starting by ENTERING `nodeId`, until the document reaches a
 * point where it has to wait. Returns an outcome:
 *
 *   { kind: 'task',     node, effects }               wait for an approver
 *   { kind: 'delay',    node, hours, effects }        wait for a timer
 *   { kind: 'parallel', node, branches, effects }     wait for several approvers at once
 *   { kind: 'join',     node, effects }               (only inside a parallel branch) branch finished
 *   { kind: 'end',      effects }                     workflow complete
 *
 * `effects` lists the email/spawn nodes passed on the way, in order, for the caller to execute.
 */
const enterNode = (flow, nodeId, context = {}, effects = [], steps = 0) => {
    if (steps > MAX_STEPS) throw new Error('Workflow graph is too deep or contains a loop.');
    const node = nodeId ? getNode(flow, nodeId) : null;
    if (!node) return { kind: 'end', effects };

    const next = (fromId) => {
        const out = outgoingEdges(flow, fromId);
        return out.length ? enterNode(flow, out[0].target, context, effects, steps + 1) : { kind: 'end', effects };
    };

    switch (node.type) {
        case 'condition': {
            const handle = evaluateCondition(node, context.tag) ? 'true' : 'false';
            const edge = outgoingEdges(flow, node.id).find((e) => e.sourceHandle === handle);
            // An unconnected output means "nothing more to do on this path"
            return edge ? enterNode(flow, edge.target, context, effects, steps + 1) : { kind: 'end', effects };
        }
        case 'email':
        case 'spawn':
            effects.push(node);
            return next(node.id);

        case 'delay': {
            const hours = parseFloat(node.data?.delayHours);
            // A zero delay is a no-op. Timers inside parallel branches aren't supported, so they pass through.
            if (!hours || hours <= 0 || context.inBranch) return next(node.id);
            return { kind: 'delay', node, hours, effects };
        }
        case 'join':
            if (context.inBranch) return { kind: 'join', node, effects };
            return next(node.id);

        case 'parallel': {
            if (context.inBranch) throw new Error('Nested parallel splits are not supported.');
            const branches = outgoingEdges(flow, node.id).map((edge) =>
                enterNode(flow, edge.target, { ...context, inBranch: true }, [], steps + 1)
            );
            // Side effects inside branches run now, with the split
            branches.forEach((b) => effects.push(...b.effects));
            return { kind: 'parallel', node, branches, effects };
        }
        case 'task':
        default:
            return { kind: 'task', node, effects };
    }
};

/** Walk onward from a node the document is LEAVING (a task that was just approved, a finished delay, a join). */
const leaveNode = (flow, nodeId, context = {}) => {
    const out = outgoingEdges(flow, nodeId);
    if (out.length === 0) return { kind: 'end', effects: [] };
    return enterNode(flow, out[0].target, context, []);
};

/**
 * Check a workflow before publishing. Returns a list of human-readable problems
 * (empty when the workflow is valid).
 */
const validateFlow = (flow) => {
    const problems = [];
    const { nodes, edges } = flow;
    if (nodes.length === 0) return ['The workflow has no steps.'];

    if (hasCycle(flow)) problems.push('The workflow contains a loop, so a document could circulate forever.');

    const ids = new Set(nodes.map((n) => n.id));
    edges.forEach((e) => {
        if (!ids.has(e.source) || !ids.has(e.target)) problems.push('A connection points to a step that no longer exists.');
    });

    const starts = nodes.filter((n) => incomingEdges(flow, n.id).length === 0);
    if (starts.length > 1) {
        problems.push(`The workflow has ${starts.length} starting points. Connect everything into a single flow.`);
    }

    nodes.forEach((n) => {
        const label = n.data?.label || n.type;
        const out = outgoingEdges(flow, n.id);
        if (n.type === 'task') {
            const strategy = n.data?.assignmentStrategy;
            const missing = strategy === 'office' ? !n.data?.officeId
                : strategy === 'role_based' ? !n.data?.roleId
                : !n.data?.assignee;
            if (missing) {
                problems.push(strategy === 'office' ? `"${label}" has no office selected.` : `"${label}" has no approver assigned.`);
            }
        }
        if (n.type === 'condition' && !String(n.data?.conditionValue || '').trim()) {
            problems.push(`Condition "${label}" has no tag to compare against.`);
        }
        if (n.type === 'parallel' && out.length < 2) {
            problems.push(`Parallel split "${label}" needs at least two outgoing branches.`);
        }
        if (n.type === 'email' && !String(n.data?.recipient || '').trim()) {
            problems.push(`Email step "${label}" has no recipient.`);
        }
        if (n.type === 'spawn' && !String(n.data?.spawnIds || '').trim()) {
            problems.push(`Spawn step "${label}" has no workflows selected.`);
        }
    });

    // Parallel splits can't be nested
    nodes.filter((n) => n.type === 'parallel').forEach((p) => {
        try {
            enterNode(flow, p.id, {});
        } catch (e) {
            problems.push(e.message);
        }
    });

    return [...new Set(problems)];
};

module.exports = {
    parseFlow,
    getNode,
    outgoingEdges,
    findStartNode,
    evaluateCondition,
    hasCycle,
    enterNode,
    leaveNode,
    validateFlow,
};
