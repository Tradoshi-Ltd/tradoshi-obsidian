import { colon } from "../format";
import { Modal, Notice, type App } from "obsidian";
import {
	cloneGate,
	isNode,
	isOutcome,
	isRunnable,
	newNodeId,
	outline,
	OUTCOMES,
	removeNode,
	runGate,
	validateGate,
	type Gate,
	type GateIssue,
	type GateStep,
	type Outcome,
	type Route,
} from "./gate";
import { st } from "./text";

// The trade gate on screen: a run, one question at a time, used live in a session and
// as a simulation in the editor; and the editor itself, where each answer is routed
// to the next question or to a decision.

export function outcomeLabel(o: Outcome): string {
	return o === "go" ? st("go") : o === "nogo" ? st("nogo") : st("wait");
}

/**
 * Draws a run of the gate from the answers given so far. `answer` receives the new
 * list of answers; `restart` starts again from the first question.
 */
export function drawGateRun(parent: HTMLElement, gate: Gate, steps: GateStep[], answer: (steps: GateStep[]) => void, restart: () => void): void {
	const box = parent.createDiv({ cls: "tradoshi-gate-run" });
	const state = runGate(gate, steps);
	if (state.kind === "invalid") {
		box.createDiv({ cls: "tradoshi-muted", text: st("gateNoStart") });
		return;
	}
	const nodes = new Map(gate.nodes.map((n) => [n.id, n]));
	for (const s of state.steps) {
		const n = nodes.get(s.node);
		if (!n) continue;
		const done = box.createDiv({ cls: "tradoshi-gate-done" });
		done.createSpan({ cls: "tradoshi-muted", text: n.question });
		done.createSpan({ cls: "tradoshi-gate-answer", text: `✓ ${n.options[s.option]?.label ?? ""}` });
	}
	if (state.kind === "question") {
		const q = box.createDiv({ cls: "tradoshi-gate-q" });
		q.createDiv({ cls: "tradoshi-gate-question", text: state.node.question });
		const opts = q.createDiv({ cls: "tradoshi-gate-options" });
		state.node.options.forEach((o, i) => {
			opts.createEl("button", { text: o.label || "?" }).addEventListener("click", () => answer([...state.steps, { node: state.node.id, option: i }]));
		});
	} else if (state.kind === "outcome") {
		const out = box.createDiv({ cls: `tradoshi-gate-outcome is-${state.outcome}` });
		out.createDiv({ cls: "tradoshi-gate-decision", text: outcomeLabel(state.outcome) });
		if (state.note) out.createDiv({ text: state.note });
	} else {
		box.createDiv({ cls: "tradoshi-gate-stuck", text: st("gateStuck") });
	}
	if (state.steps.length) {
		const actions = box.createDiv({ cls: "tradoshi-gate-actions" });
		if (state.kind === "question") actions.createEl("button", { text: `‹ ${st("back")}` }).addEventListener("click", () => answer(state.steps.slice(0, -1)));
		actions.createEl("button", { text: st("restart") }).addEventListener("click", restart);
	}
}

function issueText(i: GateIssue, gate: Gate): string {
	const n = gate.nodes.find((x) => x.id === i.node);
	const q = n ? `« ${n.question || n.id} »` : "";
	const o = n && i.option !== undefined ? `« ${n.options[i.option]?.label || "?"} »` : "";
	switch (i.kind) {
		case "no-start":
			return st("issueNoStart");
		case "empty-question":
			return st("issueEmptyQuestion", { q });
		case "few-options":
			return st("issueFewOptions", { q });
		case "empty-option":
			return st("issueEmptyOption", { q });
		case "duplicate-option":
			return st("issueDuplicateOption", { q, o });
		case "unwired":
			return st("issueUnwired", { q, o });
		case "dangling":
			return st("issueDangling", { q, o });
		case "unreachable":
			return st("issueUnreachable", { q });
		case "loop":
			return st("issueLoop", { q: (i.loop ?? []).map((id) => `« ${gate.nodes.find((x) => x.id === id)?.question || id} »`).join(" → ") });
		case "no-outcome":
			return st("issueNoOutcome");
	}
}

const NEW = "__new__";

/** The editor of one gate. Changes stay in a draft until Save. */
export class GateEditorModal extends Modal {
	private draft: Gate;
	private simulate = false;
	private simSteps: GateStep[] = [];
	private outlineOpen = false;
	private checkEl: HTMLElement | null = null;
	private outlineEl: HTMLElement | null = null;

	constructor(
		app: App,
		gate: Gate,
		private readonly onSave: (gate: Gate) => void,
	) {
		super(app);
		this.draft = cloneGate(gate);
	}

	onOpen(): void {
		this.modalEl.addClass("tradoshi-gmodal");
		this.setTitle(st("gateEditor"));
		this.draw();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private draw(): void {
		const el = this.contentEl;
		const scroll = el.querySelector(".tradoshi-gate-nodes")?.scrollTop ?? 0;
		el.empty();
		const g = this.draft;
		el.createEl("p", { cls: "tradoshi-muted", text: st("gateHint") });

		const head = el.createDiv({ cls: "tradoshi-gate-head" });
		const name = head.createEl("input", { attr: { type: "text", placeholder: st("gateName"), "aria-label": st("gateName") } });
		name.value = g.name;
		name.addEventListener("change", () => (g.name = name.value.trim()));
		const start = head.createEl("select", { cls: "dropdown", attr: { "aria-label": st("firstQuestion") } });
		for (const n of g.nodes) start.createEl("option", { value: n.id, text: `${st("firstQuestion")}${colon()}${short(n.question || n.id)}` });
		start.value = g.start;
		start.addEventListener("change", () => {
			g.start = start.value;
			this.simSteps = [];
			this.draw();
		});
		const sim = head.createEl("button", { text: this.simulate ? st("stopSimulation") : `▶ ${st("simulate")}` });
		sim.disabled = !isRunnable(g);
		sim.setAttr("aria-label", isRunnable(g) ? st("simulate") : st("simulateDisabled"));
		sim.addEventListener("click", () => {
			this.simulate = !this.simulate;
			this.simSteps = [];
			this.draw();
		});

		if (this.simulate) {
			const box = el.createDiv({ cls: "tradoshi-gate-sim" });
			box.createDiv({ cls: "tradoshi-rv-sub", text: st("simulation") });
			drawGateRun(
				box,
				g,
				this.simSteps,
				(steps) => {
					this.simSteps = steps;
					this.draw();
				},
				() => {
					this.simSteps = [];
					this.draw();
				},
			);
		}

		this.checkEl = el.createDiv({ cls: "tradoshi-gate-check" });
		// The tree written out, to follow every path at a glance.
		const map = el.createEl("details", { cls: "tradoshi-gate-outline" });
		map.open = this.outlineOpen;
		map.addEventListener("toggle", () => (this.outlineOpen = map.open));
		map.createEl("summary", { text: st("outline") });
		this.outlineEl = map.createDiv();
		this.refreshDerived();

		const list = el.createDiv({ cls: "tradoshi-gate-nodes" });
		for (const n of g.nodes) this.drawNode(list, n.id);
		list.scrollTop = scroll;

		const foot = el.createDiv({ cls: "tradoshi-tq-foot" });
		foot.createEl("button", { text: `+ ${st("addGateQuestion")}` }).addEventListener("click", () => {
			const id = newNodeId(g);
			g.nodes.push({ id, question: "", options: [{ label: st("yes"), to: null }, { label: st("no"), to: null }] });
			if (!g.start) g.start = id;
			this.draw();
		});
		foot.createEl("button", { text: st("cancel") }).addEventListener("click", () => this.close());
		foot.createEl("button", { cls: "mod-cta", text: st("save") }).addEventListener("click", () => {
			if (!g.name.trim()) g.name = st("gateDefaultName");
			this.onSave(cloneGate(g));
			if (validateGate(g).length) new Notice(st("savedWithIssues"));
			this.close();
		});
	}

	/**
	 * What follows from the texts, updated in place: the checks, the outline and the names
	 * of the questions in the menus. A text edit never redraws the editor, so the field the
	 * trader moves to keeps its focus.
	 */
	private refreshDerived(): void {
		const g = this.draft;
		const check = this.checkEl;
		if (check) {
			check.empty();
			const issues = validateGate(g);
			check.toggleClass("has-issue", issues.length > 0);
			if (!issues.length) check.setText(`✓ ${st("gateOk")}`);
			for (const i of issues) check.createDiv({ text: `⚠ ${issueText(i, g)}` });
		}
		const map = this.outlineEl;
		if (map) {
			map.empty();
			for (const line of outline(g)) {
				const row = map.createDiv({ cls: ["tradoshi-gate-line", `is-${line.kind}`, ...(line.outcome ? [`is-${line.outcome}`] : [])] });
				row.setCssProps({ "--depth": String(line.depth) });
				const text =
					line.kind === "outcome"
						? `→ ${outcomeLabel(line.outcome ?? "wait")}${line.text ? ` : ${line.text}` : ""}`
						: line.kind === "unwired"
							? `→ ${st("leadsNowhere")}`
							: line.kind === "repeat"
								? `↺ ${short(line.text)}`
								: line.kind === "dangling"
									? "→ ?"
									: line.kind === "answer"
										? line.text || "?"
										: line.text;
				row.setText(text);
			}
		}
		for (const n of g.nodes) {
			this.contentEl.querySelectorAll<HTMLOptionElement>(`option[value="node:${n.id}"]`).forEach((o) => o.setText(short(n.question || n.id)));
			this.contentEl.querySelectorAll<HTMLOptionElement>(`option[value="${n.id}"]`).forEach((o) => o.setText(`${st("firstQuestion")}${colon()}${short(n.question || n.id)}`));
		}
	}

	private drawNode(list: HTMLElement, id: string): void {
		const g = this.draft;
		const n = g.nodes.find((x) => x.id === id);
		if (!n) return;
		const card = list.createDiv({ cls: `tradoshi-gate-node${g.start === id ? " is-start" : ""}` });
		const top = card.createDiv({ cls: "tradoshi-tq-row" });
		if (g.start === id) top.createSpan({ cls: "tradoshi-badge is-reviewed", text: st("start") });
		const q = top.createEl("input", { cls: "tradoshi-tq-text", attr: { type: "text", placeholder: st("gateQuestion"), "aria-label": st("gateQuestion") } });
		q.value = n.question;
		q.addEventListener("change", () => {
			n.question = q.value.trim();
			this.refreshDerived();
		});
		n.options.forEach((o, i) => {
			const row = card.createDiv({ cls: "tradoshi-gate-option" });
			const label = row.createEl("input", { attr: { type: "text", placeholder: st("answer"), "aria-label": st("answer") } });
			label.value = o.label;
			label.addEventListener("change", () => {
				o.label = label.value.trim();
				this.refreshDerived();
			});
			row.createSpan({ cls: "tradoshi-muted", text: "→" });
			const to = row.createEl("select", { cls: `dropdown${o.to === null ? " is-unwired" : ""}`, attr: { "aria-label": st("leadsTo") } });
			to.createEl("option", { value: "", text: st("leadsNowhere") });
			for (const out of OUTCOMES) to.createEl("option", { value: `outcome:${out}`, text: outcomeLabel(out) });
			for (const other of g.nodes) if (other.id !== n.id) to.createEl("option", { value: `node:${other.id}`, text: short(other.question || other.id) });
			to.createEl("option", { value: NEW, text: `+ ${st("newQuestion")}` });
			to.value = routeValue(o.to);
			to.addEventListener("change", () => {
				if (to.value === NEW) {
					const id2 = newNodeId(g);
					g.nodes.push({ id: id2, question: "", options: [{ label: st("yes"), to: null }, { label: st("no"), to: null }] });
					o.to = { node: id2 };
				} else o.to = parseRoute(to.value, o.to);
				this.simSteps = [];
				this.draw();
			});
			if (isOutcome(o.to)) {
				const note = row.createEl("input", { cls: "tradoshi-gate-note", attr: { type: "text", placeholder: st("outcomeNote"), "aria-label": st("outcomeNote") } });
				note.value = o.to.note ?? "";
				note.addEventListener("change", () => {
					if (isOutcome(o.to)) o.to = { outcome: o.to.outcome, note: note.value.trim() || undefined };
					this.refreshDerived();
				});
			}
			const rm = row.createEl("button", { cls: "clickable-icon", text: "✕", attr: { "aria-label": st("removeAnswer") } });
			rm.disabled = n.options.length <= 1;
			rm.addEventListener("click", () => {
				n.options.splice(i, 1);
				this.simSteps = [];
				this.draw();
			});
		});
		const actions = card.createDiv({ cls: "tradoshi-tq-row tradoshi-tq-meta" });
		actions.createEl("button", { text: `+ ${st("addAnswer")}` }).addEventListener("click", () => {
			n.options.push({ label: "", to: null });
			this.draw();
		});
		if (g.start !== id)
			actions.createEl("button", { text: st("makeStart") }).addEventListener("click", () => {
				g.start = id;
				this.simSteps = [];
				this.draw();
			});
		actions.createEl("button", { text: st("removeQuestion") }).addEventListener("click", () => {
			this.draft = removeNode(g, id);
			this.simSteps = [];
			this.draw();
		});
	}
}

const short = (s: string): string => (s.length > 48 ? `${s.slice(0, 46)}…` : s);

function routeValue(r: Route): string {
	if (isOutcome(r)) return `outcome:${r.outcome}`;
	if (isNode(r)) return `node:${r.node}`;
	return "";
}

function parseRoute(v: string, before: Route): Route {
	if (v.startsWith("outcome:")) {
		const outcome = v.slice(8) as Outcome;
		// The note written for this branch stays when only the decision changes.
		return { outcome, note: isOutcome(before) ? before.note : undefined };
	}
	if (v.startsWith("node:")) return { node: v.slice(5) };
	return null;
}
