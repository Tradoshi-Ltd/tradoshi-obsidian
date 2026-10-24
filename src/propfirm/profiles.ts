import { emptyPayout, emptyRules, isDay, type Challenge, type Limit, type Payout, type PayoutPolicy, type Phase, type PhaseRules } from "./rules";

// Firm profiles: a starting point to fill a challenge, never the authority. Firms change
// their rules, so every value stays editable, and a value we are not sure of is left
// empty for the trader to fill. Firms are named as text only: no logo, no brand mark.
// Pure, like the rules: no Obsidian, no texts.

export type ProfileId = "ftmo" | "fundednext" | "the5ers" | "custom";

interface PhaseTemplate {
	/** The firm's own name of the phase; null for the generic "Phase n" or "Funded account". */
	name: string | null;
	funded: boolean;
	rules: Partial<PhaseRules>;
	payout?: Partial<PayoutPolicy>;
}

export interface FirmProfile {
	id: ProfileId;
	firm: string;
	/** The programme of the firm these rules are for. */
	program: string;
	phases: PhaseTemplate[];
}

const pct = (value: number): Limit => ({ value, unit: "percent" });

export const PROFILES: FirmProfile[] = [
	{
		id: "ftmo",
		firm: "FTMO",
		program: "FTMO Challenge, 2-step",
		phases: [
			{ name: "FTMO Challenge", funded: false, rules: { profitTarget: pct(10), maxLoss: pct(10), dailyLoss: pct(5), minDays: 4 } },
			{ name: "Verification", funded: false, rules: { profitTarget: pct(5), maxLoss: pct(10), dailyLoss: pct(5), minDays: 4 } },
			{ name: "FTMO Account", funded: true, rules: { maxLoss: pct(10), dailyLoss: pct(5) }, payout: { waitDays: 14, split: 80 } },
		],
	},
	{
		id: "fundednext",
		firm: "FundedNext",
		program: "Stellar 2-Step",
		phases: [
			{ name: null, funded: false, rules: { profitTarget: pct(8), maxLoss: pct(10), dailyLoss: pct(5) } },
			{ name: null, funded: false, rules: { profitTarget: pct(5), maxLoss: pct(10), dailyLoss: pct(5) } },
			{ name: null, funded: true, rules: { maxLoss: pct(10), dailyLoss: pct(5) }, payout: {} },
		],
	},
	{
		id: "the5ers",
		firm: "The5ers",
		program: "High Stakes",
		phases: [
			{ name: null, funded: false, rules: { profitTarget: pct(8), maxLoss: pct(10), dailyLoss: pct(5) } },
			{ name: null, funded: false, rules: { profitTarget: pct(5), maxLoss: pct(10), dailyLoss: pct(5) } },
			{ name: null, funded: true, rules: { maxLoss: pct(10), dailyLoss: pct(5) }, payout: {} },
		],
	},
	{
		id: "custom",
		firm: "",
		program: "",
		phases: [
			{ name: null, funded: false, rules: {} },
			{ name: null, funded: true, rules: {}, payout: {} },
		],
	},
];

export function profileById(id: string): FirmProfile {
	return PROFILES.find((p) => p.id === id) ?? PROFILES[PROFILES.length - 1];
}

/** Generic phase names, in the trader's language. */
export interface PhaseNames {
	phase(n: number): string;
	funded: string;
}

const ENGLISH: PhaseNames = { phase: (n) => `Phase ${n}`, funded: "Funded account" };

export function blankPhase(name: string, funded: boolean): Phase {
	return { name, funded, rules: emptyRules(), payout: funded ? emptyPayout() : null, account: null, start: null, startAt: null, end: null, outcome: null };
}

export function phasesFromProfile(id: string, names: PhaseNames = ENGLISH): Phase[] {
	let n = 0;
	return profileById(id).phases.map((tpl) => {
		if (!tpl.funded) n++;
		const name = tpl.name ?? (tpl.funded ? names.funded : names.phase(n));
		const phase = blankPhase(name, tpl.funded);
		phase.rules = { ...phase.rules, ...JSON.parse(JSON.stringify(tpl.rules)) as Partial<PhaseRules> };
		if (tpl.funded) phase.payout = { ...emptyPayout(), ...JSON.parse(JSON.stringify(tpl.payout ?? {})) as Partial<PayoutPolicy> };
		return phase;
	});
}

/**
 * The rules of a profile on an existing challenge. Phases keep their dates, accounts and
 * outcomes by position, so the history of the challenge is not lost.
 */
export function applyProfile(c: Challenge, id: string, names: PhaseNames = ENGLISH): Challenge {
	const fresh = phasesFromProfile(id, names);
	const phases = fresh.map((p, i) => {
		const old = c.phases[i];
		return old ? { ...p, account: old.account, start: old.start, startAt: old.startAt, end: old.end, outcome: old.outcome } : p;
	});
	const profile = profileById(id);
	return { ...c, profile: profile.id, firm: profile.firm || c.firm, phases, current: Math.min(c.current, phases.length - 1) };
}

export function newChallenge(o: { id: string; profile: string; account: string; size: number; currency: string; start: string; names?: PhaseNames }): Challenge {
	const profile = profileById(o.profile);
	const phases = phasesFromProfile(profile.id, o.names);
	phases[0].start = o.start;
	const sizeLabel = o.size >= 1000 ? `${Math.round(o.size / 1000)}K` : String(o.size);
	return {
		id: o.id,
		name: [profile.firm, sizeLabel].filter(Boolean).join(" "),
		firm: profile.firm,
		profile: profile.id,
		account: o.account,
		size: o.size,
		currency: o.currency,
		phases,
		current: 0,
		cost: null,
		payouts: [],
		archived: false,
	};
}

export function newId(now: number = Date.now()): string {
	return `c${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ── Reading saved data defensively ──────────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pos = (v: unknown): number | null => {
	const n = num(v);
	return n !== null && n > 0 ? n : null;
};
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

function limit(v: unknown): Limit | null {
	const o = obj(v);
	const value = pos(o?.value);
	if (!o || value === null) return null;
	return { value, unit: o.unit === "amount" ? "amount" : "percent" };
}

function rules(v: unknown): PhaseRules {
	const o = obj(v) ?? {};
	const mode = o.maxLossMode;
	return {
		profitTarget: limit(o.profitTarget),
		maxLoss: limit(o.maxLoss),
		maxLossMode: mode === "eod" || mode === "intraday" ? mode : "static",
		trailLock: o.trailLock === true,
		dailyLoss: limit(o.dailyLoss),
		dailyLossOf: o.dailyLossOf === "dayStart" ? "dayStart" : "size",
		dailyLossFails: o.dailyLossFails !== false,
		minDays: pos(o.minDays),
		maxDays: pos(o.maxDays),
		consistency: pos(o.consistency),
	};
}

function payout(v: unknown): PayoutPolicy {
	const o = obj(v) ?? {};
	return { waitDays: pos(o.waitDays), minDays: pos(o.minDays), minProfit: limit(o.minProfit), split: pos(o.split) };
}

function phase(v: unknown, i: number): Phase | null {
	const o = obj(v);
	if (!o) return null;
	const funded = o.funded === true;
	return {
		name: str(o.name) || (funded ? ENGLISH.funded : ENGLISH.phase(i + 1)),
		funded,
		rules: rules(o.rules),
		payout: funded ? payout(o.payout) : null,
		account: str(o.account) || null,
		start: isDay(o.start) ? o.start : null,
		startAt: num(o.startAt),
		end: isDay(o.end) ? o.end : null,
		outcome: o.outcome === "passed" || o.outcome === "failed" ? o.outcome : null,
	};
}

function payoutRecord(v: unknown): Payout | null {
	const o = obj(v);
	const amount = num(o?.amount);
	if (!o || !isDay(o.day) || amount === null) return null;
	return { day: o.day, amount, received: num(o.received) ?? amount };
}

/** The challenges saved in the plugin data, with anything broken dropped or repaired. */
export function normalizeChallenges(raw: unknown): Challenge[] {
	const list = Array.isArray(obj(raw)?.challenges) ? (obj(raw)?.challenges as unknown[]) : [];
	const out: Challenge[] = [];
	for (const item of list) {
		const o = obj(item);
		const size = pos(o?.size);
		const id = str(o?.id);
		const account = str(o?.account);
		if (!o || !id || !account || size === null) continue;
		const phases = (Array.isArray(o.phases) ? o.phases : []).map(phase).filter((p): p is Phase => p !== null);
		if (!phases.length) continue;
		const current = Math.min(Math.max(Math.trunc(num(o.current) ?? 0), 0), phases.length - 1);
		out.push({
			id,
			name: str(o.name) || account,
			firm: str(o.firm),
			profile: str(o.profile, "custom"),
			account,
			size,
			currency: str(o.currency) || "USD",
			phases,
			current,
			cost: pos(o.cost),
			payouts: (Array.isArray(o.payouts) ? o.payouts : []).map(payoutRecord).filter((p): p is Payout => p !== null),
			archived: o.archived === true,
		});
	}
	return out;
}
