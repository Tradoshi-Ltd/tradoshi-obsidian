// Review questions: the plan before the session, the review after it, the quick review
// of a trade (winner, loser, break-even), and the reviews of a week, a month, a quarter
// and a year. Each answer goes to a property of the note, `review_<id>`, which the sync
// never touches. Pure: no Obsidian, so the rules are tested.

export type QuestionKind = "text" | "yesno" | "scale" | "choice";

export interface Question {
	/** The answer is kept in the property `review_<id>`. Never changes once answers exist. */
	id: string;
	text: string;
	kind: QuestionKind;
	/** The choices of a "choice" question. */
	options?: string[];
	/** Shown in an empty text answer. */
	hint?: string;
	/** Asked only when an earlier question got this answer ("yes" or "no" for a yes / no question). */
	showWhen?: { id: string; value: string };
	/** The answer comes back in the next review: tomorrow's focus, next week's goal. */
	carry?: boolean;
}

export type TemplateId = "pre" | "post" | "win" | "loss" | "even" | "week" | "month" | "quarter" | "year";

export const TEMPLATE_IDS: TemplateId[] = ["pre", "post", "win", "loss", "even", "week", "month", "quarter", "year"];

/** Highest grade of a "scale" question: answers go from 1 to 5. */
export const SCALE_MAX = 5;

/**
 * Suffixes the plugin itself uses: the reviewed state, the links between reviews,
 * the trader's tags. A question cannot take them.
 */
export const RESERVED_IDS = new Set([
	"done",
	"date",
	"tags",
	"day",
	"week",
	"month",
	"quarter",
	"year",
	"days",
	"weeks",
	"months",
	"quarters",
	"previous",
	"next",
	"sessions",
]);

const ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const propertyOf = (id: string): string => `review_${id}`;

/** A property suffix made from the question: lower case, no accent, underscores, unique. */
export function slugId(text: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	let base = text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 32)
		.replace(/_+$/, "");
	if (!/^[a-z]/.test(base)) base = `q_${base}`.replace(/_+$/, "");
	if (RESERVED_IDS.has(base)) base = `${base}_answer`;
	let id = base;
	for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
	return id;
}

/** An answer as the conditions compare it: "yes" or "no" for a yes / no, the text of a choice. */
export function answerKey(value: unknown): string | null {
	if (value === true) return "yes";
	if (value === false) return "no";
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "string" && value.trim()) return value.trim();
	return null;
}

/** The value of an answer read back from a property, in the type of its question; null when unanswered. */
export function coerceAnswer(q: Question, raw: unknown): string | number | boolean | null {
	switch (q.kind) {
		case "yesno":
			if (raw === true || raw === false) return raw;
			if (typeof raw === "string") {
				const s = raw.trim().toLowerCase();
				if (["yes", "true", "oui", "sí", "si", "sim"].includes(s)) return true;
				if (["no", "false", "non", "não", "nao"].includes(s)) return false;
			}
			return null;
		case "scale": {
			const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
			return Number.isFinite(n) && n >= 1 && n <= SCALE_MAX ? Math.round(n) : null;
		}
		default:
			if (typeof raw === "string" && raw.trim()) return raw;
			if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
			if (Array.isArray(raw) && raw.length) return raw.map(String).join(", ");
			return null;
	}
}

/** The answers held by a note's properties, by question id. */
export function answersOf(fm: Record<string, unknown> | undefined, questions: Question[]): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	for (const q of questions) {
		const v = coerceAnswer(q, fm?.[propertyOf(q.id)]);
		if (v !== null) out[q.id] = v;
	}
	return out;
}

/**
 * The questions to ask, given the answers so far: a question with a condition is
 * asked only when its parent is asked and got the expected answer.
 */
export function visibleQuestions(questions: Question[], answers: Record<string, unknown>): Question[] {
	const byId = new Map(questions.map((q) => [q.id, q]));
	const memo = new Map<string, boolean>();
	const visible = (q: Question, depth: number): boolean => {
		const known = memo.get(q.id);
		if (known !== undefined) return known;
		let v = true;
		if (q.showWhen) {
			const parent = byId.get(q.showWhen.id);
			// A broken condition (missing parent, loop) never hides the question: nothing is lost.
			if (parent && parent !== q && depth < questions.length) v = visible(parent, depth + 1) && answerKey(answers[parent.id]) === q.showWhen.value;
		}
		memo.set(q.id, v);
		return v;
	};
	return questions.filter((q) => visible(q, 0));
}

export function isAnswered(value: unknown): boolean {
	return answerKey(value) !== null;
}

/** Answered questions over asked ones. */
export function progress(questions: Question[], answers: Record<string, unknown>): { answered: number; total: number } {
	const asked = visibleQuestions(questions, answers);
	return { answered: asked.filter((q) => isAnswered(answers[q.id])).length, total: asked.length };
}

/** The values a condition can expect from a question: yes and no, or its choices. */
export function conditionValues(q: Question): string[] {
	if (q.kind === "yesno") return ["yes", "no"];
	if (q.kind === "choice") return (q.options ?? []).filter((o) => o.trim());
	return [];
}

export type TemplateIssueKind =
	| "id-invalid"
	| "id-reserved"
	| "id-duplicate"
	| "text-missing"
	| "options-missing"
	| "option-duplicate"
	| "parent-missing"
	| "parent-after"
	| "parent-kind"
	| "parent-value"
	| "loop";

export interface TemplateIssue {
	/** Position of the question in the list. */
	index: number;
	kind: TemplateIssueKind;
}

/** What is wrong in a list of questions; empty when it can be saved as is. */
export function validateTemplate(questions: Question[]): TemplateIssue[] {
	const issues: TemplateIssue[] = [];
	const seen = new Set<string>();
	const index = new Map<string, number>();
	questions.forEach((q, i) => {
		if (!index.has(q.id)) index.set(q.id, i);
	});
	questions.forEach((q, i) => {
		if (!ID_RE.test(q.id)) issues.push({ index: i, kind: "id-invalid" });
		else if (RESERVED_IDS.has(q.id)) issues.push({ index: i, kind: "id-reserved" });
		if (seen.has(q.id)) issues.push({ index: i, kind: "id-duplicate" });
		seen.add(q.id);
		if (!q.text.trim()) issues.push({ index: i, kind: "text-missing" });
		if (q.kind === "choice") {
			const opts = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
			if (opts.length < 2) issues.push({ index: i, kind: "options-missing" });
			if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) issues.push({ index: i, kind: "option-duplicate" });
		}
		if (q.showWhen) {
			const at = index.get(q.showWhen.id);
			const parent = at === undefined ? undefined : questions[at];
			if (!parent) issues.push({ index: i, kind: "parent-missing" });
			else if (at !== undefined && at >= i) issues.push({ index: i, kind: "parent-after" });
			else if (parent.kind !== "yesno" && parent.kind !== "choice") issues.push({ index: i, kind: "parent-kind" });
			else if (!conditionValues(parent).includes(q.showWhen.value)) issues.push({ index: i, kind: "parent-value" });
		}
	});
	// A chain of conditions that comes back to where it started.
	const byId = new Map(questions.map((q) => [q.id, q]));
	questions.forEach((q, i) => {
		const chain = new Set<string>([q.id]);
		let cur = q.showWhen ? byId.get(q.showWhen.id) : undefined;
		while (cur) {
			if (chain.has(cur.id)) {
				issues.push({ index: i, kind: "loop" });
				break;
			}
			chain.add(cur.id);
			cur = cur.showWhen ? byId.get(cur.showWhen.id) : undefined;
		}
	});
	return issues;
}

/** The questions that depend on this one, directly or not: they go when it goes. */
export function dependents(questions: Question[], id: string): string[] {
	const out = new Set<string>();
	let grew = true;
	while (grew) {
		grew = false;
		for (const q of questions) {
			if (q.showWhen && (q.showWhen.id === id || out.has(q.showWhen.id)) && !out.has(q.id) && q.id !== id) {
				out.add(q.id);
				grew = true;
			}
		}
	}
	return [...out];
}

/** Which set of trade questions a result calls for. */
export function tradeTemplate(pnl: number): "win" | "loss" | "even" {
	return pnl > 0 ? "win" : pnl < 0 ? "loss" : "even";
}

/** A deep copy, so an edit in a window never changes the saved questions before Save. */
export function cloneQuestions(questions: Question[]): Question[] {
	return questions.map((q) => ({ ...q, options: q.options ? [...q.options] : undefined, showWhen: q.showWhen ? { ...q.showWhen } : undefined }));
}
