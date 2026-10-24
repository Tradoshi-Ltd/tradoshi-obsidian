import type { DashTrade } from "../stats";

// Prop firm challenges: phases, rules and payouts, evaluated from the trades of the
// journal. Pure: no Obsidian, no DOM, no texts, so every rule can be tested. Money is
// in the currency of the challenge; trades in another currency are counted apart.
//
// The balance is rebuilt from closed trades. Unrealised profit or loss inside a trade
// is not seen, so a firm that measures live equity can show a different figure.

export type Unit = "amount" | "percent";

/** A figure set as an amount, or as a percentage (of the account size unless said otherwise). */
export interface Limit {
	value: number;
	unit: Unit;
}

/** How the overall loss limit moves: never, with the end-of-day balance, or after each trade. */
export type DrawdownMode = "static" | "eod" | "intraday";

export interface PhaseRules {
	profitTarget: Limit | null;
	maxLoss: Limit | null;
	maxLossMode: DrawdownMode;
	/** A trailing limit stops rising once it reaches the starting balance. */
	trailLock: boolean;
	dailyLoss: Limit | null;
	/** What a percentage daily limit is a share of: the balance at the start of the day, or the account size. */
	dailyLossOf: "dayStart" | "size";
	/** A breached daily limit fails the phase; otherwise it only ends the trading day. */
	dailyLossFails: boolean;
	/** Trading days needed before the phase can pass. */
	minDays: number | null;
	/** Calendar days allowed, counted from the start of the phase. */
	maxDays: number | null;
	/** The best day may be at most this share (%) of the phase profit. */
	consistency: number | null;
}

export interface PayoutPolicy {
	/** Calendar days to wait, from the start of the funded phase or from the last payout. */
	waitDays: number | null;
	/** Trading days needed in the payout cycle. */
	minDays: number | null;
	/** Profit needed above the starting balance. */
	minProfit: Limit | null;
	/** Share of the profit paid to the trader, in %. */
	split: number | null;
}

export interface Phase {
	name: string;
	funded: boolean;
	rules: PhaseRules;
	payout: PayoutPolicy | null;
	/** Account of the phase when the firm gave a new one; null for the account of the challenge. */
	account: string | null;
	/** Trading day the phase started, once reached. */
	start: string | null;
	/** Exact start, when the phase began right after the trade that reached the previous target. */
	startAt: number | null;
	/** Day the phase ended, once over. */
	end: string | null;
	/** Outcome the trader recorded. */
	outcome: "passed" | "failed" | null;
}

export interface Payout {
	day: string;
	/** Withdrawn from the balance of the account. */
	amount: number;
	/** What the trader received: his share. */
	received: number;
}

export interface Challenge {
	id: string;
	name: string;
	firm: string;
	/** Profile it was built from ("ftmo", "custom"…). */
	profile: string;
	account: string;
	size: number;
	currency: string;
	phases: Phase[];
	/** Index of the phase in progress. */
	current: number;
	/** Price paid for the evaluation, when the trader gave it. */
	cost: number | null;
	payouts: Payout[];
	archived: boolean;
}

export const emptyRules = (): PhaseRules => ({
	profitTarget: null,
	maxLoss: null,
	maxLossMode: "static",
	trailLock: false,
	dailyLoss: null,
	dailyLossOf: "size",
	dailyLossFails: true,
	minDays: null,
	maxDays: null,
	consistency: null,
});

export const emptyPayout = (): PayoutPolicy => ({ waitDays: null, minDays: null, minProfit: null, split: null });

// ── Days ────────────────────────────────────────────────────────────────────

const DAY_MS = 86400000;
const EPS = 1e-6;

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** The day `n` days after a day key "YYYY-MM-DD". */
export function addDays(day: string, n: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Days from one day key to another: 0 for the same day. */
export function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Day key of an instant on this computer. */
export function localDay(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A limit in money: a percentage is taken of `base`. Null when the rule is not set. */
export function limitAmount(limit: Limit | null, base: number): number | null {
	if (!limit || !Number.isFinite(limit.value) || limit.value <= 0) return null;
	return limit.unit === "percent" ? (base * limit.value) / 100 : limit.value;
}

// ── Which trades belong to a phase ──────────────────────────────────────────

export function phaseAccount(c: Challenge, i: number): string {
	return c.phases[i]?.account || c.account;
}

function belongsFrom(t: DashTrade, p: Phase): boolean {
	if (p.startAt !== null) return t.at >= p.startAt;
	return p.start !== null && t.day >= p.start;
}

/** Trades of a phase: its account, from its start to the start of the next phase, in the challenge currency. */
export function phaseTrades(c: Challenge, i: number, trades: DashTrade[]): { trades: DashTrade[]; otherCurrency: number } {
	const phase = c.phases[i];
	if (!phase || phase.start === null || i > c.current) return { trades: [], otherCurrency: 0 };
	const next = i < c.current ? c.phases[i + 1] : undefined;
	const account = phaseAccount(c, i);
	const out: DashTrade[] = [];
	let otherCurrency = 0;
	for (const t of trades) {
		if (t.account !== account || !belongsFrom(t, phase)) continue;
		if (next && next.start !== null && belongsFrom(t, next)) continue;
		if (t.currency !== c.currency) {
			otherCurrency++;
			continue;
		}
		out.push(t);
	}
	out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.at - b.at));
	return { trades: out, otherCurrency };
}

// ── Evaluation of a phase ───────────────────────────────────────────────────

export type RuleId = "profitTarget" | "maxLoss" | "dailyLoss" | "minDays" | "maxDays" | "consistency";

/**
 * Targets are "met" or "pending"; limits are "ok", "danger" (80 % of the limit used) or
 * "violated"; the consistency rule is "blocked" when it stops the phase from passing,
 * without failing it.
 */
export type RuleStatus = "met" | "pending" | "ok" | "danger" | "violated" | "blocked";

export const RULE_ORDER: RuleId[] = ["profitTarget", "maxLoss", "dailyLoss", "minDays", "maxDays", "consistency"];

export interface RuleResult {
	id: RuleId;
	status: RuleStatus;
	/** Profit made, loss used, trading days, days elapsed, or best-day share (%). */
	value: number;
	/** The target or limit the value is measured against. */
	limit: number;
	/** Fill of the gauge: 0 to 1, more once a limit is passed. */
	ratio: number;
	/** Room left before the limit, or what is still missing to the target. */
	remaining: number;
	/** Day the rule was broken, the target first reached, or the last day allowed. */
	day: string | null;
	/** Max loss: balance under which the account fails. Target: balance to reach. Daily loss: lowest balance allowed today. */
	level: number | null;
	/** Consistency: phase profit that would bring the best day back within the limit. */
	needed: number | null;
	/** Daily loss: days on which the limit was reached. */
	hits: number;
}

export interface CurvePoint {
	day: string;
	at: number | null;
	balance: number;
	/** The max loss level at that point, when the rule is set. */
	floor: number | null;
	trade: DashTrade | null;
	payout: Payout | null;
}

export type PhaseStatus = "upcoming" | "active" | "passed" | "failed" | "funded";

export interface PhaseEval {
	index: number;
	phase: Phase;
	status: PhaseStatus;
	trades: DashTrade[];
	otherCurrency: number;
	tradingDays: number;
	balance: number;
	/** Balance minus the starting balance: profit still in the account. */
	profit: number;
	/** Sum of the trades of the phase. */
	net: number;
	rules: RuleResult[];
	/** The balance after each trade and payout, from the start of the phase. */
	curve: CurvePoint[];
	/** First trade that took the profit to the target. */
	targetReached: { day: string; at: number } | null;
	/** Every target and condition to pass the phase is met (an evaluation phase). */
	passes: boolean;
	failedOn: string | null;
	failedBy: RuleId | null;
}

export interface EvalOptions {
	/** Today, as a trading day key. */
	today: string;
	/** Share of a limit from which a rule is in danger. 0.8 by default. */
	dangerAt?: number;
}

function dailyLimit(r: PhaseRules, size: number, dayStart: number): number | null {
	return limitAmount(r.dailyLoss, r.dailyLossOf === "dayStart" ? dayStart : size);
}

const blank = { value: 0, limit: 0, ratio: 0, remaining: 0, day: null, level: null, needed: null, hits: 0 };

export function evaluatePhase(c: Challenge, i: number, allTrades: DashTrade[], opts: EvalOptions): PhaseEval {
	const phase = c.phases[i];
	const danger = opts.dangerAt ?? 0.8;
	const S = c.size;
	const r = phase.rules;
	const { trades, otherCurrency } = phaseTrades(c, i, allTrades);
	const isCurrent = i === c.current;
	const reachedPhase = phase.start !== null && i <= c.current;

	// Payouts taken during the phase.
	const next = i < c.current ? c.phases[i + 1] : undefined;
	const payouts = reachedPhase && phase.funded && phase.start !== null
		? c.payouts.filter((p) => p.day >= (phase.start ?? "") && !(next?.start && p.day >= next.start)).sort((a, b) => (a.day < b.day ? -1 : 1))
		: [];

	const maxAmt = limitAmount(r.maxLoss, S);
	const targetAmt = limitAmount(r.profitTarget, S);
	const cap = r.trailLock ? S : Infinity;
	let balance = S;
	let peak = S;
	let floor: number | null = maxAmt === null ? null : S - maxAmt;
	const raise = (): void => {
		if (maxAmt === null || floor === null) return;
		peak = Math.max(peak, balance);
		floor = Math.max(floor, Math.min(peak - maxAmt, cap));
	};

	const curve: CurvePoint[] = [];
	if (reachedPhase && phase.start) curve.push({ day: phase.start, at: phase.startAt, balance, floor, trade: null, payout: null });

	const byDay = new Map<string, DashTrade[]>();
	for (const t of trades) {
		const list = byDay.get(t.day);
		if (list) list.push(t);
		else byDay.set(t.day, [t]);
	}
	const payoutsByDay = new Map<string, Payout[]>();
	for (const p of payouts) {
		const list = payoutsByDay.get(p.day);
		if (list) list.push(p);
		else payoutsByDay.set(p.day, [p]);
	}
	const days = [...new Set([...byDay.keys(), ...payoutsByDay.keys()])].sort();

	let maxBreach: { day: string; at: number } | null = null;
	let firstDaily: { day: string; loss: number; limit: number } | null = null;
	let todayHit: { day: string; loss: number; limit: number } | null = null;
	let worst: { loss: number; limit: number; ratio: number } | null = null;
	let hits = 0;
	let today: { loss: number; limit: number | null; start: number } | null = null;
	let targetReached: { day: string; at: number } | null = null;

	for (const day of days) {
		// A payout leaves the account at the start of its day; the loss limit stays where it was.
		for (const p of payoutsByDay.get(day) ?? []) {
			balance -= p.amount;
			curve.push({ day, at: null, balance, floor, trade: null, payout: p });
		}
		const dayStart = balance;
		const limit = dailyLimit(r, S, dayStart);
		let low = balance;
		let hit = false;
		for (const t of byDay.get(day) ?? []) {
			balance += t.pnl;
			if (r.maxLossMode === "intraday") raise();
			low = Math.min(low, balance);
			if (floor !== null && !maxBreach && balance < floor - EPS) maxBreach = { day, at: t.at };
			if (limit !== null && dayStart - low > limit + EPS) hit = true;
			if (targetAmt !== null && !targetReached && balance - S >= targetAmt - EPS) targetReached = { day, at: t.at };
			curve.push({ day, at: t.at, balance, floor, trade: t, payout: null });
		}
		const loss = Math.max(0, dayStart - low);
		if (limit !== null) {
			if (!worst || loss / limit > worst.ratio) worst = { loss, limit, ratio: loss / limit };
			if (hit) {
				hits++;
				if (!firstDaily) firstDaily = { day, loss, limit };
				if (day === opts.today) todayHit = { day, loss, limit };
			}
		}
		if (day === opts.today) today = { loss, limit, start: dayStart };
		if (r.maxLossMode === "eod") raise();
	}
	if (!today) today = { loss: 0, limit: dailyLimit(r, S, balance), start: balance };

	const net = trades.reduce((s, t) => s + t.pnl, 0);
	const profit = balance - S;
	const tradingDays = new Set(trades.map((t) => t.day)).size;
	const rules: RuleResult[] = [];

	let targetMet = false;
	if (targetAmt !== null) {
		targetMet = profit >= targetAmt - EPS;
		rules.push({
			...blank,
			id: "profitTarget",
			status: targetMet ? "met" : "pending",
			value: profit,
			limit: targetAmt,
			ratio: Math.max(0, profit) / targetAmt,
			remaining: Math.max(0, targetAmt - profit),
			day: targetReached?.day ?? null,
			level: S + targetAmt,
		});
	}

	if (maxAmt !== null && floor !== null) {
		const room = balance - floor;
		const used = Math.max(0, maxAmt - room);
		const ratio = used / maxAmt;
		rules.push({
			...blank,
			id: "maxLoss",
			status: maxBreach ? "violated" : ratio >= danger - EPS ? "danger" : "ok",
			value: used,
			limit: maxAmt,
			ratio: maxBreach ? Math.max(1, ratio) : ratio,
			remaining: Math.max(0, room),
			day: maxBreach?.day ?? null,
			level: floor,
		});
	}

	if (limitAmount(r.dailyLoss, S) !== null) {
		// The phase in progress shows today; a finished phase shows its worst day.
		const breach = r.dailyLossFails ? firstDaily : isCurrent ? todayHit : null;
		const shown = breach ?? (isCurrent ? { loss: today.loss, limit: today.limit ?? 0 } : (worst ?? { loss: 0, limit: dailyLimit(r, S, S) ?? 0 }));
		const ratio = shown.limit > 0 ? shown.loss / shown.limit : 0;
		rules.push({
			...blank,
			id: "dailyLoss",
			status: breach ? "violated" : ratio >= danger - EPS ? "danger" : "ok",
			value: shown.loss,
			limit: shown.limit,
			ratio: breach ? Math.max(1, ratio) : ratio,
			remaining: Math.max(0, shown.limit - shown.loss),
			day: breach?.day ?? null,
			level: isCurrent && !breach && today.limit !== null ? today.start - today.limit : null,
			hits,
		});
	}

	if (r.minDays) {
		rules.push({
			...blank,
			id: "minDays",
			status: tradingDays >= r.minDays ? "met" : "pending",
			value: tradingDays,
			limit: r.minDays,
			ratio: tradingDays / r.minDays,
			remaining: Math.max(0, r.minDays - tradingDays),
		});
	}

	if (r.consistency) {
		const totals = new Map<string, number>();
		for (const t of trades) totals.set(t.day, (totals.get(t.day) ?? 0) + t.pnl);
		const best = Math.max(0, ...totals.values());
		if (net <= EPS || best <= EPS) {
			rules.push({ ...blank, id: "consistency", status: "pending", limit: r.consistency });
		} else {
			const share = (best / net) * 100;
			const needed = (best * 100) / r.consistency;
			rules.push({
				...blank,
				id: "consistency",
				status: share > r.consistency + EPS ? "blocked" : share >= r.consistency * danger - EPS ? "danger" : "ok",
				value: share,
				limit: r.consistency,
				ratio: share / r.consistency,
				remaining: Math.max(0, needed - net),
				needed,
			});
		}
	}

	const minDaysOk = !rules.some((x) => x.id === "minDays" && x.status !== "met");
	const consistencyOk = !rules.some((x) => x.id === "consistency" && x.status === "blocked");
	const terminalBefore = rules.some((x) => x.status === "violated" && (x.id === "maxLoss" || (x.id === "dailyLoss" && r.dailyLossFails)));
	const passes = reachedPhase && !phase.funded && targetAmt !== null && targetMet && minDaysOk && consistencyOk && !terminalBefore;

	if (r.maxDays && reachedPhase && phase.start) {
		const until = !isCurrent && phase.end ? phase.end : opts.today;
		const elapsed = Math.max(0, daysBetween(phase.start, until) + 1);
		const deadline = addDays(phase.start, r.maxDays - 1);
		const over = elapsed > r.maxDays && !passes && phase.outcome !== "passed";
		const ratio = elapsed / r.maxDays;
		rules.push({
			...blank,
			id: "maxDays",
			status: over ? "violated" : passes || phase.outcome === "passed" ? "ok" : ratio >= danger - EPS ? "danger" : "ok",
			value: elapsed,
			limit: r.maxDays,
			ratio,
			remaining: Math.max(0, r.maxDays - elapsed),
			day: over ? addDays(deadline, 1) : deadline,
		});
	}
	rules.sort((a, b) => RULE_ORDER.indexOf(a.id) - RULE_ORDER.indexOf(b.id));

	// What ended the phase: the earliest broken rule that fails it.
	let failedOn: string | null = null;
	let failedBy: RuleId | null = null;
	for (const x of rules) {
		const terminal = x.id === "maxLoss" || x.id === "maxDays" || (x.id === "dailyLoss" && r.dailyLossFails);
		if (terminal && x.status === "violated" && x.day && (!failedOn || x.day < failedOn)) {
			failedOn = x.day;
			failedBy = x.id;
		}
	}
	if (phase.outcome === "failed" && !failedOn) failedOn = phase.end;

	let status: PhaseStatus;
	if (!reachedPhase) status = "upcoming";
	else if (phase.outcome === "failed") status = "failed";
	else if (phase.outcome === "passed" || i < c.current) status = "passed";
	else if (failedBy) status = "failed";
	else if (phase.funded) status = "funded";
	else if (passes) status = "passed";
	else status = "active";

	return { index: i, phase, status, trades, otherCurrency, tradingDays, balance, profit, net, rules, curve, targetReached, passes, failedOn, failedBy };
}

// ── Payouts ─────────────────────────────────────────────────────────────────

export interface PayoutEval {
	ready: boolean;
	/** Profit above the starting balance, which a payout can take. */
	available: number;
	/** The trader's share of it, when the split is known. */
	share: number | null;
	/** Start of the payout cycle: the funded phase, or the last payout. */
	cycleStart: string;
	/** First day a payout can be asked. */
	from: string;
	/** Trading days of the cycle, and how many are still needed. */
	days: number;
	daysMissing: number;
	/** Profit still needed before a payout. */
	profitMissing: number;
	/** Room before the max loss once everything available is withdrawn. */
	roomAfter: number | null;
}

export function payoutStatus(c: Challenge, pe: PhaseEval, opts: EvalOptions): PayoutEval | null {
	const policy = pe.phase.payout;
	const start = pe.phase.start;
	if (!pe.phase.funded || !policy || !start || pe.status === "upcoming") return null;
	const taken = c.payouts.filter((p) => p.day >= start).sort((a, b) => (a.day < b.day ? -1 : 1));
	const last = taken.length ? taken[taken.length - 1] : null;
	const cycleStart = last ? last.day : start;
	const from = policy.waitDays ? addDays(cycleStart, policy.waitDays) : cycleStart;
	const days = new Set(pe.trades.filter((t) => (last ? t.day > last.day : true)).map((t) => t.day)).size;
	const daysMissing = policy.minDays ? Math.max(0, policy.minDays - days) : 0;
	const minProfit = limitAmount(policy.minProfit, c.size) ?? 0;
	const profitMissing = Math.max(0, minProfit - pe.profit);
	const available = Math.max(0, pe.profit);
	const share = policy.split !== null ? (available * policy.split) / 100 : null;
	const floor = pe.rules.find((x) => x.id === "maxLoss")?.level ?? null;
	const roomAfter = floor === null ? null : pe.balance - available - floor;
	const ready = pe.status !== "failed" && opts.today >= from && daysMissing === 0 && profitMissing <= EPS && available > EPS;
	return { ready, available, share, cycleStart, from, days, daysMissing, profitMissing, roomAfter };
}

// ── A whole challenge ───────────────────────────────────────────────────────

/** What needs the trader's attention, worst first. */
export type AlertKind = "failed" | "danger" | "blocked" | "passed" | "payout";

const SEVERITY: Record<AlertKind, number> = { failed: 0, danger: 1, blocked: 2, passed: 3, payout: 4 };

export interface Alert {
	kind: AlertKind;
	rule: RuleId | null;
	day: string | null;
	ratio: number | null;
	amount: number | null;
}

export interface ChallengeEval {
	challenge: Challenge;
	/** Every phase; those not reached yet are empty. */
	phases: PhaseEval[];
	current: PhaseEval;
	payout: PayoutEval | null;
	alerts: Alert[];
	otherCurrency: number;
}

export function evaluateChallenge(c: Challenge, trades: DashTrade[], opts: EvalOptions): ChallengeEval {
	const phases = c.phases.map((_, i) => evaluatePhase(c, i, trades, opts));
	const current = phases[Math.min(Math.max(c.current, 0), phases.length - 1)];
	const payout = payoutStatus(c, current, opts);
	return { challenge: c, phases, current, payout, alerts: alertsOf(c, current, payout), otherCurrency: phases.reduce((s, p) => s + p.otherCurrency, 0) };
}

export function alertsOf(c: Challenge, current: PhaseEval, payout: PayoutEval | null): Alert[] {
	if (c.archived || current.status === "upcoming") return [];
	const out: Alert[] = [];
	const add = (kind: AlertKind, extra: Partial<Alert> = {}): void => {
		out.push({ kind, rule: null, day: null, ratio: null, amount: null, ...extra });
	};
	if (current.status === "failed") {
		// Once the trader recorded the failure, it is known: no alert.
		if (current.phase.outcome !== "failed") add("failed", { rule: current.failedBy, day: current.failedOn });
		return out;
	}
	if (current.phase.outcome === "passed") return out;
	for (const r of current.rules) if (r.status === "danger") add("danger", { rule: r.id, ratio: r.ratio });
	const target = current.rules.find((x) => x.id === "profitTarget");
	const consistency = current.rules.find((x) => x.id === "consistency");
	if (target?.status === "met" && consistency?.status === "blocked") add("blocked", { rule: "consistency", amount: consistency.remaining });
	if (current.status === "passed") add("passed");
	if (payout?.ready) add("payout", { amount: payout.available });
	return out.sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind]);
}

/** Alerts of several challenges, worst first, one row per challenge: its most severe one. */
export function topAlerts(evals: ChallengeEval[]): { ev: ChallengeEval; alert: Alert }[] {
	return evals
		.filter((ev) => ev.alerts.length)
		.map((ev) => ({ ev, alert: ev.alerts[0] }))
		.sort((a, b) => SEVERITY[a.alert.kind] - SEVERITY[b.alert.kind]);
}

// ── What the challenges cost and returned ───────────────────────────────────

export interface Economics {
	currency: string;
	challenges: number;
	/** Challenges that reached a funded phase. */
	funded: number;
	cost: number;
	/** Payouts received by the trader. */
	received: number;
	net: number;
	/** Net over cost, in %; null when no cost was given. */
	roi: number | null;
}

/** Cost against payouts, one line per currency, the currency with most challenges first. */
export function economics(challenges: Challenge[]): Economics[] {
	const by = new Map<string, Economics>();
	for (const c of challenges) {
		const e = by.get(c.currency) ?? { currency: c.currency, challenges: 0, funded: 0, cost: 0, received: 0, net: 0, roi: null };
		e.challenges++;
		if (c.phases.some((p, i) => p.funded && p.start !== null && i <= c.current)) e.funded++;
		e.cost += c.cost ?? 0;
		e.received += c.payouts.reduce((s, p) => s + p.received, 0);
		by.set(c.currency, e);
	}
	return [...by.values()]
		.map((e) => ({ ...e, net: e.received - e.cost, roi: e.cost > 0 ? ((e.received - e.cost) / e.cost) * 100 : null }))
		.sort((a, b) => b.challenges - a.challenges);
}

// ── What the trader does ────────────────────────────────────────────────────

const copy = (c: Challenge): Challenge => JSON.parse(JSON.stringify(c)) as Challenge;

/**
 * Moves to the next phase. `at` is the instant the phase changed, when it changed right
 * after a trade (the trade that reached the target): trades before it stay in the old phase.
 */
export function advance(c: Challenge, day: string, at: number | null = null): Challenge {
	if (c.current >= c.phases.length - 1) return markPassed(c, day);
	const out = copy(c);
	const cur = out.phases[out.current];
	cur.outcome = "passed";
	cur.end = day;
	const next = out.phases[out.current + 1];
	next.start = day;
	next.startAt = at;
	next.end = null;
	next.outcome = null;
	out.current++;
	return out;
}

export function markPassed(c: Challenge, day: string): Challenge {
	const out = copy(c);
	out.phases[out.current].outcome = "passed";
	out.phases[out.current].end = day;
	return out;
}

export function markFailed(c: Challenge, day: string): Challenge {
	const out = copy(c);
	out.phases[out.current].outcome = "failed";
	out.phases[out.current].end = day;
	return out;
}

/** Back in progress, after an outcome recorded by mistake. */
export function reopen(c: Challenge): Challenge {
	const out = copy(c);
	out.phases[out.current].outcome = null;
	out.phases[out.current].end = null;
	return out;
}

/** A new attempt with the same rules, from the first phase. */
export function restart(c: Challenge, id: string, day: string): Challenge {
	const out = copy(c);
	out.id = id;
	out.current = 0;
	out.payouts = [];
	out.archived = false;
	out.phases.forEach((p, i) => {
		p.start = i === 0 ? day : null;
		p.startAt = null;
		p.end = null;
		p.outcome = null;
	});
	return out;
}

export function addPayout(c: Challenge, payout: Payout): Challenge {
	const out = copy(c);
	out.payouts.push({ ...payout });
	out.payouts.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
	return out;
}
