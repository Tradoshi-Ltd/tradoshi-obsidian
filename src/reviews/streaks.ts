import { periodOf, type Period } from "./periods";

// Review streaks and what is left to review. A period still running (today, this week)
// is pending: reviewed, it counts; not yet reviewed, it neither counts nor breaks the
// streak. Pure: no Obsidian.

export interface Streak {
	/** Reviewed in a row, up to the latest finished one. */
	current: number;
	/** The longest run ever. */
	best: number;
}

/**
 * Streak over items in time order, each reviewed or not. Items flagged `pending`
 * (today's, this week's) count when reviewed and are skipped when not.
 */
export function streakOf(items: { reviewed: boolean; pending: boolean }[]): Streak {
	let best = 0;
	let run = 0;
	for (const it of items) {
		if (it.reviewed) best = Math.max(best, ++run);
		else if (!it.pending) run = 0;
	}
	let current = 0;
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i];
		if (it.reviewed) current++;
		else if (it.pending) continue;
		else break;
	}
	return { current, best };
}

export interface TradingDay {
	day: string;
	reviewed: boolean;
}

/** Trading days reviewed in a row. Today is pending; days after today are left out. */
export function dayStreak(days: TradingDay[], today: string): Streak {
	return streakOf(
		[...days]
			.filter((d) => d.day <= today)
			.sort((a, b) => a.day.localeCompare(b.day))
			.map((d) => ({ reviewed: d.reviewed, pending: d.day === today })),
	);
}

/** Trades reviewed in a row, by close. Today's trades are pending. */
export function tradeStreak(trades: { at: number; day: string; reviewed: boolean }[], today: string): Streak {
	return streakOf(
		[...trades]
			.filter((t) => t.day <= today)
			.sort((a, b) => a.at - b.at)
			.map((t) => ({ reviewed: t.reviewed, pending: t.day === today })),
	);
}

/** The weeks that hold at least one trading day, oldest first. */
export function tradedWeeks(days: string[]): Period[] {
	const m = new Map<string, Period>();
	for (const d of days) {
		const w = periodOf("week", d);
		if (!m.has(w.id)) m.set(w.id, w);
	}
	return [...m.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** Traded weeks reviewed in a row. The current week is pending. */
export function weekStreak(weeks: Period[], reviewed: ReadonlySet<string>, today: string): Streak {
	return streakOf(
		[...weeks]
			.filter((w) => w.start <= today)
			.sort((a, b) => a.start.localeCompare(b.start))
			.map((w) => ({ reviewed: reviewed.has(w.id), pending: w.end >= today })),
	);
}

export interface ReviewTodo {
	/** Trading days whose day note is not marked reviewed, latest first; today included. */
	days: string[];
	/** Finished weeks with trades and no review marked done, latest first. */
	weeks: Period[];
}

/** What is left to review. */
export function reviewTodo(days: TradingDay[], reviewedWeeks: ReadonlySet<string>, today: string): ReviewTodo {
	const open = days.filter((d) => !d.reviewed && d.day <= today).map((d) => d.day);
	const weeks = tradedWeeks(days.filter((d) => d.day <= today).map((d) => d.day)).filter((w) => w.end < today && !reviewedWeeks.has(w.id));
	return {
		days: [...new Set(open)].sort().reverse(),
		weeks: weeks.reverse(),
	};
}
