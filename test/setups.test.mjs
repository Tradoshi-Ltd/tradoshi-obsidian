import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The figures of the setups, the execution gap, the comparison, the rules and playbook
// of a sheet, and the links from the trade notes to the sheets, on trades written by
// hand: every expected value is worked out in the comment next to it. The sample sheets
// read the language of Obsidian, so "obsidian" is replaced by a stub for them.
const dir = mkdtempSync(join(tmpdir(), "tradoshi-setups-"));
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
const L = await load("src/setups/logic.ts");
const S = await load("src/setups/sample.ts");
const J = await load("src/journal-data.ts");
const D = await load("src/sample-data.ts");

let seq = 0;
/** A trade closed on `day` at noon UTC, in creation order within a day. */
function trade(day, pnl, o = {}) {
	seq++;
	const at = Date.parse(`${day}T12:00:00Z`) + seq;
	return {
		key: `k${seq}`, path: null, account: "A", currency: "USD", symbol: o.symbol ?? "EURUSD", side: o.side ?? "long",
		at, day, hour: o.hour ?? null, openAt: null, pnl, r: o.r ?? null, emotion: null, followedPlan: o.plan ?? null,
		tags: o.tags ?? [], entry: null, exit: null, volume: null, stopLoss: null, takeProfit: null, fees: 0, rating: null, broker: null, reviewed: false,
	};
}
const close = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≠ ${expected}`);
const CATS = { Breakout: "Setups", Pullback: "Setups", Oversized: "Mistakes", Impulsive: "Mistakes", London: "" };
const meta = (name, o = {}) => ({ name, aliases: [], path: `Tradoshi/Setups/${name}.md`, description: "", markets: [], sessions: [], timeframe: "", status: "active", color: null, playbook: null, ...o });

// ── Sheets ──────────────────────────────────────────────────────────────────

test("a sheet is a note with tradoshi_setup: true, named by its setup property or its file", () => {
	assert.equal(L.metaFromProperties({ setup: "Breakout" }, "a.md", "a"), null);
	assert.equal(L.metaFromProperties(null, "a.md", "a"), null);
	const m = L.metaFromProperties(
		{ tradoshi_setup: true, setup: " Breakout ", description: "Range break", markets: ["XAUUSD", "US30"], sessions: "London, New York", timeframe: ["M5", "M15"], status: "En pause", color: "#14A3A0", aliases: ["BO", "breakout"], playbook: "[[Notes/Breakout playbook|playbook]]" },
		"Tradoshi/Setups/Breakout.md",
		"Breakout",
	);
	assert.equal(m.name, "Breakout");
	assert.deepEqual(m.markets, ["XAUUSD", "US30"]);
	assert.deepEqual(m.sessions, ["London", "New York"]); // a comma-separated text is a list too
	assert.equal(m.timeframe, "M5, M15");
	assert.equal(m.status, "paused"); // the French word
	assert.equal(m.color, "#14A3A0");
	assert.deepEqual(m.aliases, ["BO"]); // its own name is not an alias
	assert.equal(m.playbook, "Notes/Breakout playbook");
	const bare = L.metaFromProperties({ tradoshi_setup: "true", color: "teal", status: "whatever" }, "x/Scalp.md", "Scalp");
	assert.equal(bare.name, "Scalp");
	assert.equal(bare.color, null); // only hexadecimal colours
	assert.equal(bare.status, "active");
	assert.equal(L.statusOf("prueba"), "testing");
	assert.equal(L.statusOf("Pausado"), "paused");
});

test("a trade belongs to its Setups tags and to the tags naming a sheet, once each", () => {
	const sheets = L.indexMetas([meta("Breakout", { aliases: ["BO"] }), meta("Scalp")]);
	// "bo" is an alias of Breakout; "scalp" names a sheet without being in the Setups category.
	assert.deepEqual(L.setupsOfTrade(["Breakout", "bo", "Pullback", "Oversized", "scalp"], CATS, sheets), [
		{ key: "breakout", name: "Breakout" },
		{ key: "pullback", name: "Pullback" },
		{ key: "scalp", name: "Scalp" },
	]);
	assert.deepEqual(L.setupsOfTrade(["London", "Oversized"], CATS, sheets), []);
});

test("setup figures: result, win rate, expectancy, profit factor, R, drawdown, curve", () => {
	const ts = [trade("2026-10-01", 100, { r: 1, tags: ["Breakout"] }), trade("2026-10-02", -50, { r: -0.5, tags: ["Breakout"] }), trade("2026-10-03", 0, { tags: ["Breakout"] }), trade("2026-10-05", 70, { r: 0.7, tags: ["Breakout"] })];
	const s = L.setupStats(ts);
	assert.equal(s.trades, 4);
	assert.equal(s.net, 120);
	assert.equal(s.winRate, (2 / 3) * 100); // the break-even trade is left out
	assert.equal(s.expectancy, 30); // 120 ÷ 4
	close(s.profitFactor, 170 / 50);
	close(s.avgR, (1 - 0.5 + 0.7) / 3);
	assert.equal(s.rCount, 3);
	assert.equal(s.maxDrawdown, 50); // 100 → 50
	assert.deepEqual(s.curve, [100, 50, 50, 120]);
	assert.equal(s.best.pnl, 100);
	assert.equal(s.worst.pnl, -50);
	const empty = L.setupStats([]);
	assert.equal(empty.trades, 0);
	assert.equal(empty.expectancy, null);
	assert.equal(empty.first, null);
});

test("one row per sheet and per setup used; a trade with two setups counts in both", () => {
	const ts = [trade("2026-10-01", 100, { tags: ["Breakout"] }), trade("2026-10-02", -40, { tags: ["Breakout", "Pullback"] }), trade("2026-10-03", 30, { tags: ["Oversized"] })];
	const rows = L.setupRows(ts, CATS, [meta("Range")]);
	const by = Object.fromEntries(rows.map((r) => [r.key, r]));
	assert.deepEqual(Object.keys(by).sort(), ["breakout", "pullback", "range"]);
	assert.equal(by.range.stats.trades, 0); // the sheet is there without a trade
	assert.equal(by.range.meta.name, "Range");
	assert.equal(by.breakout.stats.net, 60);
	assert.equal(by.pullback.stats.net, -40);
	assert.equal(by.breakout.meta, null);
});

test("sorting: best first, setups without a value last; the ranking puts small samples after", () => {
	const row = (name, n, net) => ({ key: name.toLowerCase(), name, meta: null, trades: [], stats: { ...L.setupStats([]), trades: n, net, expectancy: n ? net / n : null } });
	const rows = [row("A", 3, 300), row("B", 12, 240), row("C", 0, 0), row("D", 20, -100)];
	assert.deepEqual(L.sortRows(rows, "net").map((r) => r.name), ["A", "B", "D", "C"]);
	assert.deepEqual(L.sortRows(rows, "expectancy").map((r) => r.name), ["A", "B", "D", "C"]); // 100, 20, -5, none
	assert.deepEqual(L.rankRows(rows, "expectancy", 10).map((r) => r.name), ["B", "D", "A"]); // A has 3 trades: after; C has none: out
	assert.deepEqual(L.sortRows(rows, "trades").map((r) => r.name), ["D", "B", "A", "C"]);
});

// ── Curves ──────────────────────────────────────────────────────────────────

test("curves of several setups by date and by trade number", () => {
	const a = [{ at: 1, pnl: 10, r: 1 }, { at: 3, pnl: -5, r: null }];
	const b = [{ at: 2, pnl: 7, r: 0.5 }];
	assert.deepEqual(L.overlayByTime([a, b], "money"), { xs: [1, 2, 3], values: [[10, 10, 5], [null, 7, 7]] });
	assert.deepEqual(L.overlayByCount([a, b], "money"), { xs: [1, 2], values: [[10, 5], [7, null]] });
	// In R, the trade without an R multiple is left out.
	assert.deepEqual(L.overlayByTime([a, b], "r"), { xs: [1, 2], values: [[1, 1], [null, 0.5]] });
	assert.deepEqual(L.cumulative(a, "r").map((p) => p.value), [1]);
});

// ── Execution gap ───────────────────────────────────────────────────────────

test("execution gap: what the trades off the plan and with a mistake cost", () => {
	const ts = [
		trade("2026-10-01", 100, { plan: true, tags: ["Breakout"] }),
		trade("2026-10-01", 50, { plan: true, tags: ["Breakout"] }),
		trade("2026-10-02", -30, { plan: true, tags: ["Breakout"] }),
		trade("2026-10-02", -60, { plan: false, tags: ["Breakout", "Oversized", "Impulsive"] }),
		trade("2026-10-03", 20, { plan: false, tags: ["Breakout", "Impulsive"] }),
		trade("2026-10-03", 10, { tags: ["Breakout"] }),
	];
	const g = L.executionGap(ts, CATS);
	// On the plan: 100 + 50 − 30 = 120 over 3, 40 a trade. Off: −60 + 20 = −40 over 2, −20 a trade.
	assert.equal(g.followed.expectancy, 40);
	assert.equal(g.broken.expectancy, -20);
	assert.equal(g.unknown, 1);
	assert.equal(g.planCost, 120); // 2 × (40 − (−20))
	// Clean: 100 + 50 − 30 + 10 = 130 over 4, 32.5 a trade. With a mistake: −40 over 2, −20.
	assert.equal(g.clean.expectancy, 32.5);
	assert.equal(g.withMistakes.trades, 2);
	assert.equal(g.mistakeCost, 105); // 2 × (32.5 + 20)
	assert.deepEqual(
		g.mistakes.map((m) => [m.tag, m.trades, m.net]),
		[
			["Oversized", 1, -60],
			["Impulsive", 2, -40],
		],
	);
	// Off-plan trades that did better give a negative cost; one empty side, none.
	assert.equal(L.gapCost(L.sideOf([{ pnl: 10, r: null }]), L.sideOf([{ pnl: 30, r: null }])), -20);
	assert.equal(L.executionGap([trade("2026-10-01", 5, { plan: true })], CATS).planCost, null);
});

test("live against missed and backtest: opportunities taken, missed edge, capture", () => {
	const k = L.kindGap([
		{ pnl: 100, r: 1, kind: "executed" },
		{ pnl: -50, r: -0.5, kind: "executed" },
		{ pnl: 80, r: 0.8, kind: "missed" },
		{ pnl: 40, r: 0.4, kind: "missed" },
		{ pnl: 10, r: 1, kind: "backtest" },
		{ pnl: -10, r: -1, kind: "backtest" },
		{ pnl: 20, r: 2, kind: "backtest" },
	]);
	assert.equal(k.taken, 50); // 2 taken of 4 seen
	assert.equal(k.missed.net, 120);
	assert.equal(k.livePlusMissed, 170);
	close(k.capture, (50 / 170) * 100);
	close(k.backtest.avgR, 2 / 3);
	assert.equal(k.live.avgR, 0.25);
	// Missed trades that would have lost: nothing to capture.
	assert.equal(L.kindGap([{ pnl: 10, r: null, kind: "executed" }, { pnl: -5, r: null, kind: "missed" }]).capture, null);
});

// ── Comparison ──────────────────────────────────────────────────────────────

test("pairs: two setups together against each one alone", () => {
	const ts = [
		{ pnl: 10, r: null, s: ["A"] },
		{ pnl: 30, r: null, s: ["A"] },
		{ pnl: -10, r: null, s: ["B"] },
		{ pnl: 50, r: null, s: ["B", "A"] },
		{ pnl: 70, r: null, s: ["A", "B"] },
	];
	const [p] = L.setupPairs(ts, (t) => t.s);
	assert.equal(p.a, "A");
	assert.equal(p.b, "B");
	assert.equal(p.together.trades, 2);
	assert.equal(p.together.expectancy, 60);
	assert.equal(p.aSolo.expectancy, 20);
	assert.equal(p.bSolo.expectancy, -10);
	assert.equal(p.edge, 40); // 60 − max(20, −10)
	assert.deepEqual(L.setupPairs([{ pnl: 1, r: null, s: ["A"] }], (t) => t.s), []);
});

test("best value of a row of figures", () => {
	assert.equal(L.bestIndex([10, 30, null, 20], "high"), 1);
	assert.equal(L.bestIndex([10, 30, null, 20], "low"), 0);
	assert.equal(L.bestIndex([5, 5], "high"), null); // all equal
	assert.equal(L.bestIndex([5, null], "high"), null); // one value only
});

test("the same groups side by side, most traded first", () => {
	const a = [{ pnl: 10, r: null, k: "X" }, { pnl: -5, r: null, k: "Y" }, { pnl: 7, r: null, k: "X" }];
	const b = [{ pnl: 3, r: null, k: "Z" }, { pnl: 1, r: null, k: "X" }];
	const c = L.crossBy([a, b], (t) => t.k, 2);
	assert.deepEqual(c.keys, ["X", "Y"]); // X 3 trades, then Y and Z with 1: Y by name, Z cut
	assert.equal(c.cells[0][0].net, 17);
	assert.equal(c.cells[0][1].net, 1);
	assert.equal(c.cells[1][1].trades, 0);
	assert.deepEqual(L.crossBy([a, b], (t) => t.k, 3, (x, y) => y.localeCompare(x)).keys, ["Z", "Y", "X"]);
});

test("best and worst trades", () => {
	const ts = [1, -2, 3, -4, 5, 0].map((p, i) => ({ pnl: p, at: i }));
	const e = L.extremes(ts, 2);
	assert.deepEqual(e.best.map((t) => t.pnl), [5, 3]);
	assert.deepEqual(e.worst.map((t) => t.pnl), [-4, -2]);
});

test("edge confidence: too early, noise, solid", () => {
	assert.equal(L.edgeConfidence([1, 2, 3]).level, "early");
	// Mean 0.8, standard deviation √0.4, standard error √0.4 ÷ √10 = 0.2: t = 4.
	const solid = L.edgeConfidence([1, 1, 1, 1, 1, 1, 1, 1, 1, -1]);
	close(solid.t, 4);
	assert.equal(solid.level, "solid");
	assert.equal(solid.positive, true);
	assert.equal(L.edgeConfidence([1, -1, 1, -1, 1, -1, 1, -1, 1, -1]).level, "noise");
	// The mirror image, t = −4: a setup that loses for sure.
	const losing = L.edgeConfidence([-1, -1, -1, -1, -1, -1, -1, -1, -1, 1]);
	assert.equal(losing.level, "solid");
	assert.equal(losing.positive, false);
	assert.equal(L.edgeConfidence([2, -1, 2, -1, 2, -1, 2, -1, 1, -1]).level, "noise"); // mean 0.4, sd ≈ 1.51, t ≈ 0.84
	assert.equal(L.edgeConfidence([3, -1, 3, -1, 3, -1, 3, -1, 2, -1]).level, "emerging"); // mean 0.9, sd ≈ 2.02, t ≈ 1.41
});

test("what a sheet still lacks", () => {
	assert.deepEqual(L.healthOf({ sheet: false, description: "", playbook: 0, rules: 0, examples: 0, trades: 50, status: "active", recent: 0 }), ["noSheet"]);
	assert.deepEqual(L.healthOf({ sheet: true, description: "x", playbook: 120, rules: 4, examples: 2, trades: 50, status: "active", recent: 3 }), []);
	assert.deepEqual(L.healthOf({ sheet: true, description: " ", playbook: 5, rules: 0, examples: 0, trades: 3, status: "paused", recent: 2 }), [
		"noDescription",
		"noPlaybook",
		"noRules",
		"noExamples",
		"pausedTraded",
		"fewTrades",
	]);
});

test("colours: the trader's own, a palette colour otherwise, never twice the same on one chart", () => {
	assert.equal(L.paletteIndex("Breakout"), L.paletteIndex(" breakout "));
	const h = L.distinctHues([
		{ name: "A", color: "#ff0000" },
		{ name: "B", color: "#FF0000" },
		{ name: "C", color: null },
	]);
	assert.equal(h[0].color, "#ff0000");
	assert.equal(h[1].color, null); // the same colour twice: B gets one of the palette
	assert.notEqual(h[1].index, h[2].index);
	const m = L.huesByKey([
		{ key: "b", name: "B", meta: null },
		{ key: "a", name: "A", meta: null },
		{ key: "b", name: "B", meta: null },
	]);
	assert.equal(m.size, 2);
	assert.deepEqual(m, L.huesByKey([{ key: "a", name: "A", meta: null }, { key: "b", name: "B", meta: null }])); // the order shown does not change them
});

// ── Rules and playbook ──────────────────────────────────────────────────────

const NOTE = [
	"---",
	"tradoshi_setup: true",
	"- [ ] not a rule, a property",
	"---",
	"",
	"```tradoshi-setup",
	"```",
	"",
	"## Playbook",
	"",
	"### Entry",
	"%% hint %%",
	"Enter on the close.",
	"",
	"### Management",
	"%% hint %%",
	"",
	"### Exit",
	"%% hint %%",
	"",
	"## Rules",
	"%% hint %%",
	"- [ ] First rule",
	"- [x] Second rule",
	"* [X] Third rule",
	"- [ ] ",
	"",
	"### Extra",
	"- [ ] Grouped rule",
	"",
	"## Examples",
	"%% hint %%",
	"![[shot.png]]",
	"",
	"```js",
	"# not a heading",
	"- [ ] not a rule, code",
	"```",
].join("\n");

test("rules: every item of a checklist, outside the properties and code, under its heading", () => {
	const rules = L.parseRules(NOTE);
	assert.deepEqual(
		rules.map((r) => [r.text, r.done, r.group]),
		[
			["First rule", false, "Rules"],
			["Second rule", true, "Rules"],
			["Third rule", true, "Rules"],
			["Grouped rule", false, "Extra"],
		],
	);
	assert.equal(NOTE.split("\n")[rules[0].line], "- [ ] First rule");
});

test("ticking a rule changes its line only, line endings kept; a line that moved is left alone", () => {
	const md = "a\r\n- [ ] Rule\r\nb";
	assert.equal(L.setRule(md, { line: 1, text: "Rule" }, true), "a\r\n- [x] Rule\r\nb");
	assert.equal(L.setRule(md, { line: 1, text: "Other" }, true), null);
	assert.equal(L.setRule(md, { line: 0, text: "Rule" }, true), null);
	const reset = L.resetRules(NOTE);
	assert.ok(L.parseRules(reset).every((r) => !r.done));
	assert.ok(reset.includes("- [ ] not a rule, a property")); // the properties are untouched
});

test("playbook: the note without its properties, figures block, checklist and empty headings", () => {
	const p = L.playbookMarkdown(NOTE);
	assert.ok(p.startsWith("## Playbook"));
	assert.ok(p.includes("### Entry\n%% hint %%\nEnter on the close."));
	for (const gone of ["tradoshi_setup", "tradoshi-setup", "### Management", "### Exit", "First rule", "- [ ]\n", "## Rules"]) assert.ok(!p.includes(gone), gone);
	// The code block stays, with its line that looks like a heading; "Extra" is left empty by the checklist.
	assert.ok(p.includes("```js\n# not a heading"));
	assert.ok(!p.includes("### Extra"));
	assert.ok(p.includes("## Examples\n%% hint %%\n![[shot.png]]"));
	// Text left once headings, comments and embeds are out: the sentence and the code block (its heading-like line aside).
	assert.equal(L.playbookSize(NOTE), "Enter on the close.".length + "```js".length + "- [ ] not a rule, code".length + "```".length);
});

test("a new sheet: properties, figures block, empty playbook and checklist", () => {
	const tx = { playbook: "Playbook", entry: "Entry", management: "Management", exit: "Exit", rules: "Rules", examples: "Examples", hintEntry: "e", hintManagement: "m", hintExit: "x", hintRules: "r", hintExamples: "s" };
	const note = L.sheetNote('Break "out"', tx, "London range");
	assert.ok(note.startsWith("---\ntradoshi_setup: true\nsetup: \"Break \\\"out\\\"\"\ndescription: \"London range\"\n"));
	assert.ok(note.includes("```tradoshi-setup\n```"));
	assert.ok(note.includes("status: active"));
	assert.deepEqual(L.parseRules(note), []); // the empty item is not a rule yet
	assert.equal(L.playbookMarkdown(note), ""); // nothing written: no playbook
	assert.equal(L.playbookSize(note), 0);
	assert.equal(L.sheetFileName('A/B: "c"? [d]'), "A B c d");
	assert.equal(L.sheetFileName("..."), "Setup");
});

// ── Links from the trade notes ──────────────────────────────────────────────

test("links to the sheets: the trader's other links kept, stale ones dropped, missing ones added", () => {
	assert.equal(L.linkTargetOf("[[Tradoshi/Setups/Breakout|Breakout]]"), "Tradoshi/Setups/Breakout");
	assert.equal(L.linkTargetOf("[[Note#Heading]]"), "Note");
	assert.equal(L.linkTargetOf("Breakout"), null);
	assert.equal(L.setupLink("Tradoshi/Setups/Breakout.md", "Breakout"), "[[Tradoshi/Setups/Breakout|Breakout]]");
	assert.equal(L.setupLink("S/A b.md", "A|b"), "[[S/A b|A b]]");
	const sheets = { "Tradoshi/Setups/Old": "Tradoshi/Setups/Old.md", "Tradoshi/Setups/Breakout": "Tradoshi/Setups/Breakout.md", "Tradoshi/Setups/Pullback": "Tradoshi/Setups/Pullback.md" };
	const resolve = (e) => sheets[L.linkTargetOf(e)] ?? null;
	const wanted = new Map([
		["Tradoshi/Setups/Breakout.md", "[[Tradoshi/Setups/Breakout|Breakout]]"],
		["Tradoshi/Setups/Pullback.md", "[[Tradoshi/Setups/Pullback|Pullback]]"],
	]);
	const current = ["[[Notes/Idea]]", "[[Tradoshi/Setups/Old|Old]]", "[[Tradoshi/Setups/Breakout|Breakout]]", "[[Tradoshi/Setups/Breakout]]"];
	assert.deepEqual(L.nextSetupLinks(current, resolve, wanted), ["[[Notes/Idea]]", "[[Tradoshi/Setups/Breakout|Breakout]]", "[[Tradoshi/Setups/Pullback|Pullback]]"]);
	assert.equal(L.nextSetupLinks(["[[Notes/Idea]]", "[[Tradoshi/Setups/Breakout|Breakout]]", "[[Tradoshi/Setups/Pullback|Pullback]]"], resolve, wanted), null);
	assert.deepEqual(L.nextSetupLinks(["[[Tradoshi/Setups/Old|Old]]"], resolve, new Map()), []);
	assert.equal(L.nextSetupLinks([], resolve, new Map()), null);
});

// ── The sample journal ──────────────────────────────────────────────────────

test("the sample journal: three setups with their sheets, rules and playbook", () => {
	const trades = J.sampleTrades(Date.parse("2026-10-20T12:00:00Z"));
	const sheets = S.sampleSheets();
	assert.deepEqual(sheets.map((s) => s.meta.name), ["Breakout", "Pullback", "Range"]);
	for (const s of sheets) {
		assert.equal(L.parseRules(s.content).length, 4);
		assert.ok(L.playbookSize(s.content) > 100);
		assert.equal(s.meta.path, null);
	}
	const rows = L.setupRows(trades, D.SAMPLE_TAG_CATEGORIES, sheets.map((s) => s.meta));
	const by = Object.fromEntries(rows.map((r) => [r.name, r.stats]));
	assert.deepEqual([by.Breakout.trades, by.Pullback.trades, by.Range.trades], [52, 41, 32]);
	assert.ok(by.Pullback.net > 0 && by.Range.net < 0);
	// Range: 4 trades off the plan lost what 28 on the plan made back.
	const range = rows.find((r) => r.name === "Range");
	const g = L.executionGap(range.trades, D.SAMPLE_TAG_CATEGORIES);
	assert.equal(g.broken.trades, 4);
	assert.ok(g.planCost > 0);
	assert.deepEqual(L.rankRows(rows, "expectancy", L.EDGE_MIN_TRADES).map((r) => r.name)[2], "Range");
});
