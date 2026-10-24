import { dailyResults, maxDrawdown, summarize, type Summary } from "../stats-advanced";
import { byCategory, mainCurrency, type DashTrade, type Group } from "../stats";
import { childrenOf, contains, daysOf, type Period } from "./periods";

// Figures of the reviews: a trading day for its report card, and a week, a month, a
// quarter or a year against the one before. Pure: no Obsidian. Money figures use one
// currency, the one most trades are in; trades in another currency are counted apart.

export interface DayFigures extends Summary {
	currency: string;
	/** Trades left out of money figures because they are in another currency. */
	otherCurrency: number;
	best: DashTrade | null;
	worst: DashTrade | null;
	/** Sum of the R multiples known, and how many trades have one. */
	rTotal: number | null;
	rKnown: number;
	/** Trades where the plan was followed, over those where it is known. */
	planFollowed: number;
	planKnown: number;
	/** Trades carrying a tag of the Mistakes category. */
	mistakes: number;
}

const isMistake = (t: DashTrade, categories: Record<string, string>): boolean => t.tags.some((tag) => (categories[tag] ?? "").toLowerCase() === "mistakes");

export function dayFigures(trades: DashTrade[], categories: Record<string, string>, currency: string = mainCurrency(trades)): DayFigures {
	const same = trades.filter((t) => t.currency === currency);
	const s = summarize(same);
	const sorted = [...same].sort((a, b) => b.pnl - a.pnl);
	const rs = trades.map((t) => t.r).filter((r): r is number => r !== null);
	const known = trades.filter((t) => t.followedPlan !== null);
	return {
		...s,
		currency,
		otherCurrency: trades.length - same.length,
		best: sorted.length && sorted[0].pnl > 0 ? sorted[0] : null,
		worst: sorted.length && sorted[sorted.length - 1].pnl < 0 ? sorted[sorted.length - 1] : null,
		rTotal: rs.length ? rs.reduce((a, b) => a + b, 0) : null,
		rKnown: rs.length,
		planFollowed: known.filter((t) => t.followedPlan === true).length,
		planKnown: known.length,
		mistakes: trades.filter((t) => isMistake(t, categories)).length,
	};
}

export interface CurvePoint {
	at: number;
	value: number;
	/** The trade closed at this point; null for the starting point. */
	trade: DashTrade | null;
}

/** Cumulative P&L through the day, trade by trade, from zero at the first open. */
export function intraday(trades: DashTrade[], currency: string): CurvePoint[] {
	const same = trades.filter((t) => t.currency === currency).sort((a, b) => a.at - b.at);
	if (!same.length) return [];
	const firstOpen = Math.min(...same.map((t) => t.openAt ?? t.at));
	const start = Math.min(firstOpen, same[0].at - 60000);
	let cum = 0;
	return [{ at: start, value: 0, trade: null }, ...same.map((t) => ({ at: t.at, value: (cum += t.pnl), trade: t }))];
}

export interface PeriodFigures extends Summary {
	currency: string;
	maxDrawdown: number;
	avgR: number | null;
	rKnown: number;
	tradingDays: number;
	greenDays: number;
	redDays: number;
	bestDay: { day: string; pnl: number } | null;
	worstDay: { day: string; pnl: number } | null;
	/** Trades where the plan was followed, in %, over those where it is known. */
	planRate: number | null;
}

/** Trades whose trading day falls in the period. */
export function tradesIn(p: Period, trades: DashTrade[]): DashTrade[] {
	return trades.filter((t) => contains(p, t.day));
}

export function periodFigures(trades: DashTrade[], currency: string): PeriodFigures {
	const same = trades.filter((t) => t.currency === currency).sort((a, b) => a.at - b.at);
	const s = summarize(same);
	const days = dailyResults(same);
	const rs = same.map((t) => t.r).filter((r): r is number => r !== null);
	const known = same.filter((t) => t.followedPlan !== null);
	let bestDay: PeriodFigures["bestDay"] = null;
	let worstDay: PeriodFigures["worstDay"] = null;
	for (const d of days) {
		if (d.pnl > 0 && (!bestDay || d.pnl > bestDay.pnl)) bestDay = { day: d.day, pnl: d.pnl };
		if (d.pnl < 0 && (!worstDay || d.pnl < worstDay.pnl)) worstDay = { day: d.day, pnl: d.pnl };
	}
	return {
		...s,
		currency,
		maxDrawdown: maxDrawdown(same),
		avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
		rKnown: rs.length,
		tradingDays: days.length,
		greenDays: days.filter((d) => d.pnl > 0).length,
		redDays: days.filter((d) => d.pnl < 0).length,
		bestDay,
		worstDay,
		planRate: known.length ? (known.filter((t) => t.followedPlan === true).length / known.length) * 100 : null,
	};
}

/** A figure against the previous period: the change, null when either side is unknown. */
export function delta(current: number | null, previous: number | null): number | null {
	return current === null || previous === null ? null : current - previous;
}

export interface BreakdownRow {
	period: Period;
	trades: number;
	net: number;
	winRate: number | null;
	wins: number;
	losses: number;
}

/**
 * The period split one level down, each part with its figures: the days of a week
 * (Saturday and Sunday only when traded), the weeks of a month, the months of a
 * quarter, the months of a year.
 */
export function breakdown(p: Period, trades: DashTrade[], currency: string): BreakdownRow[] {
	const parts = p.kind === "year" ? childrenOf(p).flatMap((q) => childrenOf(q)) : childrenOf(p);
	const same = trades.filter((t) => t.currency === currency);
	return parts
		.map((part) => {
			const ts = part.kind === "week" ? same.filter((t) => contains(part, t.day) && contains(p, t.day)) : tradesIn(part, same);
			const s = summarize(ts);
			return { period: part, trades: s.trades, net: s.net, winRate: s.winRate, wins: s.wins, losses: s.losses };
		})
		.filter((row) => {
			if (p.kind !== "week") return true;
			const weekday = daysOf(p).indexOf(row.period.start);
			return weekday < 5 || row.trades > 0;
		});
}

/**
 * Cumulative P&L at the end of each day of the period, for the period and the one
 * before laid over it: day 1 against day 1. Days still to come are null.
 */
export function cumulativeByDay(p: Period, trades: DashTrade[], currency: string, today: string): (number | null)[] {
	const byDay = new Map<string, number>();
	for (const t of trades) if (t.currency === currency && contains(p, t.day)) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.pnl);
	let cum = 0;
	return daysOf(p).map((d) => (d > today ? null : (cum += byDay.get(d) ?? 0)));
}

/** The best and the worst trades of a set, `n` of each; a trade is never in both. */
export function topTrades(trades: DashTrade[], currency: string, n = 3): { best: DashTrade[]; worst: DashTrade[] } {
	const same = trades.filter((t) => t.currency === currency);
	const best = [...same].filter((t) => t.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, n);
	const worst = [...same].filter((t) => t.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, n);
	return { best, worst };
}

/** Setups ranked by result, and mistakes ranked by what they cost. */
export function setupsAndMistakes(trades: DashTrade[], categories: Record<string, string>, currency: string): { setups: Group[]; mistakes: Group[] } {
	return {
		setups: byCategory(trades, categories, "Setups", currency),
		mistakes: byCategory(trades, categories, "Mistakes", currency).sort((a, b) => a.net - b.net),
	};
}
