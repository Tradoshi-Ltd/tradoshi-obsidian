import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The figures of the analytics widgets, on trades written by hand. Every expected value
// is worked out in the comment next to it.
const dir = mkdtempSync(join(tmpdir(), "tradoshi-analytics-"));
// Formats follow the language of Obsidian: "obsidian" is replaced by a stub (English).
const stubObsidian = {
	name: "stub-obsidian",
	setup(b) {
		b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
		b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const getLanguage = () => 'en';", loader: "js" }));
	},
};
async function load(entry) {
	const out = join(dir, entry.replace(/\W/g, "_") + ".mjs");
	const result = await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, plugins: [stubObsidian], logLevel: "silent" });
	writeFileSync(out, result.outputFiles[0].text);
	return import(pathToFileURL(out).href);
}
const a = await load("src/stats-advanced.ts");
const sample = await load("src/sample-data.ts");

const DAY = 86400000;
let seq = 0;
/** A trade closed at noon UTC of `day` (in creation order within a day). */
function trade(day, pnl, o = {}) {
	seq++;
	const at = Date.parse(`${day}T12:00:00Z`) + seq;
	return {
		key: `k${seq}`, path: null, account: "A", currency: "USD", symbol: o.symbol ?? "EURUSD", side: o.side ?? "long",
		at, day, hour: o.hour ?? null, openAt: o.heldMin === undefined ? null : at - o.heldMin * 60000,
		pnl, r: null, emotion: null, followedPlan: o.plan ?? null, tags: o.tags ?? [], entry: null, exit: null,
		volume: o.volume ?? null, stopLoss: null, takeProfit: null, fees: o.fees ?? 0, rating: null, broker: null,
	};
}
const close = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≠ ${expected}`);

// ── Days ────────────────────────────────────────────────────────────────────

test("day keys move by whole days, summer time included, and weeks start on Monday", () => {
	assert.equal(a.addDays("2026-03-28", 2), "2026-03-30");
	assert.equal(a.addDays("2026-01-01", -1), "2025-12-31");
	assert.equal(a.weekdayOf("2026-10-19"), 0);
	assert.equal(a.mondayOf("2026-10-25"), "2026-10-19"); // a Sunday belongs to the week before
});

// ── Ratios ──────────────────────────────────────────────────────────────────

test("Sharpe on trading days: mean ÷ standard deviation × √252", () => {
	// Days 100, -50, 50: mean 100/3, variance (66.67² + 83.33² + 16.67²) / 2 = 17500/3,
	// so mean ÷ sd = √(4/21) and × √252 gives √48.
	close(a.sharpe([100, -50, 50]), Math.sqrt(48));
	assert.equal(a.sharpe([100]), null); // one day
	assert.equal(a.sharpe([50, 50]), null); // no spread
});

test("Calmar: a year of trading days at this pace ÷ max drawdown", () => {
	// +100, -50, +50 on three days: max drawdown 50, mean day 100/3, × 252 = 8400, ÷ 50 = 168.
	const m = a.advancedMetrics([trade("2026-10-01", 100), trade("2026-10-02", -50), trade("2026-10-05", 50)], Date.parse("2026-10-06"));
	close(m.calmar, 168);
	close(m.sharpe, Math.sqrt(48));
	assert.equal(m.maxDrawdown, 50);
	close(m.recovery, 2); // net 100 ÷ drawdown 50
	assert.equal(a.calmar([100, 50], 0), null);
});

// ── Drawdown ────────────────────────────────────────────────────────────────

test("the drawdown curve is the distance to the highest point so far", () => {
	// Cumulative 100, 50, 20, 140, 130; highs 100, 100, 100, 140, 140.
	const ts = [100, -50, -30, 120, -10].map((p, i) => trade(`2026-10-0${i + 1}`, p));
	const dd = a.drawdownCurve(ts);
	assert.deepEqual(dd.map((p) => p.value), [0, -50, -80, 0, -10]);
	assert.deepEqual(dd.map((p) => p.peak), [100, 100, 100, 140, 140]);
	assert.equal(a.maxDrawdown(ts), 80);
	// The start counts as a high: a first loss is already a drawdown.
	assert.deepEqual(a.drawdownCurve([trade("2026-10-01", -20), trade("2026-10-02", 10)]).map((p) => p.value), [-20, -10]);
});

test("time under the high: since the last high, and the longest stretch", () => {
	// Cumulative 100 (high, 1 Oct), 50, 80, 120 (back above on 4 Oct), 110: below since 4 Oct.
	const ts = [100, -50, 30, 40, -10].map((p, i) => trade(`2026-10-0${i + 1}`, p));
	const now = Date.parse("2026-10-10T12:00:00Z");
	const u = a.underPeak(ts, now);
	assert.equal(u.below, true);
	assert.equal(u.peakAt, ts[3].at);
	assert.equal(Math.round(u.current / DAY), 6); // 4 → 10 Oct
	// 1 → 4 Oct (3 days, closed) against 4 → 10 Oct (6 days, still open): the open one.
	assert.equal(u.longest.open, true);
	assert.equal(u.longest.from, ts[3].at);
	const up = a.underPeak([trade("2026-10-01", 10), trade("2026-10-02", 20)], now);
	assert.equal(up.below, false);
	assert.equal(up.current, 0);
	assert.equal(up.longest, null);
});

// ── Streaks ─────────────────────────────────────────────────────────────────

test("streaks of wins and losses; a result at zero neither extends nor breaks them", () => {
	// W W 0 W | L L | W W | L: wins 0→3 (3, the zero skipped), losses 4→5 (2), then 1 loss now.
	const s = a.streaks([5, 5, 0, 5, -1, -1, 3, 3, -2]);
	assert.deepEqual(s.bestWin, { kind: "win", length: 3, from: 0, to: 3 });
	assert.deepEqual(s.bestLoss, { kind: "loss", length: 2, from: 4, to: 5 });
	assert.deepEqual(s.current, { kind: "loss", length: 1, from: 8, to: 8 });
	assert.deepEqual(a.streaks([]), { bestWin: null, bestLoss: null, current: null });
});

// ── Holding time, volume, fees ──────────────────────────────────────────────

test("holding times of winners and losers, over the trades with an open time", () => {
	// Winners held 60 and 120 min → 90; the loser 30 min; all three → 70; one trade without open time.
	const h = a.holdTimes([trade("2026-10-01", 10, { heldMin: 60 }), trade("2026-10-01", 20, { heldMin: 120 }), trade("2026-10-01", -5, { heldMin: 30 }), trade("2026-10-01", 5)]);
	assert.equal(h.winners, 90 * 60000);
	assert.equal(h.losers, 30 * 60000);
	assert.equal(h.all, 70 * 60000);
	assert.equal(h.known, 3);
	assert.equal(a.holdTimes([trade("2026-10-01", 5)]).winners, null);
});

test("advanced metrics: payoff, break-even, largest trades, volume and fees", () => {
	// Day 1: +200 (1 lot, -2 fees), -100 (0.5 lot, -2), 0 (no volume); day 2: +100 (-1).
	const ts = [
		trade("2026-10-01", 200, { volume: 1, fees: -2 }),
		trade("2026-10-01", -100, { volume: 0.5, fees: -2 }),
		trade("2026-10-01", 0),
		trade("2026-10-02", 100, { fees: -1 }),
	];
	const m = a.advancedMetrics(ts, Date.parse("2026-10-03"));
	assert.equal(m.avgWin, 150); // (200 + 100) / 2
	assert.equal(m.avgLoss, -100);
	assert.equal(m.payoff, 1.5);
	assert.equal(m.breakEvenRate, 25); // 1 trade of 4 at zero
	assert.equal(m.largestWin.pnl, 200);
	assert.equal(m.largestLoss.pnl, -100);
	assert.deepEqual(m.volume, { total: 1.5, average: 0.75, known: 2 });
	assert.deepEqual(m.fees, { total: -5, known: 3 });
	assert.equal(m.gross, 205); // net 200 before -5 of fees
	assert.equal(m.days, 2);
	assert.equal(m.tradesPerDay, 2);
	assert.equal(m.avgPerDay, 100);
	assert.equal(a.volumeStats([trade("2026-10-01", 5)]), null); // no volume written: said, not zero
});

// ── Rolling ─────────────────────────────────────────────────────────────────

test("rolling win rate and average win and loss over the last trades", () => {
	// Window of 3 over 10, -5, 20, 0, -10:
	// [10, -5, 20] → 2 of 3, win 15, loss 5; [-5, 20, 0] → 1 of 2, 20, 5; [20, 0, -10] → 1 of 2, 20, 10.
	const r = a.rolling([10, -5, 20, 0, -10].map((p, i) => trade(`2026-10-0${i + 1}`, p)), 3);
	assert.equal(r.length, 3);
	close(r[0].winRate, 200 / 3);
	assert.deepEqual([r[0].avgWin, r[0].avgLoss], [15, 5]);
	assert.deepEqual([r[1].winRate, r[1].avgWin, r[1].avgLoss], [50, 20, 5]);
	assert.deepEqual([r[2].winRate, r[2].avgWin, r[2].avgLoss], [50, 20, 10]);
	assert.equal(a.rolling([trade("2026-10-01", 5)], 3).length, 0);
});

// ── Long and short ──────────────────────────────────────────────────────────

test("long against short, and their cumulative curves", () => {
	const ts = [trade("2026-10-01", 100), trade("2026-10-02", -40, { side: "short" }), trade("2026-10-03", -20)];
	const s = a.bySide(ts);
	assert.equal(s.long.trades, 2);
	assert.equal(s.long.net, 80);
	assert.equal(s.long.winRate, 50);
	assert.equal(s.long.expectancy, 40);
	assert.equal(s.short.net, -40);
	assert.equal(s.short.winRate, 0);
	const c = a.sideCurves(ts);
	assert.deepEqual(c.map((p) => [p.long, p.short]), [[100, 0], [100, -40], [80, -40]]);
	assert.deepEqual([c[2].longN, c[2].shortN], [2, 1]);
});

// ── Hours ───────────────────────────────────────────────────────────────────

test("by hour: one lucky trade does not make the best hour", () => {
	const ts = [
		// 9h: three trades on two days, +150.
		trade("2026-10-01", 100, { hour: 9 }), trade("2026-10-01", -50, { hour: 9 }), trade("2026-10-02", 100, { hour: 9 }),
		// 10h: one trade, +500: too few to count.
		trade("2026-10-02", 500, { hour: 10 }),
		// 14h: three trades on three days, -90.
		trade("2026-10-01", -30, { hour: 14 }), trade("2026-10-02", -30, { hour: 14 }), trade("2026-10-03", -30, { hour: 14 }),
		// No open time.
		trade("2026-10-03", 40),
	];
	const { buckets, unknown } = a.byHour(ts);
	assert.equal(unknown, 1);
	assert.deepEqual([buckets[9].trades, buckets[9].net, buckets[9].wins, buckets[9].losses, buckets[9].days], [3, 150, 2, 1, 2]);
	assert.equal(a.hourSample(7), 3); // max(3, 5 % of 7)
	assert.equal(a.hourSample(200), 10);
	assert.equal(a.rankHour(buckets, 3, "best").hour, 9);
	assert.equal(a.rankHour(buckets, 3, "worst").hour, 14);
	assert.equal(a.rankHour(buckets, 4, "best"), null);
});

// ── Symbols and tags ────────────────────────────────────────────────────────

test("top groups keep those that weigh most and merge the rest into others", () => {
	// A +300 (2 trades), B -200, C +50, D +10, E -5: keep A and B, others = C, D, E: +55 on 3 trades.
	const ts = [
		trade("2026-10-01", 200, { symbol: "A" }), trade("2026-10-02", 100, { symbol: "A" }), trade("2026-10-01", -200, { symbol: "B" }),
		trade("2026-10-01", 50, { symbol: "C" }), trade("2026-10-01", 10, { symbol: "D" }), trade("2026-10-01", -5, { symbol: "E" }),
	];
	const g = a.topGroups(ts, (t) => [t.symbol], 2);
	assert.deepEqual(g.groups.map((x) => [x.label, x.net, x.trades]), [["A", 300, 2], ["B", -200, 1]]);
	assert.deepEqual([g.others.net, g.others.trades, g.others.count], [55, 3, 3]);
	// Three groups for two places plus others: shown in full, by result.
	const few = a.topGroups(ts.slice(0, 4), (t) => [t.symbol], 2);
	assert.deepEqual(few.groups.map((x) => x.label), ["A", "C", "B"]);
	assert.equal(few.others, null);
});

test("a trade with two of the merged tags counts once in others", () => {
	// a +100, b -80 kept; c (+10) and d (+10 - 5) merged: trades t3 and t4, +5, not +15.
	const ts = [trade("2026-10-01", 100, { tags: ["a"] }), trade("2026-10-01", -80, { tags: ["b"] }), trade("2026-10-01", 10, { tags: ["c", "d"] }), trade("2026-10-01", -5, { tags: ["d"] })];
	const g = a.topGroups(ts, (t) => t.tags, 2);
	assert.deepEqual(g.groups.map((x) => x.label), ["a", "b"]);
	assert.deepEqual([g.others.net, g.others.trades, g.others.count], [5, 2, 2]);
});

test("other tags leave out setups and mistakes", () => {
	const t = trade("2026-10-01", 1, { tags: ["Breakout", "London", "Oversized", "news"] });
	assert.deepEqual(a.otherTags(t, { Breakout: "Setups", Oversized: "mistakes" }), ["London", "news"]);
});

// ── Year map ────────────────────────────────────────────────────────────────

test("year map: 53 weeks from Monday, the last holding the end day", () => {
	const days = new Map([
		["2025-10-19", { pnl: 999, trades: 1 }], // the day before the map
		["2026-10-20", { pnl: 100, trades: 1 }],
		["2026-10-21", { pnl: -200, trades: 2 }],
		["2026-10-22", { pnl: 50, trades: 1 }],
		["2026-10-23", { pnl: 400, trades: 3 }],
	]);
	const g = a.yearGrid(days, "2026-10-24");
	assert.equal(g.weeks.length, 53);
	assert.equal(g.weeks[0][0].day, "2025-10-20"); // 52 weeks before Monday 19 Oct 2026
	assert.equal(g.weeks[52][0].day, "2026-10-19");
	assert.equal(g.weeks[52][5].day, "2026-10-24");
	assert.equal(g.weeks[52][5].future, false);
	assert.equal(g.weeks[52][6].future, true);
	// Sizes 50, 100, 200, 400: the 90th percentile (4th of 4) is 400.
	assert.equal(g.scale, 400);
	assert.deepEqual(g.weeks[52].slice(1, 5).map((c) => c.level), [1, -2, 1, 4]); // 100/400 → 1, 200/400 → 2, 50/400 → 1
	assert.equal(g.weeks[52][0].level, 0);
	assert.equal(g.weeks[52][0].pnl, null);
	assert.equal(g.traded, 4);
	assert.equal(g.net, 350);
	assert.deepEqual(g.months[0], { week: 1, month: 10, year: 2025 }); // 1 Nov 2025 falls in the second week
});

test("map colours scale on the 90th percentile, so one big day does not wash out the rest", () => {
	assert.equal(a.heatScale(Array.from({ length: 20 }, (_, i) => i + 1)), 18); // 18th of 20
	assert.equal(a.heatLevel(20, 18), 4);
	assert.equal(a.heatLevel(9, 18), 2);
	assert.equal(a.heatLevel(-4.5, 18), -1);
	assert.equal(a.heatLevel(0, 18), 0);
});

// ── Week ────────────────────────────────────────────────────────────────────

test("week summary: this week against the one before", () => {
	const ts = [trade("2026-10-19", 100), trade("2026-10-19", -30), trade("2026-10-21", -50), trade("2026-10-13", 200)];
	const { current, previous } = a.weekSummary(ts, "2026-10-22");
	assert.equal(current.monday, "2026-10-19");
	assert.deepEqual([current.net, current.trades, current.wins, current.losses, current.daysTraded], [20, 3, 1, 2, 2]);
	close(current.winRate, 100 / 3);
	assert.deepEqual(current.best, { day: "2026-10-19", pnl: 70 });
	assert.deepEqual(current.worst, { day: "2026-10-21", pnl: -50 });
	assert.deepEqual(current.days.map((d) => d.pnl), [70, null, -50, null, null, null, null]);
	assert.equal(previous.monday, "2026-10-12");
	assert.equal(previous.net, 200);
});

// ── Score ───────────────────────────────────────────────────────────────────

/** Ten trades over five days, plan followed on eight. */
function scored(plan = true) {
	const rows = [
		["2026-10-05", 200, true], ["2026-10-05", -100, true],
		["2026-10-06", 150, true], ["2026-10-06", 50, true],
		["2026-10-07", -100, false], ["2026-10-07", -50, false],
		["2026-10-08", 300, true], ["2026-10-08", -100, true],
		["2026-10-09", 100, true], ["2026-10-09", -50, true],
	];
	return rows.map(([d, p, f]) => trade(d, p, { plan: plan ? f : null }));
}

test("trading score: every part and its points", () => {
	// Wins 800, losses 400: profit factor 2 → 100 pts; win rate 50 % → (50-30)/30 = 66.7 pts;
	// payoff 160/80 = 2 → 100; winning days 4 of 5 = 80 % → 100 (capped);
	// plan followed 8 of 10 = 80 % → (80-50)/50 = 60; drawdown: cumulative 200, 100, 250, 300, 200,
	// 150, 450, 350, 450, 400, max 150, net 400 ÷ 150 = 2.67 → 88.9 pts.
	// Score: (25×100 + 15×66.7 + 15×100 + 15×100 + 15×60 + 15×88.9) / 100 = 87.3 → 87.
	const s = a.tradingScore(scored());
	const part = (id) => s.parts.find((p) => p.id === id);
	assert.equal(part("profitFactor").value, 2);
	assert.equal(part("winRate").value, 50);
	assert.equal(part("payoff").value, 2);
	assert.equal(part("greenDays").value, 80);
	assert.equal(part("discipline").value, 80);
	close(part("recovery").value, 400 / 150);
	close(part("winRate").points, 200 / 3);
	assert.equal(part("greenDays").points, 100);
	assert.equal(part("discipline").points, 60);
	close(part("recovery").points, 800 / 9);
	assert.equal(s.score, 87);
	assert.equal(s.weightUsed, 100);
});

test("trading score without the plan filled in: discipline is left out, its weight shared", () => {
	// (8733.3 - 900) / 85 = 92.2 → 92.
	const s = a.tradingScore(scored(false));
	assert.equal(s.parts.find((p) => p.id === "discipline").points, null);
	assert.equal(s.weightUsed, 85);
	assert.equal(s.score, 92);
});

test("trading score waits for 10 trades won or lost over 3 days", () => {
	const s = a.tradingScore(scored().slice(0, 9));
	assert.equal(s.score, null);
	assert.equal(s.decisive, 9);
	// No loss at all: profit factor and payoff take full points.
	const all = a.tradingScore(Array.from({ length: 10 }, (_, i) => trade(`2026-10-0${(i % 5) + 1}`, 10)));
	assert.equal(all.parts.find((p) => p.id === "profitFactor").value, Infinity);
	assert.equal(all.parts.find((p) => p.id === "profitFactor").points, 100);
	assert.equal(all.score, 100);
});

// ── Goals ───────────────────────────────────────────────────────────────────

test("goals: progress of the month and the daily loss limit", () => {
	// October: +1000, -600 (15th), -250 and -300 today (22nd) → -150; September does not count.
	const ts = [trade("2026-09-30", 5000), trade("2026-10-01", 1000), trade("2026-10-15", -600), trade("2026-10-22", -250), trade("2026-10-22", -300)];
	const g = a.goalStatus(ts, { month: 2000, dayLoss: 500 }, "2026-10-22");
	assert.equal(g.month, "2026-10");
	assert.equal(g.monthNet, -150);
	assert.equal(g.monthTrades, 4);
	close(g.progress, -0.075);
	assert.equal(g.remaining, 2150);
	assert.equal(g.todayNet, -550);
	close(g.used, 1.1);
	assert.equal(g.breached, true);
	assert.deepEqual(g.breachedDays, ["2026-10-15", "2026-10-22"]);
	const none = a.goalStatus(ts, {}, "2026-10-22");
	assert.deepEqual([none.progress, none.remaining, none.used, none.breached, none.breachedDays], [null, null, null, false, []]);
});

test("amounts typed in the goals window", () => {
	assert.equal(a.parseAmount("1 250,50"), 1250.5);
	assert.equal(a.parseAmount("2000"), 2000);
	assert.equal(a.parseAmount("  "), null);
	assert.equal(a.parseAmount("abc"), undefined);
	assert.equal(a.parseAmount("-5"), undefined);
});

// ── The sample journal ──────────────────────────────────────────────────────

test("the sample journal gives every widget something to show", () => {
	const last = Date.parse(sample.SAMPLE_LAST_CLOSE);
	const ts = sample.SAMPLE_TRADES.map((r, i) => {
		const [, symbol, short, openedMin, closedMin, , , volume, pnl, , , followed, tags] = r;
		const at = last - closedMin * 60000;
		return {
			...trade(new Date(at).toISOString().slice(0, 10), pnl, { symbol, side: short ? "short" : "long", volume, tags }),
			at,
			hour: new Date(last - openedMin * 60000).getUTCHours(),
			openAt: last - openedMin * 60000,
			followedPlan: followed === null ? null : followed === 1,
		};
	});
	const m = a.advancedMetrics(ts, last);
	assert.ok(m.sharpe !== null && m.calmar !== null && m.payoff !== null);
	assert.ok(m.hold.winners > 0 && m.hold.losers > 0);
	assert.ok(m.volume.total > 0);
	assert.equal(m.fees.known, 0); // no fee in the sample: the tile says so
	assert.ok(a.tradingScore(ts).score > 0);
	const { buckets } = a.byHour(ts);
	assert.ok(a.rankHour(buckets, a.hourSample(ts.length), "best"));
	assert.ok(a.rolling(ts, 20).length > 100);
	assert.ok(a.topGroups(ts, (t) => [t.symbol]).groups.length >= 4);
	assert.ok(a.yearGrid(new Map(a.dailyResults(ts).map((d) => [d.day, d])), new Date(last).toISOString().slice(0, 10)).traded > 50);
});

// ── Chart axis ──────────────────────────────────────────────────────────────

const charts = await load("src/widgets/analytics-charts.ts");

test("chart axes use round values and keep zero", () => {
	// The smallest step of 1, 2, 2.5 or 5 × 10ⁿ that needs 7 values at most.
	// -900 to 2 200: 500 would need 8 values (-1 000 to 2 500), 1 000 needs 5.
	assert.deepEqual(charts.niceTicks(-900, 2200), [-1000, 0, 1000, 2000, 3000]);
	// 0 to 718: 100 needs 9, 200 needs 5.
	assert.deepEqual(charts.niceTicks(0, 718), [0, 200, 400, 600, 800]);
	// -1 546 to 0: 250 needs 8 (-1 750 to 0), 500 needs 5.
	assert.deepEqual(charts.niceTicks(-1546, 0), [-2000, -1500, -1000, -500, 0]);
	// -596 to 10 600: 2 000 needs 8, 2 500 needs 7.
	assert.deepEqual(charts.niceTicks(-596, 10600), [-2500, 0, 2500, 5000, 7500, 10000, 12500]);
	assert.deepEqual(charts.niceTicks(0, 0), [0, 0.2, 0.4, 0.6, 0.8, 1]);
});
