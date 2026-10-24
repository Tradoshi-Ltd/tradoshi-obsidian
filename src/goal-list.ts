// Goals the trader sets: a measure (result, trades, win rate, average R, trades reviewed)
// over a day, a week or a month, at least or at most a target, on one account or all.
// Pure: no Obsidian, so it can be tested.

export type GoalMetric = "pnl" | "trades" | "winRate" | "avgR" | "reviewed";
export type GoalPeriod = "day" | "week" | "month";

export interface GoalItem {
	id: string;
	metric: GoalMetric;
	period: GoalPeriod;
	/** "atLeast": reach the target; "atMost": stay under it (trades a day, losses…). */
	direction: "atLeast" | "atMost";
	target: number;
	/** An account name, or "all". */
	account: string;
}

export interface GoalTrade {
	account: string;
	day: string;
	pnl: number;
	r: number | null;
	reviewed: boolean;
	currency: string;
}

export interface GoalResult {
	/** The measure so far, null when there is nothing to measure yet. */
	value: number | null;
	/** Share of the target: 1 is the target. */
	progress: number | null;
	/** Reached (at least) or kept (at most); null while an "at least" goal is still open. */
	met: boolean | null;
	/** First and last day of the period. */
	from: string;
	to: string;
	trades: number;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const key = (d: Date): string => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** First and last day of the period that holds `today`, weeks starting on Monday. */
export function periodBounds(period: GoalPeriod, today: string): { from: string; to: string } {
	if (period === "day") return { from: today, to: today };
	const d = new Date(`${today}T12:00:00Z`);
	if (period === "week") {
		const monday = new Date(d);
		monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
		const sunday = new Date(monday);
		sunday.setUTCDate(monday.getUTCDate() + 6);
		return { from: key(monday), to: key(sunday) };
	}
	const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12));
	const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
	return { from: key(first), to: key(last) };
}

export function measure(metric: GoalMetric, trades: GoalTrade[]): number | null {
	if (!trades.length) return metric === "pnl" || metric === "trades" ? 0 : null;
	switch (metric) {
		case "pnl":
			return trades.reduce((s, t) => s + t.pnl, 0);
		case "trades":
			return trades.length;
		case "winRate": {
			const wins = trades.filter((t) => t.pnl > 0).length;
			const losses = trades.filter((t) => t.pnl < 0).length;
			return wins + losses ? (wins / (wins + losses)) * 100 : null;
		}
		case "avgR": {
			const rs = trades.map((t) => t.r).filter((r): r is number => r !== null);
			return rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null;
		}
		case "reviewed":
			return (trades.filter((t) => t.reviewed).length / trades.length) * 100;
	}
}

/**
 * Where a goal stands today. Money goals count the trades of `currency` only. An "at least"
 * goal is met once reached; it fails only when its period is over. An "at most" goal is
 * kept until the measure goes beyond it.
 */
export function evaluateGoal(goal: GoalItem, trades: GoalTrade[], today: string, currency: string): GoalResult {
	const { from, to } = periodBounds(goal.period, today);
	const own = trades.filter((t) => t.day >= from && t.day <= today && (goal.account === "all" || t.account === goal.account) && (goal.metric !== "pnl" || t.currency === currency));
	const value = measure(goal.metric, own);
	const progress = value === null || !goal.target ? null : value / goal.target;
	let met: boolean | null = null;
	if (value !== null) {
		if (goal.direction === "atMost") met = value <= goal.target;
		else if (value >= goal.target) met = true;
		else if (today > to) met = false;
	}
	return { value, progress, met, from, to, trades: own.length };
}
