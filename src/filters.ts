import type { DashTrade } from "./stats";

// Filters of the dashboard and the trade log. Pure, so they can be tested.

export interface TradeFilters {
	symbols: string[];
	/** Setup tags (category "Setups"): a trade matches when it has one of them. */
	setups: string[];
	/** Other tags to require. */
	tags: string[];
	/** "any": one of the tags is enough; "all": every tag is needed. */
	tagMode: "any" | "all";
	/** Tags that leave a trade out, whatever the rest. */
	excludeTags: string[];
	side: "all" | "long" | "short";
	/** "all", "win" (P&L above zero) or "loss" (below zero). */
	outcome: "all" | "win" | "loss";
}

export const NO_FILTERS: TradeFilters = { symbols: [], setups: [], tags: [], tagMode: "any", excludeTags: [], side: "all", outcome: "all" };

export function activeFilterCount(f: TradeFilters): number {
	return f.symbols.length + f.setups.length + f.tags.length + f.excludeTags.length + (f.side === "all" ? 0 : 1) + (f.outcome === "all" ? 0 : 1);
}

export function applyFilters(trades: DashTrade[], f: TradeFilters): DashTrade[] {
	if (!activeFilterCount(f)) return trades;
	return trades.filter((t) => {
		if (f.symbols.length && !f.symbols.includes(t.symbol)) return false;
		if (f.side !== "all" && t.side !== f.side) return false;
		if (f.outcome === "win" && !(t.pnl > 0)) return false;
		if (f.outcome === "loss" && !(t.pnl < 0)) return false;
		if (f.setups.length && !f.setups.some((s) => t.tags.includes(s))) return false;
		if (f.tags.length) {
			const ok = f.tagMode === "all" ? f.tags.every((x) => t.tags.includes(x)) : f.tags.some((x) => t.tags.includes(x));
			if (!ok) return false;
		}
		if (f.excludeTags.some((x) => t.tags.includes(x))) return false;
		return true;
	});
}

/** The values the filters can take, from the trades themselves. */
export function filterOptions(trades: DashTrade[], categories: Record<string, string>): { symbols: string[]; setups: string[]; tags: string[] } {
	const symbols = new Set<string>();
	const setups = new Set<string>();
	const tags = new Set<string>();
	for (const t of trades) {
		if (t.symbol) symbols.add(t.symbol);
		for (const tag of t.tags) ((categories[tag] ?? "").toLowerCase() === "setups" ? setups : tags).add(tag);
	}
	const sorted = (s: Set<string>): string[] => [...s].sort((a, b) => a.localeCompare(b));
	return { symbols: sorted(symbols), setups: sorted(setups), tags: sorted(tags) };
}

/** Start of a named period, in milliseconds. `days` above zero counts back from `now`. */
export function periodStart(period: number, now: number): number | null {
	if (period > 0) return now - period * 86400000;
	if (period === -1) return new Date(new Date(now).getFullYear(), 0, 1).getTime();
	if (period === -2) {
		const d = new Date(now);
		return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
	}
	return null;
}
