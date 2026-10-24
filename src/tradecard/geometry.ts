// Figures of one trade, for its card. Pure: no Obsidian, so it can be tested.

export type Side = "long" | "short";

export interface TradePrices {
	side: Side;
	entry: number | null;
	exit: number | null;
	stopLoss: number | null;
	takeProfit: number | null;
}

export type MarkKind = "sl" | "entry" | "exit" | "tp";

export interface Ladder {
	/** Each known price and its place on the scale, 0 on the left (lowest) to 1 (highest). */
	marks: { kind: MarkKind; price: number; pos: number }[];
	/** Stretch between the entry and the stop, when the stop is on the losing side. */
	risk: [number, number] | null;
	/** Stretch between the entry and the target, when the target is on the winning side. */
	reward: [number, number] | null;
}

/** Above zero when a price move is a gain for this side. */
const gainOf = (side: Side, from: number, to: number): number => (side === "long" ? to - from : from - to);

/** The prices of the trade on one scale, lowest on the left. Needs at least the entry and the exit. */
export function ladder(p: TradePrices): Ladder | null {
	if (p.entry === null || p.exit === null) return null;
	const known: { kind: MarkKind; price: number }[] = [
		{ kind: "entry", price: p.entry },
		{ kind: "exit", price: p.exit },
	];
	if (p.stopLoss !== null) known.push({ kind: "sl", price: p.stopLoss });
	if (p.takeProfit !== null) known.push({ kind: "tp", price: p.takeProfit });
	const prices = known.map((k) => k.price);
	const lo = Math.min(...prices);
	const hi = Math.max(...prices);
	const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.001 || 1;
	const min = lo - pad;
	const span = hi + pad - min;
	const pos = (v: number): number => (v - min) / span;
	const marks = known.map((k) => ({ ...k, pos: pos(k.price) }));
	const sorted = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);
	const stopOnLoss = p.stopLoss !== null && gainOf(p.side, p.entry, p.stopLoss) < 0;
	const targetOnGain = p.takeProfit !== null && gainOf(p.side, p.entry, p.takeProfit) > 0;
	return {
		marks,
		risk: stopOnLoss && p.stopLoss !== null ? sorted(pos(p.entry), pos(p.stopLoss)) : null,
		reward: targetOnGain && p.takeProfit !== null ? sorted(pos(p.entry), pos(p.takeProfit)) : null,
	};
}

/** Distance to the target over distance to the stop, when both are on their side. */
export function plannedRewardRisk(p: TradePrices): number | null {
	if (p.entry === null || p.stopLoss === null || p.takeProfit === null) return null;
	const risk = -gainOf(p.side, p.entry, p.stopLoss);
	const reward = gainOf(p.side, p.entry, p.takeProfit);
	return risk > 0 && reward > 0 ? reward / risk : null;
}

/** The amount risked, from the result and the R multiple. */
export function riskFromR(pnl: number, r: number | null): number | null {
	return r === null || r === 0 || !Number.isFinite(r) ? null : Math.abs(pnl / r);
}

export function outcomeOf(pnl: number): "win" | "loss" | "breakeven" {
	return Math.abs(pnl) < 0.005 ? "breakeven" : pnl > 0 ? "win" : "loss";
}

/** Price with as many decimals as it needs, up to 5. */
export function priceDigits(v: number): number {
	const s = String(Math.abs(v));
	const dot = s.indexOf(".");
	return dot < 0 ? 0 : Math.min(5, s.length - dot - 1);
}
