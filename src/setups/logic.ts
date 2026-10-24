import type { DashTrade } from "../stats";
import { maxDrawdown, stdDev, summarize, type Summary } from "../stats-advanced";

// Setups and their playbooks. Which trades belong to which setup, the figures of each
// setup, what bad execution costs, the comparison of setups, and the sheet note of a
// setup: its properties, its rules (a checklist) and its playbook. Pure: no Obsidian,
// no DOM, no texts, so every figure is tested on trades written by hand.
//
// A setup exists as soon as a tag of the Setups category is used, by Tradoshi or by the
// trader; its sheet is an optional note of the vault with `tradoshi_setup: true`. A trade
// tag that names a sheet (its `setup` property or one of its aliases) belongs to that
// setup, whatever the category of the tag.

const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);

/** Key of a setup name: names match whatever their case and spacing. */
export const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

// ── Sheets ──────────────────────────────────────────────────────────────────

export type SetupStatus = "active" | "testing" | "paused";
export const STATUSES: SetupStatus[] = ["active", "testing", "paused"];

export interface SetupMeta {
	/** The name used on trades. */
	name: string;
	/** Other names of the same setup, used on older trades. */
	aliases: string[];
	/** Path of the sheet note, null for the sample journal. */
	path: string | null;
	description: string;
	markets: string[];
	sessions: string[];
	timeframe: string;
	status: SetupStatus;
	/** A colour of the trader's choice, "#rrggbb", or null for the colour of the palette. */
	color: string | null;
	/** Link target of a note that holds the playbook, when it is not written in the sheet. */
	playbook: string | null;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const list = (v: unknown): string[] =>
	Array.isArray(v)
		? v.map((x) => text(x)).filter(Boolean)
		: typeof v === "string"
			? v
					.split(",")
					.map((x) => x.trim())
					.filter(Boolean)
			: [];

const PAUSED = new Set(["paused", "pause", "en pause", "inactive", "archived", "archive", "archivé", "en pausa", "pausado", "archivado", "arquivado", "inativo", "inactivo"]);
const TESTING = new Set(["testing", "test", "en test", "à tester", "a tester", "prueba", "en prueba", "teste", "em teste", "en pruebas"]);

/** The status written in a sheet, in any of the four languages; active when unknown. */
export function statusOf(v: unknown): SetupStatus {
	const s = norm(text(v));
	if (PAUSED.has(s)) return "paused";
	if (TESTING.has(s)) return "testing";
	return "active";
}

/** A colour property, kept only when it is a hexadecimal colour. */
export function validColor(v: unknown): string | null {
	const s = text(v);
	return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? s : null;
}

/** Target of a wikilink, "[[Folder/Note|Alias]]" giving "Folder/Note"; null for anything else. */
export function linkTargetOf(entry: string): string | null {
	const m = /^\s*!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/.exec(entry);
	return m ? m[1].trim() : null;
}

/** The sheet of a note, from its properties; null when the note is not a setup sheet. */
export function metaFromProperties(fm: Record<string, unknown> | null | undefined, path: string | null, basename: string): SetupMeta | null {
	if (!fm || (fm.tradoshi_setup !== true && fm.tradoshi_setup !== "true")) return null;
	const name = text(fm.setup) || basename;
	const playbook = text(fm.playbook);
	return {
		name,
		aliases: [...list(fm.aliases), ...list(fm.setup_aliases)].filter((a) => norm(a) !== norm(name)),
		path,
		description: text(fm.description),
		markets: list(fm.markets),
		sessions: list(fm.sessions),
		timeframe: list(fm.timeframe).join(", "),
		status: statusOf(fm.status),
		color: validColor(fm.color),
		playbook: playbook ? (linkTargetOf(playbook) ?? playbook) : null,
	};
}

/** Every name and alias of the sheets, to its sheet. A name wins over an alias, the first sheet over a copy. */
export function indexMetas(metas: SetupMeta[]): Map<string, SetupMeta> {
	const m = new Map<string, SetupMeta>();
	for (const s of metas) if (!m.has(norm(s.name))) m.set(norm(s.name), s);
	for (const s of metas) for (const a of s.aliases) if (!m.has(norm(a))) m.set(norm(a), s);
	return m;
}

/** The setups of a trade, one each: its tags that name a sheet, and its tags of the Setups category. */
export function setupsOfTrade(tags: string[], categories: Record<string, string>, sheets: Map<string, SetupMeta>): { key: string; name: string }[] {
	const out = new Map<string, string>();
	for (const tag of tags) {
		const sheet = sheets.get(norm(tag));
		if (sheet) {
			if (!out.has(norm(sheet.name))) out.set(norm(sheet.name), sheet.name);
		} else if ((categories[tag] ?? "").toLowerCase() === "setups" && tag.trim()) {
			if (!out.has(norm(tag))) out.set(norm(tag), tag.trim());
		}
	}
	return [...out].map(([key, name]) => ({ key, name }));
}

// ── Figures of a setup ──────────────────────────────────────────────────────

export interface SetupStats extends Summary {
	/** Average R multiple of the trades that have one. */
	avgR: number | null;
	totalR: number;
	/** Trades with a known R multiple. */
	rCount: number;
	maxDrawdown: number;
	/** Cumulative P&L after each trade, oldest first. */
	curve: number[];
	first: number | null;
	last: number | null;
	best: DashTrade | null;
	worst: DashTrade | null;
}

/** Figures of a set of trades in one currency. */
export function setupStats(trades: DashTrade[]): SetupStats {
	const sorted = [...trades].sort((a, b) => a.at - b.at);
	const rs = sorted.map((t) => t.r).filter((r): r is number => r !== null && Number.isFinite(r));
	let cum = 0;
	const curve = sorted.map((t) => (cum += t.pnl));
	let best: DashTrade | null = null;
	let worst: DashTrade | null = null;
	for (const t of sorted) {
		if (t.pnl > 0 && (!best || t.pnl > best.pnl)) best = t;
		if (t.pnl < 0 && (!worst || t.pnl < worst.pnl)) worst = t;
	}
	return {
		...summarize(sorted),
		avgR: rs.length ? sum(rs) / rs.length : null,
		totalR: sum(rs),
		rCount: rs.length,
		maxDrawdown: maxDrawdown(sorted),
		curve,
		first: sorted.length ? sorted[0].at : null,
		last: sorted.length ? sorted[sorted.length - 1].at : null,
		best,
		worst,
	};
}

export interface SetupRow {
	key: string;
	name: string;
	meta: SetupMeta | null;
	/** Trades of the setup, oldest first. */
	trades: DashTrade[];
	stats: SetupStats;
}

/**
 * One row per setup: every sheet, with or without trades, and every setup tag used.
 * A trade with two setups counts in both. The trades are in one currency.
 */
export function setupRows(trades: DashTrade[], categories: Record<string, string>, metas: SetupMeta[]): SetupRow[] {
	const sheets = indexMetas(metas);
	const rows = new Map<string, { name: string; meta: SetupMeta | null; trades: DashTrade[] }>();
	for (const m of metas) if (!rows.has(norm(m.name))) rows.set(norm(m.name), { name: m.name, meta: m, trades: [] });
	for (const t of [...trades].sort((a, b) => a.at - b.at)) {
		for (const s of setupsOfTrade(t.tags, categories, sheets)) {
			let r = rows.get(s.key);
			if (!r) {
				r = { name: s.name, meta: null, trades: [] };
				rows.set(s.key, r);
			}
			r.trades.push(t);
		}
	}
	return [...rows].map(([key, r]) => ({ key, ...r, stats: setupStats(r.trades) }));
}

export type SetupSort = "net" | "expectancy" | "trades" | "winRate" | "profitFactor" | "avgR";
export const SORTS: SetupSort[] = ["net", "expectancy", "trades", "winRate", "profitFactor", "avgR"];

export function sortValue(r: SetupRow, by: SetupSort): number | null {
	const s = r.stats;
	switch (by) {
		case "net":
			return s.trades ? s.net : null;
		case "expectancy":
			return s.expectancy;
		case "trades":
			return s.trades;
		case "winRate":
			return s.winRate;
		case "profitFactor":
			// No loss at all: an infinite profit factor, ranked first.
			return s.profitFactor ?? (s.wins ? Number.POSITIVE_INFINITY : null);
		case "avgR":
			return s.avgR;
	}
}

/** Best first; setups without a value (no trade, no R) come last, by name. */
export function sortRows(rows: SetupRow[], by: SetupSort): SetupRow[] {
	return [...rows].sort((a, b) => {
		const va = sortValue(a, by);
		const vb = sortValue(b, by);
		if (va === null || vb === null) return va === null && vb === null ? a.name.localeCompare(b.name) : va === null ? 1 : -1;
		return vb - va || b.stats.trades - a.stats.trades || a.name.localeCompare(b.name);
	});
}

/** A ranking that a lucky trade cannot top: setups with at least `min` trades first, then the others. */
export function rankRows(rows: SetupRow[], by: SetupSort, min: number): SetupRow[] {
	const sorted = sortRows(
		rows.filter((r) => r.stats.trades),
		by,
	);
	return [...sorted.filter((r) => r.stats.trades >= min), ...sorted.filter((r) => r.stats.trades < min)];
}

/** Trades of the last `days` days before `now`, to tell a paused setup still traded. */
export function recentCount(trades: { at: number }[], now: number, days = 30): number {
	const from = now - days * 86400000;
	return trades.filter((t) => t.at > from && t.at <= now).length;
}

// ── Curves ──────────────────────────────────────────────────────────────────

/** Money, or R multiples. */
export type Unit = "money" | "r";

export function valueOf(t: { pnl: number; r: number | null }, unit: Unit): number | null {
	if (unit === "money") return t.pnl;
	return t.r !== null && Number.isFinite(t.r) ? t.r : null;
}

/** Cumulative result after each trade, oldest first. In R, trades without an R multiple are left out. */
export function cumulative<T extends { at: number; pnl: number; r: number | null }>(trades: T[], unit: Unit): { at: number; value: number; trade: T }[] {
	let cum = 0;
	const out: { at: number; value: number; trade: T }[] = [];
	for (const t of [...trades].sort((a, b) => a.at - b.at)) {
		const v = valueOf(t, unit);
		if (v === null) continue;
		cum += v;
		out.push({ at: t.at, value: cum, trade: t });
	}
	return out;
}

/**
 * Several cumulative curves on one time axis: the moments of every trade, and for each
 * setup its cumulative result at that moment, or null before its first trade.
 */
export function overlayByTime(lists: { at: number; pnl: number; r: number | null }[][], unit: Unit): { xs: number[]; values: (number | null)[][] } {
	const curves = lists.map((l) => cumulative(l, unit));
	const xs = [...new Set(curves.flatMap((c) => c.map((p) => p.at)))].sort((a, b) => a - b);
	const values = curves.map((c) => {
		let i = 0;
		let current: number | null = null;
		return xs.map((x) => {
			while (i < c.length && c[i].at <= x) current = c[i++].value;
			return current;
		});
	});
	return { xs, values };
}

/** Several cumulative curves by trade number: the n-th trade of each setup on the same x. */
export function overlayByCount(lists: { at: number; pnl: number; r: number | null }[][], unit: Unit): { xs: number[]; values: (number | null)[][] } {
	const curves = lists.map((l) => cumulative(l, unit));
	const n = Math.max(0, ...curves.map((c) => c.length));
	const xs = Array.from({ length: n }, (_, i) => i + 1);
	return { xs, values: curves.map((c) => xs.map((_, i) => (i < c.length ? c[i].value : null))) };
}

// ── Execution gap ───────────────────────────────────────────────────────────

/** Figures of a group of trades: on the plan, off the plan, live, missed… */
export interface Side {
	trades: number;
	net: number;
	expectancy: number | null;
	winRate: number | null;
	avgR: number | null;
}

export function sideOf(trades: { pnl: number; r: number | null }[]): Side {
	const wins = trades.filter((t) => t.pnl > 0).length;
	const losses = trades.filter((t) => t.pnl < 0).length;
	const net = sum(trades.map((t) => t.pnl));
	const rs = trades.map((t) => t.r).filter((r): r is number => r !== null && Number.isFinite(r));
	return {
		trades: trades.length,
		net,
		expectancy: trades.length ? net / trades.length : null,
		winRate: wins + losses ? (wins / (wins + losses)) * 100 : null,
		avgR: rs.length ? sum(rs) / rs.length : null,
	};
}

/**
 * What the trades of group `bad` cost against the expectancy of group `good`: had each of
 * them done as well as an average good trade, the result would be higher by this much.
 * Negative when the bad trades did better. Null when one group is empty.
 */
export function gapCost(good: Side, bad: Side): number | null {
	if (good.expectancy === null || bad.expectancy === null) return null;
	return bad.trades * (good.expectancy - bad.expectancy);
}

export interface ExecutionGap {
	followed: Side;
	broken: Side;
	/** Trades without an answer to "plan followed". */
	unknown: number;
	planCost: number | null;
	clean: Side;
	withMistakes: Side;
	mistakeCost: number | null;
	/** The mistakes made on this setup, costliest first. */
	mistakes: { tag: string; trades: number; net: number; expectancy: number }[];
}

/** How much executing the setup badly costs: off the plan against on it, with a mistake against without. */
export function executionGap(trades: DashTrade[], categories: Record<string, string>): ExecutionGap {
	const isMistake = (tag: string): boolean => (categories[tag] ?? "").toLowerCase() === "mistakes";
	const followed = sideOf(trades.filter((t) => t.followedPlan === true));
	const broken = sideOf(trades.filter((t) => t.followedPlan === false));
	const marked = trades.filter((t) => t.tags.some(isMistake));
	const clean = sideOf(trades.filter((t) => !t.tags.some(isMistake)));
	const withMistakes = sideOf(marked);
	const byTag = new Map<string, DashTrade[]>();
	for (const t of marked) for (const tag of new Set(t.tags.filter(isMistake))) byTag.set(tag, [...(byTag.get(tag) ?? []), t]);
	const mistakes = [...byTag]
		.map(([tag, ts]) => {
			const net = sum(ts.map((t) => t.pnl));
			return { tag, trades: ts.length, net, expectancy: net / ts.length };
		})
		.sort((a, b) => a.net - b.net || a.tag.localeCompare(b.tag));
	return {
		followed,
		broken,
		unknown: trades.length - followed.trades - broken.trades,
		planCost: gapCost(followed, broken),
		clean,
		withMistakes,
		mistakeCost: gapCost(clean, withMistakes),
		mistakes,
	};
}

export type TradeKind = "executed" | "missed" | "backtest";

export interface KindGap {
	live: Side;
	missed: Side;
	backtest: Side;
	/** Share of the opportunities seen that were taken, in %. */
	taken: number | null;
	livePlusMissed: number;
	/** Share of the potential (live + missed) that live trading kept, in %, when missed trades would have made money. */
	capture: number | null;
}

/** Live trading against the opportunities missed and the backtest of the same setup. */
export function kindGap(trades: { pnl: number; r: number | null; kind: TradeKind }[]): KindGap {
	const live = sideOf(trades.filter((t) => t.kind === "executed"));
	const missed = sideOf(trades.filter((t) => t.kind === "missed"));
	const backtest = sideOf(trades.filter((t) => t.kind === "backtest"));
	const livePlusMissed = live.net + missed.net;
	return {
		live,
		missed,
		backtest,
		taken: live.trades + missed.trades ? (live.trades / (live.trades + missed.trades)) * 100 : null,
		livePlusMissed,
		capture: missed.trades && missed.net > 0 && livePlusMissed > 0 ? (live.net / livePlusMissed) * 100 : null,
	};
}

// ── Pairs and comparison ────────────────────────────────────────────────────

export interface Pair {
	a: string;
	b: string;
	together: Side;
	/** Trades of each setup alone, without any other setup. */
	aSolo: Side;
	bSolo: Side;
	/** Expectancy together minus the better expectancy alone. */
	edge: number | null;
}

/** Two setups on the same trade, against each of them alone. */
export function setupPairs<T extends { pnl: number; r: number | null }>(trades: T[], setupsOf: (t: T) => string[]): Pair[] {
	const together = new Map<string, T[]>();
	const solo = new Map<string, T[]>();
	for (const t of trades) {
		const names = [...new Set(setupsOf(t))].sort((a, b) => a.localeCompare(b));
		if (names.length === 1) solo.set(names[0], [...(solo.get(names[0]) ?? []), t]);
		for (let i = 0; i < names.length; i++)
			for (let j = i + 1; j < names.length; j++) {
				const k = JSON.stringify([names[i], names[j]]);
				together.set(k, [...(together.get(k) ?? []), t]);
			}
	}
	return [...together]
		.map(([k, ts]) => {
			const [a, b] = JSON.parse(k) as [string, string];
			const pair = sideOf(ts);
			const aSolo = sideOf(solo.get(a) ?? []);
			const bSolo = sideOf(solo.get(b) ?? []);
			const alone = [aSolo.expectancy, bSolo.expectancy].filter((x): x is number => x !== null);
			return { a, b, together: pair, aSolo, bSolo, edge: pair.expectancy !== null && alone.length ? pair.expectancy - Math.max(...alone) : null };
		})
		.sort((x, y) => y.together.net - x.together.net || x.a.localeCompare(y.a));
}

/** Index of the best value of a row of figures; null when fewer than two values, or all equal. */
export function bestIndex(values: (number | null)[], better: "high" | "low"): number | null {
	const known = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null && !Number.isNaN(x.v));
	if (known.length < 2) return null;
	const top = known.reduce((a, b) => (better === "high" ? (b.v > a.v ? b : a) : b.v < a.v ? b : a));
	return known.every((x) => x.v === top.v) ? null : top.i;
}

/**
 * The same groups (symbols, days, sides) side by side for several lists of trades: the
 * keys most traded across the lists first, at most `max`, and a cell per list.
 */
export function crossBy<T extends { pnl: number; r: number | null }>(lists: T[][], keyOf: (t: T) => string | null, max = 8, order?: (a: string, b: string) => number): { keys: string[]; cells: Side[][] } {
	const count = new Map<string, number>();
	for (const l of lists)
		for (const t of l) {
			const k = keyOf(t);
			if (k !== null) count.set(k, (count.get(k) ?? 0) + 1);
		}
	let keys = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([k]) => k);
	if (order) keys = keys.sort(order);
	return { keys, cells: keys.map((k) => lists.map((l) => sideOf(l.filter((t) => keyOf(t) === k)))) };
}

/** The best and the worst trades: the `n` largest gains and the `n` largest losses. */
export function extremes<T extends { pnl: number; at: number }>(trades: T[], n = 5): { best: T[]; worst: T[] } {
	return {
		best: trades.filter((t) => t.pnl > 0).sort((a, b) => b.pnl - a.pnl || b.at - a.at).slice(0, n),
		worst: trades.filter((t) => t.pnl < 0).sort((a, b) => a.pnl - b.pnl || b.at - a.at).slice(0, n),
	};
}

// ── How much the figures can be trusted ─────────────────────────────────────

/** Under this many trades, no setup is judged. */
export const EDGE_MIN_TRADES = 10;

export type EdgeLevel = "early" | "noise" | "emerging" | "solid";

export interface Edge {
	level: EdgeLevel;
	/** Average result ÷ its standard error: how many standard errors the average is away from zero. */
	t: number | null;
	n: number;
	positive: boolean;
}

/**
 * Is the average result of a setup told apart from chance? The t statistic of the mean:
 * under 1, the average is within the noise; from 1, an edge shows; from 2, it is solid
 * (about 95 % confidence on a large sample). Too early under ten trades.
 */
export function edgeConfidence(values: number[]): Edge {
	const n = values.length;
	const mean = n ? sum(values) / n : 0;
	const sd = stdDev(values);
	const t = sd ? mean / (sd / Math.sqrt(n)) : null;
	const positive = mean > 0;
	if (n < EDGE_MIN_TRADES) return { level: "early", t, n, positive };
	if (t === null) return { level: mean === 0 ? "noise" : "solid", t, n, positive };
	const a = Math.abs(t);
	return { level: a >= 2 ? "solid" : a >= 1 ? "emerging" : "noise", t, n, positive };
}

/** What a sheet still lacks to be useful in a review. */
export type HealthIssue = "noSheet" | "noDescription" | "noPlaybook" | "noRules" | "noExamples" | "fewTrades" | "pausedTraded";

/** Trades a setup needs before its figures say much. */
export const FEW_TRADES = 20;

export function healthOf(x: { sheet: boolean; description: string; playbook: number; rules: number; examples: number; trades: number; status: SetupStatus; recent: number }): HealthIssue[] {
	const out: HealthIssue[] = [];
	if (!x.sheet) out.push("noSheet");
	else {
		if (!x.description.trim()) out.push("noDescription");
		if (x.playbook < 20) out.push("noPlaybook");
		if (!x.rules) out.push("noRules");
		if (!x.examples) out.push("noExamples");
		if (x.status === "paused" && x.recent > 0) out.push("pausedTraded");
	}
	if (x.trades < FEW_TRADES) out.push("fewTrades");
	return out;
}

// ── Colours ─────────────────────────────────────────────────────────────────

/** Colours of the palette, drawn from the theme (blue, orange, purple, cyan, pink, yellow). */
export const PALETTE = 6;

/** A colour of the palette that stays the same for a name. */
export function paletteIndex(name: string): number {
	let h = 0;
	for (const c of norm(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return h % PALETTE;
}

/** The trader's colour of a setup, or a colour of the palette. */
export interface Hue {
	color: string | null;
	index: number;
}

/** Colours for setups shown together: each its own, and a free colour of the palette when two would look the same. */
export function distinctHues(items: { name: string; color: string | null }[]): Hue[] {
	const colors = new Set<string>();
	const used = new Set<number>();
	return items.map((it) => {
		const own = it.color ? it.color.toLowerCase() : null;
		if (own && !colors.has(own)) {
			colors.add(own);
			return { color: it.color, index: paletteIndex(it.name) };
		}
		let index = paletteIndex(it.name);
		for (let k = 0; k < PALETTE && used.has(index); k++) index = (index + 1) % PALETTE;
		used.add(index);
		return { color: null, index };
	});
}

/** The colour of every setup, given in the order of their keys, so each keeps its colour whatever is shown. */
export function huesByKey(rows: { key: string; name: string; meta: { color: string | null } | null }[]): Map<string, Hue> {
	const once = new Map<string, { key: string; name: string; meta: { color: string | null } | null }>();
	for (const r of rows) if (!once.has(r.key)) once.set(r.key, r);
	const sorted = [...once.values()].sort((a, b) => a.key.localeCompare(b.key));
	const hues = distinctHues(sorted.map((r) => ({ name: r.name, color: r.meta?.color ?? null })));
	return new Map(sorted.map((r, i) => [r.key, hues[i]]));
}

// ── The sheet note: rules and playbook ──────────────────────────────────────

/** Language of the code block that shows the figures of the setup at the top of its sheet. */
export const SHEET_BLOCK = "tradoshi-setup";

export interface Rule {
	text: string;
	done: boolean;
	/** Heading the rule sits under. */
	group: string | null;
	/** Line of the rule in the note, from 0. */
	line: number;
}

const TASK = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*?\S)(\s*)$/;
/** An item of a checklist with nothing written yet, as in a new sheet. */
const EMPTY_TASK = /^\s*[-*+]\s+\[[ xX]\]\s*$/;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?\S)\s*$/;

/** Index of the first line after the properties of a note. */
function bodyStart(lines: string[]): number {
	if (lines[0]?.trim() !== "---") return 0;
	for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") return i + 1;
	return 0;
}

/** The rules of a sheet: every item of a checklist in the note, outside code blocks. */
export function parseRules(md: string): Rule[] {
	const lines = md.split("\n");
	const out: Rule[] = [];
	let fence = false;
	let group: string | null = null;
	for (let i = bodyStart(lines); i < lines.length; i++) {
		const line = lines[i];
		if (FENCE.test(line)) {
			fence = !fence;
			continue;
		}
		if (fence) continue;
		const h = HEADING.exec(line);
		if (h) {
			group = h[2];
			continue;
		}
		const m = TASK.exec(line);
		if (m) out.push({ text: m[4], done: m[2] !== " ", group, line: i });
	}
	return out;
}

/** The note with one rule ticked or unticked; null when the line is no longer that rule. */
export function setRule(md: string, rule: { line: number; text: string }, done: boolean): string | null {
	const lines = md.split("\n");
	const m = TASK.exec(lines[rule.line] ?? "");
	if (!m || m[4] !== rule.text) return null;
	lines[rule.line] = `${m[1]}${done ? "x" : " "}${m[3]}${m[4]}${m[5]}`;
	return lines.join("\n");
}

/** The note with every rule unticked, ready for the next trade. */
export function resetRules(md: string): string {
	const lines = md.split("\n");
	let fence = false;
	for (let i = bodyStart(lines); i < lines.length; i++) {
		if (FENCE.test(lines[i])) {
			fence = !fence;
			continue;
		}
		const m = fence ? null : TASK.exec(lines[i]);
		if (m) lines[i] = `${m[1]} ${m[3]}${m[4]}${m[5]}`;
	}
	return lines.join("\n");
}

const COMMENT = /^\s*%%.*%%\s*$/;
const blank = (line: string): boolean => !line.trim() || COMMENT.test(line);

/**
 * The playbook of a sheet: the note without its properties, its figures block and its
 * checklist (shown apart), and without the headings left empty by that.
 */
export function playbookMarkdown(md: string): string {
	const all = md.split("\n");
	let lines: string[] = [];
	let fence: string | null = null;
	let ours = false;
	for (const line of all.slice(bodyStart(all))) {
		const f = /^\s*(```|~~~)\s*(\S*)/.exec(line);
		if (f) {
			if (fence === null) {
				fence = f[1];
				ours = f[2] === SHEET_BLOCK;
				if (!ours) lines.push(line);
			} else if (f[1] === fence) {
				if (!ours) lines.push(line);
				fence = null;
				ours = false;
			} else if (!ours) lines.push(line);
			continue;
		}
		if (fence !== null) {
			if (!ours) lines.push(line);
			continue;
		}
		if (TASK.test(line) || EMPTY_TASK.test(line)) continue;
		lines.push(line);
	}
	// A heading whose section holds nothing before the next heading of the same level or above goes.
	for (let changed = true; changed; ) {
		changed = false;
		for (let i = lines.length - 1; i >= 0; i--) {
			const h = HEADING.exec(lines[i]);
			if (!h) continue;
			let j = i + 1;
			while (j < lines.length && blank(lines[j])) j++;
			const next = j < lines.length ? HEADING.exec(lines[j]) : null;
			if (j >= lines.length || (next && next[1].length <= h[1].length)) {
				lines = [...lines.slice(0, i), ...lines.slice(j)];
				changed = true;
			}
		}
	}
	return lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Characters of text in a playbook, headings and comments left out: tells a written playbook from an empty one. */
export function playbookSize(md: string): number {
	return playbookMarkdown(md)
		.split("\n")
		.filter((l) => !HEADING.test(l) && !blank(l))
		.join("")
		.replace(/!?\[\[[^\]]*\]\]/g, "")
		.trim().length;
}

export interface SheetTexts {
	playbook: string;
	entry: string;
	management: string;
	exit: string;
	rules: string;
	examples: string;
	hintEntry: string;
	hintManagement: string;
	hintExit: string;
	hintRules: string;
	hintExamples: string;
}

/** The note of a new setup: its properties, the figures block, an empty playbook, checklist and examples. */
export function sheetNote(name: string, tx: SheetTexts, description = ""): string {
	const q = (s: string): string => JSON.stringify(s);
	return [
		"---",
		"tradoshi_setup: true",
		`setup: ${q(name)}`,
		`description: ${q(description)}`,
		"markets: []",
		"sessions: []",
		'timeframe: ""',
		"status: active",
		'color: ""',
		"tags:",
		"  - tradoshi/setup",
		"---",
		"",
		"```" + SHEET_BLOCK,
		"```",
		"",
		`## ${tx.playbook}`,
		"",
		`### ${tx.entry}`,
		`%% ${tx.hintEntry} %%`,
		"",
		`### ${tx.management}`,
		`%% ${tx.hintManagement} %%`,
		"",
		`### ${tx.exit}`,
		`%% ${tx.hintExit} %%`,
		"",
		`## ${tx.rules}`,
		`%% ${tx.hintRules} %%`,
		"- [ ] ",
		"",
		`## ${tx.examples}`,
		`%% ${tx.hintExamples} %%`,
		"",
	].join("\n");
}

/** A file name for a setup: the characters a file name cannot hold become spaces. */
export function sheetFileName(name: string): string {
	const s = name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "");
	return s || "Setup";
}

// ── Links from the trade notes to their setup sheets ────────────────────────

/** The link written in a trade note: the path of the sheet, shown as the name of the setup. */
export function setupLink(path: string, name: string): string {
	const alias = name.replace(/[[\]|]/g, " ").trim();
	return `[[${path.replace(/\.md$/i, "")}${alias ? `|${alias}` : ""}]]`;
}

/**
 * The links a trade note should carry to its setup sheets (`review_setups`). `resolve`
 * gives the sheet an entry points to, or null for an entry that is not a setup link:
 * those are kept as the trader wrote them. Setup links still wanted are kept, the others
 * dropped, and the missing ones added. Null when nothing changes.
 */
export function nextSetupLinks(current: string[], resolve: (entry: string) => string | null, wanted: Map<string, string>): string[] | null {
	const out: string[] = [];
	const have = new Set<string>();
	for (const entry of current) {
		const target = resolve(entry);
		if (target === null) out.push(entry);
		else if (wanted.has(target) && !have.has(target)) {
			out.push(entry);
			have.add(target);
		}
	}
	for (const [target, link] of wanted) if (!have.has(target)) out.push(link);
	return out.length === current.length && out.every((e, i) => e === current[i]) ? null : out;
}
