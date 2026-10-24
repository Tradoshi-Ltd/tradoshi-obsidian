import { addDays, mondayOf, weekdayOf } from "../stats-advanced";

// Review periods: a trading day, an ISO week (Monday to Sunday), a month, a quarter, a
// year. Each has a stable id, the name of its note: "2026-10-20", "2026-W43",
// "2026-10", "2026-Q4", "2026". Pure: no Obsidian, so every rule is tested.
//
// A week belongs to the month, the quarter and the year of its Thursday, as ISO weeks
// do: the week of Monday 29 December 2025 is 2026-W01, and it is a week of January.

export type PeriodKind = "day" | "week" | "month" | "quarter" | "year";

export const PERIOD_KINDS: PeriodKind[] = ["day", "week", "month", "quarter", "year"];
/** The kinds that have their own review note; a day's review is its day note. */
export const REVIEW_KINDS: Exclude<PeriodKind, "day">[] = ["week", "month", "quarter", "year"];

export interface Period {
	kind: PeriodKind;
	id: string;
	/** First and last day, both included, "YYYY-MM-DD". */
	start: string;
	end: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day "YYYY-MM-DD". */
export function isDay(s: string): boolean {
	const m = DAY_RE.exec(s);
	if (!m) return false;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const lastOfMonth = (y: number, m: number): string => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;

/** Monday of ISO week 1 of a year: the week that holds 4 January. */
function firstMonday(year: number): string {
	return mondayOf(`${year}-01-04`);
}

/** ISO week of a day: the year it counts in and its number, 1 to 53. */
export function isoWeek(day: string): { year: number; week: number } {
	const thursday = addDays(day, 3 - weekdayOf(day));
	const year = Number(thursday.slice(0, 4));
	const weeks = Math.round((Date.parse(`${mondayOf(day)}T12:00:00Z`) - Date.parse(`${firstMonday(year)}T12:00:00Z`)) / (7 * 86400000));
	return { year, week: weeks + 1 };
}

/** Number of ISO weeks of a year, 52 or 53. */
export function weeksInYear(year: number): number {
	return isoWeek(`${year}-12-28`).week;
}

/** The period of a kind that holds a day. */
export function periodOf(kind: PeriodKind, day: string): Period {
	const y = Number(day.slice(0, 4));
	const m = Number(day.slice(5, 7));
	switch (kind) {
		case "day":
			return { kind, id: day, start: day, end: day };
		case "week": {
			const { year, week } = isoWeek(day);
			const start = mondayOf(day);
			return { kind, id: `${year}-W${pad(week)}`, start, end: addDays(start, 6) };
		}
		case "month":
			return { kind, id: day.slice(0, 7), start: `${day.slice(0, 7)}-01`, end: lastOfMonth(y, m) };
		case "quarter": {
			const q = Math.floor((m - 1) / 3) + 1;
			return { kind, id: `${y}-Q${q}`, start: `${y}-${pad((q - 1) * 3 + 1)}-01`, end: lastOfMonth(y, q * 3) };
		}
		case "year":
			return { kind, id: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
	}
}

/** The period an id names, or null when the id is not one. */
export function parsePeriod(id: string): Period | null {
	const s = id.trim();
	if (isDay(s)) return periodOf("day", s);
	let m = /^(\d{4})-W(\d{2})$/.exec(s);
	if (m) {
		const year = Number(m[1]);
		const week = Number(m[2]);
		if (week < 1 || week > weeksInYear(year)) return null;
		return periodOf("week", addDays(firstMonday(year), (week - 1) * 7));
	}
	m = /^(\d{4})-(\d{2})$/.exec(s);
	if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? periodOf("month", `${s}-01`) : null;
	m = /^(\d{4})-Q([1-4])$/.exec(s);
	if (m) return periodOf("quarter", `${m[1]}-${pad((Number(m[2]) - 1) * 3 + 1)}-01`);
	m = /^(\d{4})$/.exec(s);
	if (m) return periodOf("year", `${s}-01-01`);
	return null;
}

/** The same kind of period, `n` periods later (or earlier when `n` is negative). */
export function shiftPeriod(p: Period, n: number): Period {
	const y = Number(p.start.slice(0, 4));
	const m = Number(p.start.slice(5, 7));
	const month = (k: number): string => {
		const total = y * 12 + (m - 1) + k;
		return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
	};
	switch (p.kind) {
		case "day":
			return periodOf("day", addDays(p.start, n));
		case "week":
			return periodOf("week", addDays(p.start, 7 * n));
		case "month":
			return periodOf("month", month(n));
		case "quarter":
			return periodOf("quarter", month(3 * n));
		case "year":
			return periodOf("year", `${y + n}-01-01`);
	}
}

/** The period one level up: the week of a day, the month of a week (by its Thursday)… null for a year. */
export function parentOf(p: Period): Period | null {
	switch (p.kind) {
		case "day":
			return periodOf("week", p.start);
		case "week":
			return periodOf("month", addDays(p.start, 3));
		case "month":
			return periodOf("quarter", p.start);
		case "quarter":
			return periodOf("year", p.start);
		case "year":
			return null;
	}
}

/** Every day of a period, in order. */
export function daysOf(p: Period): string[] {
	const out: string[] = [];
	for (let d = p.start; d <= p.end; d = addDays(d, 1)) out.push(d);
	return out;
}

/** The periods one level down: the days of a week, the weeks of a month (by their Thursday), the months of a quarter, the quarters of a year. */
export function childrenOf(p: Period): Period[] {
	switch (p.kind) {
		case "day":
			return [];
		case "week":
			return daysOf(p).map((d) => periodOf("day", d));
		case "month": {
			const out: Period[] = [];
			for (let monday = mondayOf(p.start); monday <= p.end; monday = addDays(monday, 7)) {
				const thursday = addDays(monday, 3);
				if (thursday >= p.start && thursday <= p.end) out.push(periodOf("week", monday));
			}
			return out;
		}
		case "quarter":
			return [0, 1, 2].map((k) => shiftPeriod(periodOf("month", p.start), k));
		case "year":
			return [0, 1, 2, 3].map((k) => shiftPeriod(periodOf("quarter", p.start), k));
	}
}

/** The kind one level down. */
export function childKind(kind: PeriodKind): PeriodKind | null {
	return kind === "year" ? "quarter" : kind === "quarter" ? "month" : kind === "month" ? "week" : kind === "week" ? "day" : null;
}

export function contains(p: Period, day: string): boolean {
	return day >= p.start && day <= p.end;
}

/** True once the last day of the period is over. */
export function isFinished(p: Period, today: string): boolean {
	return p.end < today;
}

// ── Notes and links ─────────────────────────────────────────────────────────

/** Where the review note of a week, a month, a quarter or a year is created. */
export function reviewPath(folder: string, p: Period): string {
	return `${folder}/Reviews/${p.id.slice(0, 4)}/${p.id}.md`;
}

/** A link written in a property: the full path, so a note of the trader with the same name is never taken for it. */
export function noteLink(path: string, label: string): string {
	return `[[${path.replace(/\.md$/, "")}|${label}]]`;
}

/** Property holding the link to the period one level up. */
export const UP_PROPERTY: Record<PeriodKind, string | null> = {
	day: "review_week",
	week: "review_month",
	month: "review_quarter",
	quarter: "review_year",
	year: null,
};

/** Property holding the links to the periods one level down. */
export const DOWN_PROPERTY: Record<PeriodKind, string | null> = {
	day: null,
	week: "review_days",
	month: "review_weeks",
	quarter: "review_months",
	year: "review_quarters",
};

export const PREVIOUS_PROPERTY = "review_previous";
export const NEXT_PROPERTY = "review_next";

/** Target path of a link "[[path|label]]" or "[[path]]", without ".md". */
export function linkTarget(link: unknown): string | null {
	if (typeof link !== "string") return null;
	const m = /^\[\[([^|\]]+)(?:\|[^\]]*)?\]\]$/.exec(link.trim());
	return m ? m[1].replace(/\.md$/, "") : null;
}

/** True when a property (a link or a list of links) already points to this path. */
export function linksTo(value: unknown, path: string): boolean {
	const target = path.replace(/\.md$/, "");
	const list = Array.isArray(value) ? value : [value];
	return list.some((v) => linkTarget(v) === target);
}

/** Properties of a new review note. Links are given only for notes that exist. */
export function reviewFrontmatter(
	p: Period,
	links: { up: string | null; previous: string | null; next: string | null; children: string[] },
): Record<string, string | string[] | boolean> {
	const fm: Record<string, string | string[] | boolean> = {
		tradoshi_review: p.kind,
		period: p.id,
		start: p.start,
		end: p.end,
	};
	const up = UP_PROPERTY[p.kind];
	if (up && links.up) fm[up] = links.up;
	if (links.previous) fm[PREVIOUS_PROPERTY] = links.previous;
	if (links.next) fm[NEXT_PROPERTY] = links.next;
	const down = DOWN_PROPERTY[p.kind];
	if (down && links.children.length) fm[down] = links.children;
	fm.tags = ["tradoshi/review"];
	return fm;
}

/** The language of the code block that shows a period review. */
export const REVIEW_BLOCK = "tradoshi-review";

/** Body of a new review note: the review, drawn by the plugin, then the trader's own space. */
export function reviewBody(): string {
	return ["```" + REVIEW_BLOCK, "```", "", "## My notes", "", ""].join("\n");
}
