import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The prop firm rules, profiles and sample challenges have no Obsidian dependency: they
// are bundled on the fly and tested as is. The sample journal reads the language of
// Obsidian, so "obsidian" is replaced by a stub for it.
const dir = mkdtempSync(join(tmpdir(), "tradoshi-propfirm-"));
const stubObsidian = {
	name: "stub-obsidian",
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
		build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const getLanguage = () => 'en';", loader: "js" }));
	},
};
async function load(entry) {
	const out = join(dir, entry.replace(/\W/g, "_") + ".mjs");
	const result = await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, plugins: [stubObsidian], logLevel: "silent" });
	writeFileSync(out, result.outputFiles[0].text);
	return import(pathToFileURL(out).href);
}
const R = await load("src/propfirm/rules.ts");
const P = await load("src/propfirm/profiles.ts");
const S = await load("src/propfirm/sample.ts");
const J = await load("src/journal-data.ts");

// ── Helpers ─────────────────────────────────────────────────────────────────

let seq = 0;
/** A trade closed on `day` at `hh:mm` UTC. */
function trade(day, pnl, opts = {}) {
	const at = Date.parse(`${day}T${opts.time ?? "10:00"}:00Z`) + seq++;
	return {
		key: `t${seq}`, path: null, account: opts.account ?? "Acc", currency: opts.currency ?? "USD", symbol: "EURUSD", side: "long",
		at, day, hour: 10, openAt: at - 3600000, pnl, r: null, emotion: null, followedPlan: null, tags: [], entry: null, exit: null,
		volume: null, stopLoss: null, takeProfit: null, fees: 0, rating: null, broker: null,
	};
}

const pct = (value) => ({ value, unit: "percent" });
const usd = (value) => ({ value, unit: "amount" });

/** A one-phase evaluation (plus a funded phase) on account "Acc", 100,000 USD, from 2026-01-05. */
function challenge(rules = {}, extra = {}) {
	const phases = P.phasesFromProfile("custom");
	phases[0].start = "2026-01-05";
	phases[0].rules = { ...phases[0].rules, ...rules };
	return { id: "c1", name: "Test", firm: "", profile: "custom", account: "Acc", size: 100000, currency: "USD", phases, current: 0, cost: null, payouts: [], archived: false, ...extra };
}

const rule = (pe, id) => pe.rules.find((r) => r.id === id);
const evalPhase = (c, trades, today = "2026-01-30", i = c.current) => R.evaluatePhase(c, i, trades, { today });

// ── Days and amounts ────────────────────────────────────────────────────────

test("days and limits", () => {
	assert.equal(R.addDays("2026-02-27", 2), "2026-03-01");
	assert.equal(R.addDays("2026-03-01", -1), "2026-02-28");
	assert.equal(R.daysBetween("2026-01-05", "2026-01-05"), 0);
	assert.equal(R.daysBetween("2026-01-05", "2026-02-04"), 30);
	assert.equal(R.limitAmount(pct(10), 100000), 10000);
	assert.equal(R.limitAmount(usd(2500), 100000), 2500);
	assert.equal(R.limitAmount(null, 100000), null);
	assert.equal(R.limitAmount(pct(0), 100000), null);
	assert.equal(R.isDay("2026-13-45"), false);
	assert.equal(R.isDay("2026-10-24"), true);
});

// ── Max loss ────────────────────────────────────────────────────────────────

test("static max loss: in danger past 80 % of the limit, violated below the floor", () => {
	const c = challenge({ maxLoss: pct(10) });
	let pe = evalPhase(c, [trade("2026-01-05", 5000), trade("2026-01-06", -14000)]);
	let r = rule(pe, "maxLoss");
	assert.equal(r.level, 90000);
	assert.equal(r.value, 9000);
	assert.equal(r.remaining, 1000);
	assert.equal(r.status, "danger");
	assert.equal(pe.status, "active");

	pe = evalPhase(c, [trade("2026-01-05", 5000), trade("2026-01-06", -14000), trade("2026-01-07", -1500), trade("2026-01-08", 4000)]);
	r = rule(pe, "maxLoss");
	assert.equal(r.status, "violated");
	assert.equal(r.day, "2026-01-07");
	assert.equal(pe.status, "failed");
	assert.equal(pe.failedBy, "maxLoss");
	assert.equal(pe.failedOn, "2026-01-07");
});

test("static, end-of-day trailing and intraday trailing give three different floors", () => {
	// Day 1: up 3,000, then down 2,000 (closes at 101,000, peak 103,000). Day 2: down 8,500.
	const trades = [trade("2026-01-05", 3000, { time: "09:00" }), trade("2026-01-05", -2000, { time: "15:00" }), trade("2026-01-06", -8500)];
	const stat = rule(evalPhase(challenge({ maxLoss: pct(10), maxLossMode: "static" }), trades), "maxLoss");
	const eod = rule(evalPhase(challenge({ maxLoss: pct(10), maxLossMode: "eod" }), trades), "maxLoss");
	const intra = rule(evalPhase(challenge({ maxLoss: pct(10), maxLossMode: "intraday" }), trades), "maxLoss");
	assert.equal(stat.level, 90000);
	assert.equal(stat.status, "ok");
	assert.equal(eod.level, 91000);
	assert.equal(eod.status, "danger");
	assert.equal(eod.remaining, 1500);
	assert.equal(intra.level, 93000);
	assert.equal(intra.status, "violated");
	assert.equal(intra.day, "2026-01-06");
});

test("an end-of-day trailing floor moves only at the close of the day", () => {
	const c = challenge({ maxLoss: usd(3000), maxLossMode: "eod" });
	const pe = evalPhase(c, [trade("2026-01-05", 2500, { time: "09:00" }), trade("2026-01-05", -4000, { time: "11:00" })]);
	// During the day the floor is still 97,000: 98,500 is above it.
	assert.equal(rule(pe, "maxLoss").status, "ok");
	assert.deepEqual(pe.curve.map((p) => p.floor), [97000, 97000, 97000]);
});

test("a trailing floor can stop at the starting balance", () => {
	const trades = [trade("2026-01-05", 8000), trade("2026-01-06", -7500), trade("2026-01-07", -1000)];
	const locked = evalPhase(challenge({ maxLoss: usd(5000), maxLossMode: "intraday", trailLock: true }), trades);
	const r = rule(locked, "maxLoss");
	assert.equal(r.level, 100000);
	assert.equal(r.day, "2026-01-07");
	const free = rule(evalPhase(challenge({ maxLoss: usd(5000), maxLossMode: "intraday" }), trades), "maxLoss");
	assert.equal(free.level, 103000);
	assert.equal(free.day, "2026-01-06");
});

// ── Daily loss ──────────────────────────────────────────────────────────────

test("a single trade breaks the daily limit during the day, even if the day ends better", () => {
	const c = challenge({ dailyLoss: pct(5) });
	const pe = evalPhase(c, [trade("2026-01-05", -5200, { time: "09:00" }), trade("2026-01-05", 3000, { time: "14:00" })]);
	const r = rule(pe, "dailyLoss");
	assert.equal(r.status, "violated");
	assert.equal(r.day, "2026-01-05");
	assert.equal(r.value, 5200);
	assert.equal(pe.status, "failed");
	assert.equal(pe.failedBy, "dailyLoss");
});

test("the daily loss counts from the start of the day, not from the best moment of the day", () => {
	const c = challenge({ dailyLoss: pct(5) });
	const pe = evalPhase(c, [trade("2026-01-05", 1000, { time: "09:00" }), trade("2026-01-05", -5600, { time: "14:00" })], "2026-01-05");
	const r = rule(pe, "dailyLoss");
	assert.equal(r.value, 4600);
	assert.equal(r.status, "danger");
	assert.equal(r.remaining, 400);
	assert.equal(r.level, 95000);
});

test("a percentage daily limit is taken of the account size or of the start-of-day balance", () => {
	const trades = [trade("2026-01-05", 20000), trade("2026-01-06", -5500)];
	const ofSize = rule(evalPhase(challenge({ dailyLoss: pct(5), dailyLossOf: "size" }), trades), "dailyLoss");
	const ofDay = rule(evalPhase(challenge({ dailyLoss: pct(5), dailyLossOf: "dayStart" }), trades, "2026-01-06"), "dailyLoss");
	assert.equal(ofSize.status, "violated");
	assert.equal(ofDay.limit, 6000);
	assert.equal(ofDay.status, "danger");
});

test("a daily limit that only ends the day does not fail the phase", () => {
	const c = challenge({ dailyLoss: usd(2000), dailyLossFails: false });
	const trades = [trade("2026-01-05", -2500), trade("2026-01-06", 400)];
	let pe = evalPhase(c, trades, "2026-01-06");
	assert.equal(rule(pe, "dailyLoss").status, "ok");
	assert.equal(rule(pe, "dailyLoss").hits, 1);
	assert.equal(pe.status, "active");
	pe = evalPhase(c, trades, "2026-01-05");
	assert.equal(rule(pe, "dailyLoss").status, "violated");
	assert.equal(pe.status, "active");
});

// ── Target, days, consistency ──────────────────────────────────────────────

test("a phase passes once the target, the minimum days and every limit are met", () => {
	const c = challenge({ profitTarget: pct(10), maxLoss: pct(10), dailyLoss: pct(5), minDays: 4 });
	let pe = evalPhase(c, [trade("2026-01-05", 6000), trade("2026-01-06", 4500)]);
	assert.equal(rule(pe, "profitTarget").status, "met");
	assert.equal(rule(pe, "profitTarget").day, "2026-01-06");
	assert.equal(rule(pe, "minDays").status, "pending");
	assert.equal(rule(pe, "minDays").remaining, 2);
	assert.equal(pe.status, "active");

	pe = evalPhase(c, [trade("2026-01-05", 6000), trade("2026-01-06", 4500), trade("2026-01-07", 10), trade("2026-01-08", 10)]);
	assert.equal(pe.status, "passed");
	assert.equal(pe.passes, true);
	assert.equal(rule(pe, "profitTarget").ratio > 1, true);
	assert.deepEqual(pe.targetReached.day, "2026-01-06");
});

test("consistency: the best day must stay within its share of the profit", () => {
	const c = challenge({ profitTarget: pct(5), consistency: 40 });
	let pe = evalPhase(c, [trade("2026-01-05", 3000), trade("2026-01-06", 1000), trade("2026-01-07", 1000)]);
	let r = rule(pe, "consistency");
	assert.equal(r.status, "blocked");
	assert.equal(r.value, 60);
	assert.equal(r.needed, 7500);
	assert.equal(r.remaining, 2500);
	assert.equal(pe.status, "active");
	const ev = R.evaluateChallenge(c, [trade("2026-01-05", 3000), trade("2026-01-06", 1000), trade("2026-01-07", 1000)], { today: "2026-01-07" });
	assert.equal(ev.alerts[0].kind, "blocked");

	pe = evalPhase(c, [trade("2026-01-05", 3000), trade("2026-01-06", 1000), trade("2026-01-07", 1000), trade("2026-01-08", 1000), trade("2026-01-09", 1500)]);
	r = rule(pe, "consistency");
	assert.equal(r.value, 40);
	assert.equal(r.status, "danger");
	assert.equal(pe.status, "passed");
});

test("consistency waits for a profit before it can be measured", () => {
	const pe = evalPhase(challenge({ consistency: 30 }), [trade("2026-01-05", -500)]);
	assert.equal(rule(pe, "consistency").status, "pending");
});

test("a phase fails when its time runs out before it passes", () => {
	const c = challenge({ profitTarget: pct(10), maxDays: 30 });
	let pe = evalPhase(c, [trade("2026-01-05", 2000)], "2026-01-30");
	let r = rule(pe, "maxDays");
	assert.equal(r.value, 26);
	assert.equal(r.status, "danger");
	assert.equal(r.day, "2026-02-03");
	pe = evalPhase(c, [trade("2026-01-05", 2000)], "2026-02-10");
	r = rule(pe, "maxDays");
	assert.equal(r.status, "violated");
	assert.equal(r.day, "2026-02-04");
	assert.equal(pe.status, "failed");
	assert.equal(pe.failedBy, "maxDays");
	// Passed in time: the deadline no longer matters.
	pe = evalPhase(c, [trade("2026-01-05", 12000)], "2026-02-10");
	assert.equal(rule(pe, "maxDays").status, "ok");
	assert.equal(pe.status, "passed");
});

// ── Phases ──────────────────────────────────────────────────────────────────

test("moving to the next phase starts again from the account size", () => {
	const phases = P.phasesFromProfile("ftmo");
	phases[0].start = "2026-01-05";
	const c = { id: "c", name: "FTMO", firm: "FTMO", profile: "ftmo", account: "Acc", size: 100000, currency: "USD", phases, current: 0, cost: 540, payouts: [], archived: false };
	const trades = [trade("2026-01-05", 4000), trade("2026-01-06", 3000), trade("2026-01-07", 2000), trade("2026-01-08", 1500, { time: "09:00" }), trade("2026-01-08", 900, { time: "16:00" }), trade("2026-01-09", -700)];
	let ev = R.evaluateChallenge(c, trades, { today: "2026-01-08" });
	assert.equal(ev.current.status, "passed");
	assert.equal(ev.alerts.some((a) => a.kind === "passed"), true);
	const reached = ev.current.targetReached;
	assert.equal(reached.day, "2026-01-08");

	// The phase changes right after the trade that reached the target.
	const next = R.advance(c, reached.day, reached.at + 1);
	assert.equal(next.current, 1);
	assert.equal(next.phases[0].outcome, "passed");
	assert.equal(c.current, 0, "the original is left as it was");
	ev = R.evaluateChallenge(next, trades, { today: "2026-01-09" });
	assert.equal(ev.phases[0].status, "passed");
	assert.equal(ev.phases[0].trades.length, 4);
	assert.equal(ev.phases[0].balance, 110500);
	assert.equal(ev.current.trades.length, 2);
	assert.equal(ev.current.balance, 100200);
	assert.equal(rule(ev.current, "profitTarget").limit, 5000);
	assert.equal(ev.phases[2].status, "upcoming");
});

test("each phase can trade on its own account", () => {
	const c = challenge({ profitTarget: pct(10) });
	c.phases[1].account = "Funded";
	c.phases[1].start = "2026-02-02";
	c.phases[0].outcome = "passed";
	c.current = 1;
	const trades = [trade("2026-01-05", 10500), trade("2026-02-03", 800, { account: "Funded" }), trade("2026-02-03", 999, { account: "Acc" })];
	const ev = R.evaluateChallenge(c, trades, { today: "2026-02-03" });
	assert.equal(ev.phases[0].trades.length, 1);
	assert.equal(ev.current.trades.length, 1);
	assert.equal(ev.current.profit, 800);
	assert.equal(ev.current.status, "funded");
});

test("a failure recorded by the trader stands, and raises no alert", () => {
	const c = R.markFailed(challenge({ maxLoss: pct(10) }), "2026-01-09");
	const ev = R.evaluateChallenge(c, [trade("2026-01-05", -500)], { today: "2026-01-10" });
	assert.equal(ev.current.status, "failed");
	assert.equal(ev.current.failedOn, "2026-01-09");
	assert.deepEqual(ev.alerts, []);
	assert.equal(R.evaluateChallenge(R.reopen(c), [trade("2026-01-05", -500)], { today: "2026-01-10" }).current.status, "active");
});

test("a breach not recorded yet comes first among the alerts", () => {
	const a = R.evaluateChallenge(challenge({ maxLoss: pct(10) }), [trade("2026-01-05", -11000)], { today: "2026-01-06" });
	const b = R.evaluateChallenge({ ...challenge({ maxLoss: pct(10) }), id: "c2" }, [trade("2026-01-05", -8500)], { today: "2026-01-06" });
	assert.equal(a.alerts[0].kind, "failed");
	assert.equal(a.alerts[0].rule, "maxLoss");
	assert.equal(b.alerts[0].kind, "danger");
	const top = R.topAlerts([b, a]);
	assert.equal(top[0].ev.challenge.id, "c1");
	assert.equal(top.length, 2);
});

test("a new attempt keeps the rules and forgets the history", () => {
	const c = R.markFailed(challenge({ profitTarget: pct(8) }), "2026-01-09");
	const again = R.restart(c, "c9", "2026-02-01");
	assert.equal(again.id, "c9");
	assert.equal(again.phases[0].start, "2026-02-01");
	assert.equal(again.phases[0].outcome, null);
	assert.equal(again.phases[0].rules.profitTarget.value, 8);
});

// ── Funded account and payouts ─────────────────────────────────────────────

function funded(policy, payouts = []) {
	const c = challenge();
	c.phases[0].outcome = "passed";
	c.phases[1].start = "2026-03-02";
	c.phases[1].rules.maxLoss = pct(10);
	c.phases[1].payout = { waitDays: null, minDays: null, minProfit: null, split: null, ...policy };
	c.current = 1;
	c.payouts = payouts;
	return c;
}

test("payout: the waiting period, then the profit available and the trader's share", () => {
	const c = funded({ waitDays: 14, split: 80, minProfit: pct(1) });
	const trades = [trade("2026-03-03", 1800), trade("2026-03-10", 1200)];
	let ev = R.evaluateChallenge(c, trades, { today: "2026-03-12" });
	assert.equal(ev.current.status, "funded");
	assert.equal(ev.payout.ready, false);
	assert.equal(ev.payout.from, "2026-03-16");
	assert.equal(ev.payout.available, 3000);
	assert.equal(ev.payout.share, 2400);
	ev = R.evaluateChallenge(c, trades, { today: "2026-03-16" });
	assert.equal(ev.payout.ready, true);
	assert.equal(ev.alerts.some((a) => a.kind === "payout" && a.amount === 3000), true);
	// Withdrawing everything leaves the floor 10,000 away.
	assert.equal(ev.payout.roomAfter, 10000);
});

test("payout: a recorded payout lowers the balance and starts a new cycle", () => {
	const c = R.addPayout(funded({ waitDays: 14, split: 80, minProfit: pct(1), minDays: 2 }), { day: "2026-03-16", amount: 3000, received: 2400 });
	const trades = [trade("2026-03-03", 1800), trade("2026-03-10", 1200), trade("2026-03-17", 400)];
	const ev = R.evaluateChallenge(c, trades, { today: "2026-03-20" });
	assert.equal(ev.current.balance, 100400);
	assert.equal(ev.payout.cycleStart, "2026-03-16");
	assert.equal(ev.payout.from, "2026-03-30");
	assert.equal(ev.payout.days, 1);
	assert.equal(ev.payout.daysMissing, 1);
	assert.equal(ev.payout.profitMissing, 600);
	assert.equal(ev.payout.ready, false);
	// The payout is on the balance curve, so a dip reads as money taken out.
	assert.equal(ev.current.curve.some((p) => p.payout && p.balance === 100000), true);
});

test("payout: nothing to take without a profit, and nothing at all on a failed account", () => {
	let ev = R.evaluateChallenge(funded({}), [trade("2026-03-03", -200)], { today: "2026-03-20" });
	assert.equal(ev.payout.ready, false);
	assert.equal(ev.payout.available, 0);
	ev = R.evaluateChallenge(funded({}), [trade("2026-03-03", 2000), trade("2026-03-04", -12500)], { today: "2026-03-20" });
	assert.equal(ev.current.status, "failed");
	assert.equal(ev.payout.ready, false);
});

// ── Currency and economics ─────────────────────────────────────────────────

test("trades in another currency are left out and counted apart", () => {
	const ev = R.evaluateChallenge(challenge({ profitTarget: pct(10) }), [trade("2026-01-05", 1000), trade("2026-01-06", 5000, { currency: "EUR" })], { today: "2026-01-06" });
	assert.equal(ev.current.profit, 1000);
	assert.equal(ev.otherCurrency, 1);
});

test("evaluation cost against payouts received", () => {
	const a = { ...challenge(), cost: 540, payouts: [{ day: "2026-03-20", amount: 2000, received: 1600 }] };
	a.phases[1].start = "2026-03-01";
	a.current = 1;
	const b = { ...challenge(), id: "c2", cost: 540 };
	const c = { ...challenge(), id: "c3", currency: "EUR", cost: null };
	const [usd, eur] = R.economics([a, b, c]);
	assert.equal(usd.currency, "USD");
	assert.equal(usd.challenges, 2);
	assert.equal(usd.funded, 1);
	assert.equal(usd.cost, 1080);
	assert.equal(usd.received, 1600);
	assert.equal(usd.net, 520);
	assert.equal(Math.round(usd.roi * 10) / 10, 48.1);
	assert.equal(eur.roi, null);
});

// ── Profiles and saved data ────────────────────────────────────────────────

test("profiles fill the phases, and the custom profile leaves the rules to the trader", () => {
	const ftmo = P.phasesFromProfile("ftmo");
	assert.deepEqual(ftmo.map((p) => p.name), ["FTMO Challenge", "Verification", "FTMO Account"]);
	assert.equal(ftmo[0].rules.profitTarget.value, 10);
	assert.equal(ftmo[1].rules.profitTarget.value, 5);
	assert.equal(ftmo[2].funded, true);
	assert.equal(ftmo[2].payout.split, 80);
	const next = P.phasesFromProfile("fundednext", { phase: (n) => `Étape ${n}`, funded: "Compte financé" });
	assert.deepEqual(next.map((p) => p.name), ["Étape 1", "Étape 2", "Compte financé"]);
	assert.equal(next[2].payout.split, null, "a value we are not sure of stays empty");
	const custom = P.phasesFromProfile("custom");
	assert.equal(custom.length, 2);
	assert.deepEqual(custom[0].rules, R.emptyRules());
	for (const p of P.PROFILES) assert.equal(p.phases[p.phases.length - 1].funded, true);
});

test("applying a profile keeps the dates and accounts of the phases", () => {
	const c = P.newChallenge({ id: "x", profile: "custom", account: "Acc", size: 50000, currency: "USD", start: "2026-01-05" });
	assert.equal(c.name, "50K");
	c.phases[0].account = "Phase account";
	const applied = P.applyProfile(c, "ftmo");
	assert.equal(applied.phases.length, 3);
	assert.equal(applied.phases[0].start, "2026-01-05");
	assert.equal(applied.phases[0].account, "Phase account");
	assert.equal(applied.phases[0].rules.minDays, 4);
	assert.equal(applied.firm, "FTMO");
});

test("saved data is read defensively", () => {
	const good = P.newChallenge({ id: "ok", profile: "ftmo", account: "Acc", size: 100000, currency: "EUR", start: "2026-01-05" });
	const list = P.normalizeChallenges({
		challenges: [
			good,
			{ id: "no-size", account: "Acc", phases: [{}] },
			{ id: "broken", account: "Acc", size: 10000, current: 9, phases: [{ name: "P1", rules: { maxLoss: { value: -3 }, maxLossMode: "weird" }, start: "not a day" }, "junk"], payouts: [{ day: "2026-02-01", amount: 100 }, { day: "x" }] },
			"junk",
		],
	});
	assert.equal(list.length, 2);
	assert.deepEqual(list[0], good);
	const b = list[1];
	assert.equal(b.current, 0);
	assert.equal(b.phases.length, 1);
	assert.equal(b.phases[0].rules.maxLoss, null);
	assert.equal(b.phases[0].rules.maxLossMode, "static");
	assert.equal(b.phases[0].start, null);
	assert.deepEqual(b.payouts, [{ day: "2026-02-01", amount: 100, received: 100 }]);
	assert.deepEqual(P.normalizeChallenges(undefined), []);
});

// ── The sample journal ─────────────────────────────────────────────────────

test("the sample journal shows an evaluation in progress and a funded account", () => {
	const trades = J.sampleTrades(Date.parse("2026-10-24T12:00:00Z"));
	const today = R.localDay(Date.parse("2026-10-24T12:00:00Z"));
	const [evaluation, fundedOne] = S.sampleChallenges(trades).map((c) => R.evaluateChallenge(c, trades, { today }));
	assert.equal(evaluation.challenge.account, "FTMO Challenge 100K");
	assert.equal(evaluation.current.status, "active");
	assert.equal(evaluation.current.trades.length, 20);
	assert.equal(rule(evaluation.current, "profitTarget").status, "pending");
	assert.equal(rule(evaluation.current, "minDays").status, "met");
	assert.equal(evaluation.current.rules.some((r) => r.status === "violated"), false);

	assert.equal(fundedOne.challenge.account, "FTMO Funded 100K");
	assert.equal(fundedOne.current.status, "funded");
	assert.equal(fundedOne.phases[0].status, "passed");
	assert.equal(fundedOne.current.trades.length, 24);
	assert.equal(fundedOne.challenge.payouts.length, 1);
	assert.equal(fundedOne.payout.ready, true);
	assert.equal(fundedOne.current.rules.some((r) => r.status === "violated"), false);
	const [eco] = R.economics(S.sampleChallenges(trades));
	assert.equal(eco.currency, "EUR");
	assert.equal(eco.net, 520);
});
