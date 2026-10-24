// The trade gate: a short tree of questions asked before a trade. Each answer leads to
// another question or to a decision: GO, NO GO or WAIT, with a note for that branch.
// Pure: no Obsidian, so the checks and the runs are tested.

export type Outcome = "go" | "nogo" | "wait";

export const OUTCOMES: Outcome[] = ["go", "wait", "nogo"];

/** Where an answer leads: a question, a decision, or nowhere yet (an unfinished tree). */
export type Route = { node: string } | { outcome: Outcome; note?: string } | null;

export interface GateOption {
	label: string;
	to: Route;
}

export interface GateNode {
	id: string;
	question: string;
	options: GateOption[];
}

export interface Gate {
	id: string;
	name: string;
	/** Id of the first question. */
	start: string;
	nodes: GateNode[];
}

export type GateIssueKind =
	| "no-start"
	| "empty-question"
	| "few-options"
	| "empty-option"
	| "duplicate-option"
	| "unwired"
	| "dangling"
	| "unreachable"
	| "loop"
	| "no-outcome";

export interface GateIssue {
	kind: GateIssueKind;
	node?: string;
	option?: number;
	/** The questions of a loop, in order. */
	loop?: string[];
}

export const isOutcome = (r: Route): r is { outcome: Outcome; note?: string } => !!r && "outcome" in r;
export const isNode = (r: Route): r is { node: string } => !!r && "node" in r;

const nodeMap = (g: Gate): Map<string, GateNode> => new Map(g.nodes.map((n) => [n.id, n]));

/** The questions reachable from the first one. */
export function reachable(g: Gate): Set<string> {
	const nodes = nodeMap(g);
	const seen = new Set<string>();
	const stack = nodes.has(g.start) ? [g.start] : [];
	while (stack.length) {
		const id = stack.pop() as string;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const o of nodes.get(id)?.options ?? []) if (isNode(o.to) && nodes.has(o.to.node)) stack.push(o.to.node);
	}
	return seen;
}

/** Every loop: answers that lead back to a question already asked on the way. Each loop is listed once. */
export function findLoops(g: Gate): string[][] {
	const nodes = nodeMap(g);
	const loops: string[][] = [];
	const keys = new Set<string>();
	const state = new Map<string, 1 | 2>();
	const path: string[] = [];
	const visit = (id: string): void => {
		state.set(id, 1);
		path.push(id);
		for (const o of nodes.get(id)?.options ?? []) {
			if (!isNode(o.to) || !nodes.has(o.to.node)) continue;
			const next = o.to.node;
			if (state.get(next) === 1) {
				const loop = path.slice(path.indexOf(next));
				// The same loop entered at another question is the same loop.
				const key = [...loop].sort().join(">");
				if (!keys.has(key)) {
					keys.add(key);
					loops.push(loop);
				}
			} else if (!state.has(next)) visit(next);
		}
		path.pop();
		state.set(id, 2);
	};
	if (nodes.has(g.start)) visit(g.start);
	for (const n of g.nodes) if (!state.has(n.id)) visit(n.id);
	return loops;
}

/** True when some path from the first question ends with a decision. */
export function reachesOutcome(g: Gate): boolean {
	const nodes = nodeMap(g);
	for (const id of reachable(g)) if (nodes.get(id)?.options.some((o) => isOutcome(o.to))) return true;
	return false;
}

/** A gate can be run once its first question leads to at least one decision. */
export function isRunnable(g: Gate): boolean {
	return nodeMap(g).has(g.start) && reachesOutcome(g);
}

/** Everything that would stop a trader in the middle of a run, or that looks unfinished. */
export function validateGate(g: Gate): GateIssue[] {
	const issues: GateIssue[] = [];
	const nodes = nodeMap(g);
	if (!nodes.has(g.start)) issues.push({ kind: "no-start" });
	for (const n of g.nodes) {
		if (!n.question.trim()) issues.push({ kind: "empty-question", node: n.id });
		if (n.options.length < 2) issues.push({ kind: "few-options", node: n.id });
		const labels = new Set<string>();
		n.options.forEach((o, i) => {
			const label = o.label.trim().toLowerCase();
			if (!label) issues.push({ kind: "empty-option", node: n.id, option: i });
			else if (labels.has(label)) issues.push({ kind: "duplicate-option", node: n.id, option: i });
			labels.add(label);
			if (o.to === null) issues.push({ kind: "unwired", node: n.id, option: i });
			else if (isNode(o.to) && !nodes.has(o.to.node)) issues.push({ kind: "dangling", node: n.id, option: i });
		});
	}
	const seen = reachable(g);
	for (const n of g.nodes) if (nodes.has(g.start) && !seen.has(n.id)) issues.push({ kind: "unreachable", node: n.id });
	for (const loop of findLoops(g)) issues.push({ kind: "loop", node: loop[0], loop });
	if (nodes.has(g.start) && !reachesOutcome(g)) issues.push({ kind: "no-outcome" });
	return issues;
}

export interface GateStep {
	node: string;
	option: number;
}

export type GateState =
	| { kind: "question"; node: GateNode; steps: GateStep[] }
	| { kind: "outcome"; outcome: Outcome; note: string; steps: GateStep[] }
	/** The answer given leads nowhere: the tree is unfinished there. */
	| { kind: "stuck"; node: GateNode; option: number; steps: GateStep[] }
	| { kind: "invalid" };

/**
 * Where a run stands after the answers given, replayed from the first question. Answers
 * that no longer fit the tree (it was edited) are dropped from there on.
 */
export function runGate(g: Gate, answers: GateStep[]): GateState {
	const nodes = nodeMap(g);
	const first = nodes.get(g.start);
	if (!first) return { kind: "invalid" };
	let node: GateNode = first;
	const steps: GateStep[] = [];
	// Bounded by the answers given: a loop in the tree asks again, it never runs by itself.
	for (const a of answers) {
		if (a.node !== node.id || !node.options[a.option]) break;
		steps.push(a);
		const to: Route = node.options[a.option].to;
		if (isOutcome(to)) return { kind: "outcome", outcome: to.outcome, note: to.note ?? "", steps };
		const next: GateNode | undefined = isNode(to) ? nodes.get(to.node) : undefined;
		if (!next) return { kind: "stuck", node, option: a.option, steps };
		node = next;
	}
	return { kind: "question", node, steps };
}

/** The answer chosen at each step, as "Question: answer". */
export function pathLabels(g: Gate, steps: GateStep[]): string[] {
	const nodes = nodeMap(g);
	return steps.map((s) => {
		const n = nodes.get(s.node);
		return n ? `${n.question.trim()} ${n.options[s.option]?.label ?? "?"}` : "?";
	});
}

export interface OutlineLine {
	depth: number;
	kind: "question" | "answer" | "outcome" | "unwired" | "repeat" | "dangling";
	text: string;
	node?: string;
	outcome?: Outcome;
}

/**
 * The tree written out from the first question, answer under question. A question
 * already written above is not written again ("repeat"), so a loop stays finite.
 */
export function outline(g: Gate): OutlineLine[] {
	const nodes = nodeMap(g);
	const out: OutlineLine[] = [];
	const done = new Set<string>();
	const walk = (id: string, depth: number): void => {
		const n = nodes.get(id);
		if (!n) return;
		done.add(id);
		out.push({ depth, kind: "question", text: n.question, node: id });
		for (const o of n.options) {
			out.push({ depth: depth + 1, kind: "answer", text: o.label, node: id });
			if (o.to === null) out.push({ depth: depth + 2, kind: "unwired", text: "", node: id });
			else if (isOutcome(o.to)) out.push({ depth: depth + 2, kind: "outcome", text: o.to.note ?? "", outcome: o.to.outcome });
			else if (!nodes.has(o.to.node)) out.push({ depth: depth + 2, kind: "dangling", text: o.to.node });
			else if (done.has(o.to.node)) out.push({ depth: depth + 2, kind: "repeat", text: nodes.get(o.to.node)?.question ?? "", node: o.to.node });
			else walk(o.to.node, depth + 2);
		}
	};
	walk(g.start, 0);
	return out;
}

/** A question id not used yet in the gate. */
export function newNodeId(g: Gate): string {
	let n = g.nodes.length + 1;
	while (g.nodes.some((x) => x.id === `q${n}`)) n++;
	return `q${n}`;
}

/** The gate without a question; answers that led to it lead nowhere until they are routed again. */
export function removeNode(g: Gate, id: string): Gate {
	const nodes = g.nodes
		.filter((n) => n.id !== id)
		.map((n) => ({ ...n, options: n.options.map((o) => (isNode(o.to) && o.to.node === id ? { ...o, to: null } : o)) }));
	return { ...g, nodes, start: g.start === id ? (nodes[0]?.id ?? "") : g.start };
}

/** A deep copy, so a window edits a draft and the saved gate changes only on Save. */
export function cloneGate(g: Gate): Gate {
	return {
		...g,
		nodes: g.nodes.map((n) => ({ ...n, options: n.options.map((o) => ({ label: o.label, to: o.to === null ? null : { ...o.to } })) })),
	};
}

/** Counts of each decision among the gate runs of a session. */
export function outcomeCounts(outcomes: (Outcome | undefined)[]): Record<Outcome, number> {
	const c: Record<Outcome, number> = { go: 0, nogo: 0, wait: 0 };
	for (const o of outcomes) if (o) c[o]++;
	return c;
}
