// Figures of each trading account. Pure: no Obsidian, so it can be tested.
import type { DashTrade } from "../stats";

export type AccountType = "live" | "demo" | "challenge" | "funded" | "backtest";

export interface AccountSettings {
	type: AccountType;
	/** Balance at the start of the journal; needed for the balance, the return and the drawdown in %. */
	initial: number | null;
	/** Profit to reach, in the account currency. */
	target: number | null;
	/** Hidden from the accounts view and the totals. */
	hidden: boolean;
}

export const DEFAULT_ACCOUNT: AccountSettings = { type: "live", initial: null, target: null, hidden: false };

export interface AccountFigures {
	name: string;
	currency: string;
	broker: string | null;
	trades: number;
	net: number;
	winRate: number | null;
	profitFactor: number | null;
	/** Initial balance plus the result, when the initial balance is known. */
	balance: number | null;
	/** Result over the initial balance, in %. */
	returnPct: number | null;
	/** Largest fall from a peak, in money and in % of that peak (balance known). */
	maxDrawdown: number;
	maxDrawdownPct: number | null;
	/** Distance below the highest point reached, now. */
	currentDrawdown: number;
	first: number | null;
	last: number | null;
	/** Balance (or cumulative result) after each trade, oldest first. */
	curve: { at: number; value: number }[];
}

/** Figures of one account, in its own currency: trades in another currency are left out. */
export function accountFigures(name: string, trades: DashTrade[], settings: AccountSettings): AccountFigures {
	const own = trades.filter((t) => t.account === name).sort((a, b) => a.at - b.at);
	const currency = majority(own.map((t) => t.currency)) ?? "USD";
	const same = own.filter((t) => t.currency === currency);
	const start = settings.initial ?? 0;
	let cum = start;
	let peak = start;
	let dd = 0;
	let ddPct = 0;
	const curve: { at: number; value: number }[] = [];
	for (const t of same) {
		cum += t.pnl;
		peak = Math.max(peak, cum);
		dd = Math.max(dd, peak - cum);
		if (settings.initial !== null && peak > 0) ddPct = Math.max(ddPct, ((peak - cum) / peak) * 100);
		curve.push({ at: t.at, value: cum });
	}
	const wins = same.filter((t) => t.pnl > 0);
	const losses = same.filter((t) => t.pnl < 0);
	const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
	const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
	const net = grossWin - grossLoss;
	return {
		name,
		currency,
		broker: own.find((t) => t.broker)?.broker ?? null,
		trades: same.length,
		net,
		winRate: wins.length + losses.length ? (wins.length / (wins.length + losses.length)) * 100 : null,
		profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
		balance: settings.initial === null ? null : settings.initial + net,
		returnPct: settings.initial ? (net / settings.initial) * 100 : null,
		maxDrawdown: dd,
		maxDrawdownPct: settings.initial === null ? null : ddPct,
		currentDrawdown: peak - cum,
		first: same[0]?.at ?? null,
		last: same[same.length - 1]?.at ?? null,
		curve,
	};
}

function majority(values: string[]): string | null {
	const count = new Map<string, number>();
	for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
	let best: string | null = null;
	let n = 0;
	for (const [v, k] of count) if (k > n) [best, n] = [v, k];
	return best;
}

/**
 * Total of the balances over time, for the accounts of one currency whose initial balance
 * is known: one point per trade, each account carrying its last balance forward.
 */
export function aumCurve(accounts: { figures: AccountFigures; initial: number }[], currency: string): { at: number; value: number }[] {
	const own = accounts.filter((a) => a.figures.currency === currency);
	const events: { at: number; account: string; value: number }[] = [];
	for (const a of own) for (const p of a.figures.curve) events.push({ at: p.at, account: a.figures.name, value: p.value });
	events.sort((x, y) => x.at - y.at);
	const current = new Map(own.map((a) => [a.figures.name, a.initial]));
	const out: { at: number; value: number }[] = [];
	for (const e of events) {
		current.set(e.account, e.value);
		let total = 0;
		for (const v of current.values()) total += v;
		out.push({ at: e.at, value: total });
	}
	return out;
}

/** Position size for a planned trade: risk amount over the loss per unit at the stop. */
export function positionSize(input: { balance: number; riskPct: number; entry: number; stop: number; pointValue: number }): { risk: number; size: number | null } {
	const risk = (input.balance * input.riskPct) / 100;
	const perUnit = Math.abs(input.entry - input.stop) * input.pointValue;
	return { risk, size: perUnit > 0 ? risk / perUnit : null };
}
