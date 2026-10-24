// Journal statistics for the dashboard. Pure: no Obsidian, no DOM, so every figure
// can be tested. All money figures are in one currency; trades in other currencies
// are left out of money figures and counted apart.

export interface DashTrade {
	key: string;
	/** Path of the trade note, when there is one. */
	path: string | null;
	account: string;
	currency: string;
	symbol: string;
	side: "long" | "short";
	/** Close (or open while running), milliseconds since epoch. */
	at: number;
	/** Trading day, YYYY-MM-DD, as written in the notes. */
	day: string;
	/** Hour of the open in the journal time zone, 0 to 23, when known. */
	hour: number | null;
	/** Open, milliseconds since epoch, when known. */
	openAt: number | null;
	pnl: number;
	r: number | null;
	emotion: string | null;
	followedPlan: boolean | null;
	tags: string[];
	entry: number | null;
	exit: number | null;
	volume: number | null;
	stopLoss: number | null;
	takeProfit: number | null;
	/** Commission and swap, as written in the note (a cost is negative). */
	fees: number;
	/** The trader's own grade of the trade, when given. */
	rating: number | null;
	broker: string | null;
}

export interface Kpis {
	currency: string;
	trades: number;
	/** Trades left out of money figures because they are in another currency. */
	otherCurrency: number;
	net: number;
	winRate: number | null;
	profitFactor: number | null;
	expectancy: number | null;
	avgR: number | null;
	/** Trades with a known R multiple, to show how much the average R covers. */
	rCoverage: number;
	maxDrawdown: number;
	bestDay: { day: string; pnl: number } | null;
}

/** The currency most trades are in. */
export function mainCurrency(trades: DashTrade[]): string {
	const count = new Map<string, number>();
	for (const t of trades) count.set(t.currency, (count.get(t.currency) ?? 0) + 1);
	let best = "USD";
	let n = -1;
	for (const [c, k] of count) if (k > n) [best, n] = [c, k];
	return best;
}

export function inPeriod(trades: DashTrade[], days: number, now: number): DashTrade[] {
	if (!days) return trades;
	const from = now - days * 86400000;
	return trades.filter((t) => t.at > from);
}

const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);

export function kpis(trades: DashTrade[], currency: string = mainCurrency(trades)): Kpis {
	const same = trades.filter((t) => t.currency === currency).sort((a, b) => a.at - b.at);
	const wins = same.filter((t) => t.pnl > 0);
	const losses = same.filter((t) => t.pnl < 0);
	const grossWin = sum(wins.map((t) => t.pnl));
	const grossLoss = -sum(losses.map((t) => t.pnl));
	const net = grossWin - grossLoss;
	const rs = trades.map((t) => t.r).filter((r): r is number => r !== null);

	let cum = 0;
	let peak = 0;
	let dd = 0;
	for (const t of same) {
		cum += t.pnl;
		peak = Math.max(peak, cum);
		dd = Math.max(dd, peak - cum);
	}

	const days = dayTotals(same);
	let bestDay: Kpis["bestDay"] = null;
	for (const [day, v] of days) if (!bestDay || v.pnl > bestDay.pnl) bestDay = { day, pnl: v.pnl };

	return {
		currency,
		trades: trades.length,
		otherCurrency: trades.length - same.length,
		net,
		winRate: wins.length + losses.length ? (wins.length / (wins.length + losses.length)) * 100 : null,
		profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
		expectancy: same.length ? net / same.length : null,
		avgR: rs.length ? sum(rs) / rs.length : null,
		rCoverage: rs.length,
		maxDrawdown: dd,
		bestDay: bestDay && bestDay.pnl > 0 ? bestDay : null,
	};
}

/** Cumulative P&L after each trade, oldest first. */
export function equity(trades: DashTrade[], currency: string): { at: number; value: number; trade: DashTrade }[] {
	let cum = 0;
	return trades
		.filter((t) => t.currency === currency)
		.sort((a, b) => a.at - b.at)
		.map((t) => ({ at: t.at, value: (cum += t.pnl), trade: t }));
}

export function dayTotals(trades: DashTrade[]): Map<string, { pnl: number; trades: number }> {
	const m = new Map<string, { pnl: number; trades: number }>();
	for (const t of trades) {
		const v = m.get(t.day) ?? { pnl: 0, trades: 0 };
		v.pnl += t.pnl;
		v.trades++;
		m.set(t.day, v);
	}
	return m;
}

export interface Group {
	label: string;
	trades: number;
	net: number;
	winRate: number | null;
	expectancy: number;
}

function group(trades: DashTrade[], keysOf: (t: DashTrade) => string[]): Group[] {
	const m = new Map<string, DashTrade[]>();
	for (const t of trades) for (const k of keysOf(t)) m.set(k, [...(m.get(k) ?? []), t]);
	return [...m]
		.map(([label, ts]) => {
			const w = ts.filter((t) => t.pnl > 0).length;
			const l = ts.filter((t) => t.pnl < 0).length;
			const net = sum(ts.map((t) => t.pnl));
			return { label, trades: ts.length, net, winRate: w + l ? (w / (w + l)) * 100 : null, expectancy: net / ts.length };
		})
		.sort((a, b) => b.net - a.net);
}

/** Results by tag of one category ("Setups", "Mistakes"…), in the main currency. */
export function byCategory(trades: DashTrade[], categories: Record<string, string>, category: string, currency: string): Group[] {
	const wanted = category.toLowerCase();
	return group(
		trades.filter((t) => t.currency === currency),
		(t) => t.tags.filter((tag) => (categories[tag] ?? "").toLowerCase() === wanted),
	);
}

export function byEmotion(trades: DashTrade[], currency: string): Group[] {
	return group(trades.filter((t) => t.currency === currency), (t) => (t.emotion ? [t.emotion] : []));
}

/** Expectancy when the plan was followed, and when it was not. */
export function planSplit(trades: DashTrade[], currency: string): { followed: Group | null; broken: Group | null } {
	const g = group(
		trades.filter((t) => t.currency === currency),
		(t) => (t.followedPlan === true ? ["followed"] : t.followedPlan === false ? ["broken"] : []),
	);
	return { followed: g.find((x) => x.label === "followed") ?? null, broken: g.find((x) => x.label === "broken") ?? null };
}

/** P&L by day of the week, Monday first. Saturday and Sunday only count when traded. */
export function byWeekday(trades: DashTrade[], currency: string): { day: number; pnl: number; trades: number }[] {
	const out = Array.from({ length: 7 }, (_, day) => ({ day, pnl: 0, trades: 0 }));
	for (const t of trades) {
		if (t.currency !== currency) continue;
		const d = (new Date(`${t.day}T12:00:00Z`).getUTCDay() + 6) % 7;
		out[d].pnl += t.pnl;
		out[d].trades++;
	}
	return out.filter((x) => x.day < 5 || x.trades > 0);
}
