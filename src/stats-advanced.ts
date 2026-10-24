import type { DashTrade, Group } from "./stats";

// Deeper statistics of the dashboard: risk-adjusted ratios, drawdown, streaks, rolling
// figures, breakdowns, the year map, the week, the trading score and the goals. Pure:
// no Obsidian, no DOM, so every figure is tested on trades written by hand.
//
// Conventions, the same as the key figures: a win is a P&L above zero, a loss below
// zero, and a trade at exactly zero (break-even) is neither. Money figures are in one
// currency; the caller passes the trades of that currency only.

const DAY = 86400000;
/** Trading days in a year, to annualise daily figures. */
export const TRADING_DAYS_A_YEAR = 252;

const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]): number | null => (xs.length ? sum(xs) / xs.length : null);

/** Sample standard deviation (n − 1), null under two values. */
export function stdDev(xs: number[]): number | null {
	if (xs.length < 2) return null;
	const m = sum(xs) / xs.length;
	return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

const byTime = (trades: DashTrade[]): DashTrade[] => [...trades].sort((a, b) => a.at - b.at);

// ── Days ────────────────────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local calendar day of a moment, "YYYY-MM-DD". */
export function dayKey(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A day key moved by whole days. Computed at noon UTC, so summer time never shifts it. */
export function addDays(day: string, n: number): string {
	return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Day of the week of a day key, Monday 0 to Sunday 6. */
export function weekdayOf(day: string): number {
	return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function mondayOf(day: string): string {
	return addDays(day, -weekdayOf(day));
}

export interface DayResult {
	day: string;
	pnl: number;
	trades: number;
	wins: number;
	losses: number;
}

/** Net result of each trading day, oldest first. */
export function dailyResults(trades: DashTrade[]): DayResult[] {
	const m = new Map<string, DayResult>();
	for (const t of trades) {
		const d = m.get(t.day) ?? { day: t.day, pnl: 0, trades: 0, wins: 0, losses: 0 };
		d.pnl += t.pnl;
		d.trades++;
		if (t.pnl > 0) d.wins++;
		else if (t.pnl < 0) d.losses++;
		m.set(t.day, d);
	}
	return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// ── Summary of a set of trades ──────────────────────────────────────────────

export interface Summary {
	trades: number;
	wins: number;
	losses: number;
	evens: number;
	net: number;
	grossWin: number;
	/** Sum of the losses, as a positive amount. */
	grossLoss: number;
	/** Wins over decisive trades, in %; break-even trades are left out. */
	winRate: number | null;
	expectancy: number | null;
	profitFactor: number | null;
	avgWin: number | null;
	/** Average loss, negative. */
	avgLoss: number | null;
	/** Average win ÷ average loss (as a positive amount). */
	payoff: number | null;
}

export function summarize(trades: DashTrade[]): Summary {
	const wins = trades.filter((t) => t.pnl > 0);
	const losses = trades.filter((t) => t.pnl < 0);
	const grossWin = sum(wins.map((t) => t.pnl));
	const grossLoss = -sum(losses.map((t) => t.pnl));
	const avgWin = wins.length ? grossWin / wins.length : null;
	const avgLoss = losses.length ? -grossLoss / losses.length : null;
	return {
		trades: trades.length,
		wins: wins.length,
		losses: losses.length,
		evens: trades.length - wins.length - losses.length,
		net: grossWin - grossLoss,
		grossWin,
		grossLoss,
		winRate: wins.length + losses.length ? (wins.length / (wins.length + losses.length)) * 100 : null,
		expectancy: trades.length ? (grossWin - grossLoss) / trades.length : null,
		profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
		avgWin,
		avgLoss,
		payoff: avgWin !== null && avgLoss !== null ? avgWin / -avgLoss : null,
	};
}

// ── Risk-adjusted ratios ────────────────────────────────────────────────────

/**
 * Sharpe ratio on trading days, annualised: average P&L of a trading day divided by
 * its standard deviation, times √252, with no risk-free rate. Days without a trade
 * are left out. Null under two trading days, or when every day gave the same result.
 */
export function sharpe(dailyPnl: number[]): number | null {
	const sd = stdDev(dailyPnl);
	const m = mean(dailyPnl);
	if (sd === null || m === null || sd === 0) return null;
	return (m / sd) * Math.sqrt(TRADING_DAYS_A_YEAR);
}

/**
 * Calmar ratio on trading days: average P&L of a trading day times 252 (a year of
 * trading at this pace), divided by the max drawdown. Null without a drawdown.
 */
export function calmar(dailyPnl: number[], maxDrawdown: number): number | null {
	const m = mean(dailyPnl);
	if (m === null || maxDrawdown <= 0) return null;
	return (m * TRADING_DAYS_A_YEAR) / maxDrawdown;
}

// ── Drawdown ────────────────────────────────────────────────────────────────

export interface DrawdownPoint {
	at: number;
	trade: DashTrade;
	/** Cumulative P&L after the trade. */
	equity: number;
	/** Distance to the highest point reached so far, zero or negative. */
	value: number;
	/** Highest point reached so far (the start counts as zero). */
	peak: number;
}

/** Distance to the high after each trade, oldest first. The curve starts at zero. */
export function drawdownCurve(trades: DashTrade[]): DrawdownPoint[] {
	let cum = 0;
	let peak = 0;
	return byTime(trades).map((t) => {
		cum += t.pnl;
		peak = Math.max(peak, cum);
		return { at: t.at, trade: t, equity: cum, value: cum - peak, peak };
	});
}

export function maxDrawdown(trades: DashTrade[]): number {
	return -Math.min(0, ...drawdownCurve(trades).map((p) => p.value));
}

export interface UnderPeak {
	/** When the last high was made (the first trade when the curve never rose above its start). */
	peakAt: number;
	/** The curve is below its last high now. */
	below: boolean;
	/** Time since the last high, zero when the curve is at a high. */
	current: number;
	/** Longest stretch below a high: from the high to the trade back at it, or to now when still below. */
	longest: { from: number; to: number; open: boolean } | null;
}

/** Time spent below the last high of the cumulative P&L. */
export function underPeak(trades: DashTrade[], now: number): UnderPeak | null {
	const sorted = byTime(trades);
	if (!sorted.length) return null;
	let cum = 0;
	let peak = 0;
	let peakAt = sorted[0].at;
	let below = false;
	let longest: UnderPeak["longest"] = null;
	const keep = (from: number, to: number, open: boolean): void => {
		if (!longest || to - from > longest.to - longest.from) longest = { from, to, open };
	};
	for (const t of sorted) {
		cum += t.pnl;
		if (cum >= peak) {
			if (below) keep(peakAt, t.at, false);
			peak = cum;
			peakAt = t.at;
			below = false;
		} else {
			below = true;
		}
	}
	if (below) keep(peakAt, Math.max(now, peakAt), true);
	return { peakAt, below, current: below ? Math.max(0, now - peakAt) : 0, longest };
}

// ── Streaks ─────────────────────────────────────────────────────────────────

export interface Run {
	kind: "win" | "loss";
	length: number;
	/** Index of the first and the last result of the run. */
	from: number;
	to: number;
}

export interface Streaks {
	bestWin: Run | null;
	bestLoss: Run | null;
	/** The run going on at the end. */
	current: Run | null;
}

/**
 * Runs of results above and below zero, in order. A result of exactly zero neither
 * extends nor breaks a run, as break-even trades stay out of the win rate.
 */
export function streaks(results: number[]): Streaks {
	let bestWin: Run | null = null;
	let bestLoss: Run | null = null;
	let run: Run | null = null;
	results.forEach((v, i) => {
		if (v === 0) return;
		const kind = v > 0 ? "win" : "loss";
		if (run && run.kind === kind) {
			run.length++;
			run.to = i;
		} else {
			run = { kind, length: 1, from: i, to: i };
		}
		if (kind === "win" && (!bestWin || run.length > bestWin.length)) bestWin = { ...run };
		if (kind === "loss" && (!bestLoss || run.length > bestLoss.length)) bestLoss = { ...run };
	});
	return { bestWin, bestLoss, current: run };
}

// ── Holding time, volume, fees ──────────────────────────────────────────────

export interface HoldTimes {
	/** Average time held, in milliseconds, null when no trade of the kind has an open time. */
	winners: number | null;
	losers: number | null;
	all: number | null;
	/** Trades with an open time. */
	known: number;
}

export function holdTimes(trades: DashTrade[]): HoldTimes {
	const held = trades.filter((t) => t.openAt !== null && t.at >= t.openAt).map((t) => ({ pnl: t.pnl, ms: t.at - (t.openAt ?? t.at) }));
	return {
		winners: mean(held.filter((h) => h.pnl > 0).map((h) => h.ms)),
		losers: mean(held.filter((h) => h.pnl < 0).map((h) => h.ms)),
		all: mean(held.map((h) => h.ms)),
		known: held.length,
	};
}

/** Lots or contracts traded, over the trades whose volume is written; null when none is. */
export function volumeStats(trades: DashTrade[]): { total: number; average: number; known: number } | null {
	const v = trades.map((t) => t.volume).filter((x): x is number => x !== null && x > 0);
	return v.length ? { total: sum(v), average: sum(v) / v.length, known: v.length } : null;
}

// ── Advanced metrics ────────────────────────────────────────────────────────

export interface AdvancedMetrics extends Summary {
	days: number;
	sharpe: number | null;
	calmar: number | null;
	/** Net P&L ÷ max drawdown; null without a drawdown. */
	recovery: number | null;
	avgPerDay: number | null;
	dayStdDev: number | null;
	maxDrawdown: number;
	underPeak: UnderPeak | null;
	largestWin: DashTrade | null;
	largestLoss: DashTrade | null;
	/** Share of trades at exactly zero, in %. */
	breakEvenRate: number | null;
	streaks: Streaks;
	hold: HoldTimes;
	tradesPerDay: number | null;
	volume: { total: number; average: number; known: number } | null;
	/** Commission and swap added up (a cost is negative), and how many trades carry one. */
	fees: { total: number; known: number };
	/** Result before commission and swap. */
	gross: number;
}

/** Every figure of the advanced metrics, for trades of one currency. */
export function advancedMetrics(trades: DashTrade[], now: number): AdvancedMetrics {
	const sorted = byTime(trades);
	const s = summarize(sorted);
	const daily = dailyResults(sorted).map((d) => d.pnl);
	const dd = maxDrawdown(sorted);
	const fees = sum(sorted.map((t) => t.fees));
	let largestWin: DashTrade | null = null;
	let largestLoss: DashTrade | null = null;
	for (const t of sorted) {
		if (t.pnl > 0 && (!largestWin || t.pnl > largestWin.pnl)) largestWin = t;
		if (t.pnl < 0 && (!largestLoss || t.pnl < largestLoss.pnl)) largestLoss = t;
	}
	return {
		...s,
		days: daily.length,
		sharpe: sharpe(daily),
		calmar: calmar(daily, dd),
		recovery: dd > 0 ? s.net / dd : null,
		avgPerDay: daily.length ? s.net / daily.length : null,
		dayStdDev: stdDev(daily),
		maxDrawdown: dd,
		underPeak: underPeak(sorted, now),
		largestWin,
		largestLoss,
		breakEvenRate: sorted.length ? (s.evens / sorted.length) * 100 : null,
		streaks: streaks(sorted.map((t) => t.pnl)),
		hold: holdTimes(sorted),
		tradesPerDay: daily.length ? sorted.length / daily.length : null,
		volume: volumeStats(sorted),
		fees: { total: fees, known: sorted.filter((t) => t.fees !== 0).length },
		gross: s.net - fees,
	};
}

// ── Rolling figures ─────────────────────────────────────────────────────────

export interface RollingPoint {
	trade: DashTrade;
	/** Win rate of the last `window` trades, break-even left out; null when they are all at zero. */
	winRate: number | null;
	avgWin: number | null;
	/** Average loss of the window, as a positive amount, to compare with the average win. */
	avgLoss: number | null;
}

/** Figures over the last `window` trades, after each trade from the `window`-th on. */
export function rolling(trades: DashTrade[], window: number): RollingPoint[] {
	const sorted = byTime(trades);
	const out: RollingPoint[] = [];
	for (let i = window - 1; i < sorted.length; i++) {
		const s = summarize(sorted.slice(i - window + 1, i + 1));
		out.push({ trade: sorted[i], winRate: s.winRate, avgWin: s.avgWin, avgLoss: s.avgLoss === null ? null : -s.avgLoss });
	}
	return out;
}

// ── Long and short ──────────────────────────────────────────────────────────

export function bySide(trades: DashTrade[]): { long: Summary; short: Summary } {
	return { long: summarize(trades.filter((t) => t.side === "long")), short: summarize(trades.filter((t) => t.side === "short")) };
}

/** Cumulative P&L of the longs and of the shorts, after each trade of either side. */
export function sideCurves(trades: DashTrade[]): { trade: DashTrade; long: number; short: number; longN: number; shortN: number }[] {
	let long = 0;
	let short = 0;
	let longN = 0;
	let shortN = 0;
	return byTime(trades).map((t) => {
		if (t.side === "long") {
			long += t.pnl;
			longN++;
		} else {
			short += t.pnl;
			shortN++;
		}
		return { trade: t, long, short, longN, shortN };
	});
}

// ── Hours ───────────────────────────────────────────────────────────────────

export interface HourBucket {
	hour: number;
	trades: number;
	net: number;
	wins: number;
	losses: number;
	/** Different days traded at this hour. */
	days: number;
}

/** Results by hour of the open, in the journal time zone; trades without an open time are counted apart. */
export function byHour(trades: DashTrade[]): { buckets: HourBucket[]; unknown: number } {
	const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, trades: 0, net: 0, wins: 0, losses: 0, days: 0 }));
	const days = Array.from({ length: 24 }, () => new Set<string>());
	let unknown = 0;
	for (const t of trades) {
		if (t.hour === null || t.hour < 0 || t.hour > 23) {
			unknown++;
			continue;
		}
		const b = buckets[t.hour];
		b.trades++;
		b.net += t.pnl;
		if (t.pnl > 0) b.wins++;
		else if (t.pnl < 0) b.losses++;
		days[t.hour].add(t.day);
	}
	buckets.forEach((b, i) => (b.days = days[i].size));
	return { buckets, unknown };
}

/** Trades an hour needs before it can be called the best or the worst: 3, or 5 % of the trades. */
export function hourSample(known: number): number {
	return Math.max(3, Math.ceil(known * 0.05));
}

/**
 * The hour with the highest net result (`best`) or the lowest (`worst`), among hours
 * traded often enough (`minTrades`, on two days at least), so one lucky trade does
 * not make an hour. Null when no such hour made money (best) or lost it (worst).
 */
export function rankHour(buckets: HourBucket[], minTrades: number, which: "best" | "worst"): HourBucket | null {
	const ok = buckets.filter((b) => b.trades >= minTrades && b.days >= 2 && (which === "best" ? b.net > 0 : b.net < 0));
	if (!ok.length) return null;
	return ok.reduce((a, b) => (which === "best" ? (b.net > a.net ? b : a) : b.net < a.net ? b : a));
}

// ── Groups: symbols, tags ───────────────────────────────────────────────────

function groupOf(label: string, ts: DashTrade[]): Group {
	const s = summarize(ts);
	return { label, trades: s.trades, net: s.net, winRate: s.winRate, expectancy: s.expectancy ?? 0 };
}

/**
 * Results by key (symbol, tag), sorted by net result. Over `n + 1` groups, the `n`
 * that weigh most (largest gain or loss) are kept and the rest is merged into one
 * "others" group, where a trade counts once even with several of the keys.
 */
export function topGroups(trades: DashTrade[], keysOf: (t: DashTrade) => string[], n = 8): { groups: Group[]; others: (Group & { count: number }) | null } {
	const m = new Map<string, DashTrade[]>();
	for (const t of trades) {
		for (const k of new Set(keysOf(t))) {
			const list = m.get(k);
			if (list) list.push(t);
			else m.set(k, [t]);
		}
	}
	const all = [...m].map(([label, ts]) => groupOf(label, ts));
	const byNet = (a: Group, b: Group): number => b.net - a.net || a.label.localeCompare(b.label);
	if (all.length <= n + 1) return { groups: all.sort(byNet), others: null };
	const kept = [...all].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.trades - a.trades).slice(0, n);
	const keptLabels = new Set(kept.map((g) => g.label));
	const rest = all.filter((g) => !keptLabels.has(g.label));
	const restLabels = new Set(rest.map((g) => g.label));
	const restTrades = trades.filter((t) => keysOf(t).some((k) => restLabels.has(k)));
	return { groups: kept.sort(byNet), others: { ...groupOf("", restTrades), count: rest.length } };
}

/** Tags of a trade other than its setups and its mistakes, which have their own widgets. */
export function otherTags(t: DashTrade, categories: Record<string, string>): string[] {
	return t.tags.filter((tag) => {
		const c = (categories[tag] ?? "").toLowerCase();
		return c !== "setups" && c !== "mistakes";
	});
}

// ── Year map ────────────────────────────────────────────────────────────────

export interface HeatCell {
	day: string;
	/** Net result of the day, null when nothing was traded. */
	pnl: number | null;
	trades: number;
	/** -4 to 4: sign of the result and its strength; 0 for a day at zero or not traded. */
	level: number;
	/** After the last day of the map. */
	future: boolean;
}

/**
 * Scale of the colours: the 90th percentile of the size of the daily results (nearest
 * rank), so that one exceptional day does not wash out all the others.
 */
export function heatScale(values: number[]): number {
	const abs = values.map((v) => Math.abs(v)).filter((v) => v > 0).sort((a, b) => a - b);
	if (!abs.length) return 0;
	return abs[Math.max(0, Math.ceil(abs.length * 0.9) - 1)];
}

export function heatLevel(pnl: number, scale: number): number {
	if (pnl === 0 || scale <= 0) return 0;
	return Math.sign(pnl) * Math.max(1, Math.ceil(Math.min(1, Math.abs(pnl) / scale) * 4));
}

/**
 * Weeks of the map, Monday first, the last one holding `endDay`. `months` gives the
 * week where each month starts, for the labels.
 */
export function yearGrid(
	days: Map<string, { pnl: number; trades: number }>,
	endDay: string,
	weeks = 53,
): { weeks: HeatCell[][]; months: { week: number; month: number; year: number }[]; scale: number; traded: number; net: number } {
	const first = addDays(mondayOf(endDay), -7 * (weeks - 1));
	const inRange = [...days].filter(([d]) => d >= first && d <= endDay);
	const scale = heatScale(inRange.map(([, v]) => v.pnl));
	const grid: HeatCell[][] = [];
	const months: { week: number; month: number; year: number }[] = [];
	for (let w = 0; w < weeks; w++) {
		const col: HeatCell[] = [];
		for (let d = 0; d < 7; d++) {
			const day = addDays(first, w * 7 + d);
			const v = day <= endDay ? days.get(day) : undefined;
			col.push({ day, pnl: v ? v.pnl : null, trades: v?.trades ?? 0, level: v ? heatLevel(v.pnl, scale) : 0, future: day > endDay });
			if (day.endsWith("-01")) months.push({ week: w, month: Number(day.slice(5, 7)) - 1, year: Number(day.slice(0, 4)) });
		}
		grid.push(col);
	}
	return { weeks: grid, months, scale, traded: inRange.length, net: sum(inRange.map(([, v]) => v.pnl)) };
}

// ── The week ────────────────────────────────────────────────────────────────

export interface WeekStats extends Summary {
	monday: string;
	/** Monday to Sunday. */
	days: { day: string; pnl: number | null; trades: number }[];
	daysTraded: number;
	best: { day: string; pnl: number } | null;
	worst: { day: string; pnl: number } | null;
}

export function weekStats(trades: DashTrade[], monday: string): WeekStats {
	const sunday = addDays(monday, 6);
	const of = trades.filter((t) => t.day >= monday && t.day <= sunday);
	const results = dailyResults(of);
	const byDay = new Map(results.map((d) => [d.day, d]));
	let best: WeekStats["best"] = null;
	let worst: WeekStats["worst"] = null;
	for (const d of results) {
		if (!best || d.pnl > best.pnl) best = { day: d.day, pnl: d.pnl };
		if (!worst || d.pnl < worst.pnl) worst = { day: d.day, pnl: d.pnl };
	}
	return {
		...summarize(of),
		monday,
		days: Array.from({ length: 7 }, (_, i) => {
			const day = addDays(monday, i);
			const d = byDay.get(day);
			return { day, pnl: d ? d.pnl : null, trades: d?.trades ?? 0 };
		}),
		daysTraded: results.length,
		best,
		worst,
	};
}

/** The week holding `today`, and the one before. */
export function weekSummary(trades: DashTrade[], today: string): { current: WeekStats; previous: WeekStats } {
	const monday = mondayOf(today);
	return { current: weekStats(trades, monday), previous: weekStats(trades, addDays(monday, -7)) };
}

// ── Trading score ───────────────────────────────────────────────────────────

export type ScorePartId = "profitFactor" | "winRate" | "payoff" | "greenDays" | "discipline" | "recovery";

/** Each part scores 0 at `zero` and 100 at `full`, in a straight line between, and counts for `weight` %. */
export const SCORE_RULES: { id: ScorePartId; weight: number; zero: number; full: number }[] = [
	{ id: "profitFactor", weight: 25, zero: 1, full: 2 },
	{ id: "winRate", weight: 15, zero: 30, full: 60 },
	{ id: "payoff", weight: 15, zero: 0.5, full: 2 },
	{ id: "greenDays", weight: 15, zero: 30, full: 70 },
	{ id: "discipline", weight: 15, zero: 50, full: 100 },
	{ id: "recovery", weight: 15, zero: 0, full: 3 },
];

/** Decisive trades and trading days the score needs before it means something. */
export const SCORE_MIN_TRADES = 10;
export const SCORE_MIN_DAYS = 3;
/** Trades with "followed the plan" filled in, for discipline to count. */
export const SCORE_MIN_RATED = 5;

export interface ScorePart {
	id: ScorePartId;
	weight: number;
	zero: number;
	full: number;
	/** The figure measured; Infinity when there is nothing to divide by (no loss); null when it cannot be measured. */
	value: number | null;
	/** 0 to 100, null when the part is left out. */
	points: number | null;
}

export interface TradingScore {
	/** 0 to 100, null while there are too few trades. */
	score: number | null;
	parts: ScorePart[];
	decisive: number;
	days: number;
	/** Weight of the parts that count, 100 when none is left out. */
	weightUsed: number;
}

export function scorePoints(value: number, zero: number, full: number): number {
	if (value === Infinity) return 100;
	return Math.max(0, Math.min(1, (value - zero) / (full - zero))) * 100;
}

/**
 * A grade out of 100 made of six parts, each shown with its rule: profit factor, win
 * rate, payoff, share of winning days, discipline (when the plan is filled in on 5
 * trades at least) and net result ÷ max drawdown. A part that cannot be measured is
 * left out and the others share its weight.
 */
export function tradingScore(trades: DashTrade[]): TradingScore {
	const sorted = byTime(trades);
	const s = summarize(sorted);
	const days = dailyResults(sorted);
	const decisiveDays = days.filter((d) => d.pnl !== 0);
	const rated = sorted.filter((t) => t.followedPlan !== null);
	const dd = maxDrawdown(sorted);
	const values: Record<ScorePartId, number | null> = {
		profitFactor: s.grossLoss > 0 ? s.grossWin / s.grossLoss : s.wins ? Infinity : null,
		winRate: s.winRate,
		payoff: s.wins && s.losses ? s.payoff : s.wins ? Infinity : s.losses ? 0 : null,
		greenDays: decisiveDays.length ? (decisiveDays.filter((d) => d.pnl > 0).length / decisiveDays.length) * 100 : null,
		discipline: rated.length >= SCORE_MIN_RATED ? (rated.filter((t) => t.followedPlan).length / rated.length) * 100 : null,
		recovery: !sorted.length ? null : dd > 0 ? s.net / dd : s.net > 0 ? Infinity : 0,
	};
	const parts = SCORE_RULES.map((r) => {
		const value = values[r.id];
		return { ...r, value, points: value === null ? null : scorePoints(value, r.zero, r.full) };
	});
	const counted = parts.filter((p) => p.points !== null);
	const weightUsed = sum(counted.map((p) => p.weight));
	const enough = s.wins + s.losses >= SCORE_MIN_TRADES && days.length >= SCORE_MIN_DAYS;
	return {
		score: enough && weightUsed ? Math.round(sum(counted.map((p) => (p.points ?? 0) * p.weight)) / weightUsed) : null,
		parts,
		decisive: s.wins + s.losses,
		days: days.length,
		weightUsed,
	};
}

// ── Goals ───────────────────────────────────────────────────────────────────

export interface Goal {
	/** Result to reach in a calendar month. */
	month?: number | null;
	/** Loss not to go beyond in a day, as a positive amount. */
	dayLoss?: number | null;
}

export interface GoalStatus {
	/** "YYYY-MM" of `today`. */
	month: string;
	monthNet: number;
	monthTrades: number;
	/** Month result ÷ target, null without a target. */
	progress: number | null;
	/** What is left to reach the target, zero once reached; null without a target. */
	remaining: number | null;
	todayNet: number;
	todayTrades: number;
	/** Share of the daily limit lost today, 0 on a winning day; null without a limit. */
	used: number | null;
	/** Today's loss reached the limit. */
	breached: boolean;
	/** Days of the month whose loss reached the limit. */
	breachedDays: string[];
}

/** An amount typed by the trader: "1 250,50", "1250.5" → 1250.5; empty → null; not a positive number → undefined. */
export function parseAmount(text: string): number | null | undefined {
	// \s also matches the no-break spaces of thousands separators.
	const s = text.replace(/\s/g, "").replace(",", ".");
	if (!s) return null;
	const v = Number(s);
	return Number.isFinite(v) && v > 0 ? v : undefined;
}

export function goalStatus(trades: DashTrade[], goal: Goal, today: string): GoalStatus {
	const month = today.slice(0, 7);
	const ofMonth = trades.filter((t) => t.day.startsWith(`${month}-`) && t.day <= today);
	const monthNet = sum(ofMonth.map((t) => t.pnl));
	const ofToday = ofMonth.filter((t) => t.day === today);
	const todayNet = sum(ofToday.map((t) => t.pnl));
	const target = goal.month && goal.month > 0 ? goal.month : null;
	const limit = goal.dayLoss && goal.dayLoss > 0 ? goal.dayLoss : null;
	return {
		month,
		monthNet,
		monthTrades: ofMonth.length,
		progress: target === null ? null : monthNet / target,
		remaining: target === null ? null : Math.max(0, target - monthNet),
		todayNet,
		todayTrades: ofToday.length,
		used: limit === null ? null : Math.max(0, -todayNet) / limit,
		breached: limit !== null && todayNet <= -limit,
		breachedDays: limit === null ? [] : dailyResults(ofMonth).filter((d) => d.pnl <= -limit).map((d) => d.day),
	};
}
