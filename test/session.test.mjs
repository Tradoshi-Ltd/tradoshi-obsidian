import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The session logic has no Obsidian dependency: bundle it on the fly and test it as is.
const dir = mkdtempSync(join(tmpdir(), "tradoshi-session-"));
async function load(entry) {
	const out = join(dir, entry.replace(/\W/g, "_") + ".mjs");
	writeFileSync(out, buildSync({ entryPoints: [entry], bundle: true, format: "esm", write: false }).outputFiles[0].text);
	return import(pathToFileURL(out).href);
}
const g = await load("src/session/gate.ts");
const l = await load("src/session/logic.ts");
const d = await load("src/session/defaults.ts");

const gate = (nodes, start = "a") => ({ id: "g", name: "Test", start, nodes });
const node = (id, ...options) => ({ id, question: `Question ${id}?`, options: options.map(([label, to]) => ({ label, to })) });
const kinds = (x) => g.validateGate(x).map((i) => `${i.kind}${i.node ? `:${i.node}` : ""}${i.option !== undefined ? `:${i.option}` : ""}`);

// ── Trade gate ──────────────────────────────────────────────────────────────

test("a finished gate has no issue", () => {
	const ok = gate([node("a", ["Yes", { node: "b" }], ["No", { outcome: "nogo", note: "Skip it" }]), node("b", ["Yes", { outcome: "go" }], ["No", { outcome: "wait" }])]);
	assert.deepEqual(kinds(ok), []);
	assert.ok(g.isRunnable(ok));
});

test("an answer that leads nowhere, or to a question that is gone, is reported", () => {
	const x = gate([node("a", ["Yes", { node: "b" }], ["No", null]), node("b", ["Yes", { outcome: "go" }], ["No", { node: "zz" }])]);
	assert.deepEqual(kinds(x), ["unwired:a:1", "dangling:b:1"]);
	assert.ok(g.isRunnable(x)); // Yes, Yes still reaches a decision
});

test("questions out of the tree, a missing start, a tree with no decision", () => {
	const lost = gate([node("a", ["Yes", { outcome: "go" }], ["No", { outcome: "nogo" }]), node("b", ["Yes", { outcome: "go" }], ["No", { outcome: "nogo" }])]);
	assert.deepEqual(kinds(lost), ["unreachable:b"]);
	assert.deepEqual(kinds({ ...lost, start: "zz" }), ["no-start"]);
	assert.ok(!g.isRunnable({ ...lost, start: "zz" }));
	const endless = gate([node("a", ["Yes", { node: "b" }], ["No", null]), node("b", ["Yes", null], ["No", null])]);
	assert.ok(kinds(endless).includes("no-outcome"));
	assert.ok(!g.isRunnable(endless));
});

test("loops are found, once each, wherever they are entered", () => {
	const looped = gate([
		node("a", ["Yes", { node: "b" }], ["No", { outcome: "nogo" }]),
		node("b", ["Yes", { node: "c" }], ["No", { outcome: "go" }]),
		node("c", ["Again", { node: "a" }], ["Stop", { outcome: "wait" }]),
		node("d", ["Self", { node: "d" }], ["Out", { outcome: "go" }]),
	]);
	const loops = g.findLoops(looped);
	assert.deepEqual(loops, [["a", "b", "c"], ["d"]]);
	assert.ok(kinds(looped).includes("loop:a"));
	assert.ok(kinds(looped).includes("loop:d"));
	assert.deepEqual(g.findLoops(gate([node("a", ["x", { node: "b" }], ["y", { node: "b" }]), node("b", ["z", { outcome: "go" }], ["w", { outcome: "go" }])])), []);
});

test("options: at least two, named, not twice the same", () => {
	const x = gate([node("a", ["Yes", { outcome: "go" }]), node("b", ["", { outcome: "go" }], ["yes", { outcome: "go" }], ["YES", { outcome: "go" }])], "a");
	const k = kinds(x);
	assert.ok(k.includes("few-options:a"));
	assert.ok(k.includes("empty-option:b:0"));
	assert.ok(k.includes("duplicate-option:b:2"));
});

test("a run follows the answers to a decision, and stops where the tree is unfinished", () => {
	const x = gate([node("a", ["Yes", { node: "b" }], ["No", { outcome: "nogo", note: "Skip it" }]), node("b", ["Yes", { outcome: "go" }], ["No", null])]);
	assert.equal(g.runGate(x, []).kind, "question");
	assert.equal(g.runGate(x, []).node.id, "a");
	const nogo = g.runGate(x, [{ node: "a", option: 1 }]);
	assert.deepEqual([nogo.kind, nogo.outcome, nogo.note], ["outcome", "nogo", "Skip it"]);
	const go = g.runGate(x, [{ node: "a", option: 0 }, { node: "b", option: 0 }]);
	assert.deepEqual([go.kind, go.outcome, go.steps.length], ["outcome", "go", 2]);
	assert.equal(g.runGate(x, [{ node: "a", option: 0 }, { node: "b", option: 1 }]).kind, "stuck");
	// An answer that no longer fits (the tree changed) is dropped.
	const stale = g.runGate(x, [{ node: "a", option: 0 }, { node: "zz", option: 0 }]);
	assert.deepEqual([stale.kind, stale.node.id, stale.steps.length], ["question", "b", 1]);
	assert.deepEqual(g.pathLabels(x, go.steps), ["Question a? Yes", "Question b? Yes"]);
	assert.equal(g.runGate({ ...x, start: "zz" }, []).kind, "invalid");
});

test("the tree is written out as an outline, a loop written once", () => {
	const x = gate([node("a", ["Yes", { node: "b" }], ["No", { outcome: "nogo", note: "n" }]), node("b", ["Back", { node: "a" }], ["Go", { outcome: "go" }], ["Later", null])]);
	assert.deepEqual(
		g.outline(x).map((o) => `${o.depth}:${o.kind}`),
		["0:question", "1:answer", "2:question", "3:answer", "4:repeat", "3:answer", "4:outcome", "3:answer", "4:unwired", "1:answer", "2:outcome"],
	);
});

test("removing a question unwires the answers that led to it", () => {
	const x = gate([node("a", ["Yes", { node: "b" }], ["No", { outcome: "nogo" }]), node("b", ["Yes", { outcome: "go" }], ["No", { outcome: "wait" }])]);
	const y = g.removeNode(x, "b");
	assert.deepEqual(y.nodes.map((n) => n.id), ["a"]);
	assert.equal(y.nodes[0].options[0].to, null);
	assert.equal(g.removeNode(x, "a").start, "b");
	assert.equal(g.newNodeId(x), "q3");
	const copy = g.cloneGate(x);
	copy.nodes[0].options[0].label = "changed";
	assert.equal(x.nodes[0].options[0].label, "Yes");
});

test("the starter gate is valid and runnable in the four languages", () => {
	for (const lang of ["en", "fr", "es", "pt"]) {
		const s = d.starterGate(lang);
		assert.deepEqual(g.validateGate(s), [], lang);
		assert.ok(g.isRunnable(s));
		assert.equal(d.defaultChecklist(lang).length, 5);
		assert.ok(d.defaultLogTags(lang).includes(d.defaultLessonTag(lang)));
	}
});

// ── Windows and sessions ───────────────────────────────────────────────────

const london = { id: "w1", name: "London", start: "09:00", end: "11:30", days: [0, 1, 2, 3, 4] };
const ny = { id: "w2", name: "New York", start: "15:30", end: "17:30", days: [0, 1, 2, 3, 4] };
const asia = { id: "w3", name: "Asia", start: "23:00", end: "02:00", days: [6] };

test("where the clock stands against the trading windows", () => {
	const at = (weekday, hhmm) => l.windowStatus([london, ny, asia], weekday, l.minutesOf(hhmm), 30);
	assert.deepEqual([at(0, "08:10").phase, at(0, "08:10").window.name, at(0, "08:10").minutes], ["waiting", "London", 50]);
	assert.deepEqual([at(0, "08:40").phase, at(0, "08:40").minutes], ["prep", 20]);
	assert.deepEqual([at(0, "10:00").phase, at(0, "10:00").minutes], ["live", 90]);
	assert.deepEqual([at(0, "12:00").phase, at(0, "12:00").window.name], ["waiting", "New York"]);
	assert.equal(at(0, "18:00").phase, "done");
	assert.equal(at(5, "10:00").phase, "none"); // Saturday morning: no window
	assert.deepEqual([at(6, "23:30").phase, at(6, "23:30").minutes], ["live", 150]); // Sunday night, past midnight
	assert.deepEqual([at(0, "01:00").phase, at(0, "01:00").window.name], ["live", "Asia"]); // Monday 1:00, still Sunday's window
	assert.equal(l.minutesOf("24:00"), null);
	assert.equal(l.minutesOf("9:05"), 545);
});

const T0 = Date.parse("2026-10-20T09:00:00Z");
const MIN = 60000;
const session = (extra = {}) => ({
	id: "s1", day: "2026-10-20", window: "London", unplanned: false, reason: null, phase: "ended",
	prepAt: T0 - 20 * MIN, startAt: T0, endAt: T0 + 120 * MIN, breaks: [{ from: T0 + 30 * MIN, to: T0 + 45 * MIN }],
	checklist: [{ text: "Calendar", done: true }, { text: "Levels", done: false }],
	log: [
		{ at: T0 + 5 * MIN, kind: "note", tag: "Market", text: "Range #1 holds" },
		{ at: T0 + 10 * MIN, kind: "gate", text: "Setup? Yes", outcome: "go" },
		{ at: T0 + 50 * MIN, kind: "gate", text: "", outcome: "nogo" },
		{ at: T0 + 115 * MIN, kind: "note", tag: "Lesson", text: "Wait for\nthe retest" },
	],
	notePath: null, ...extra,
});
const sTrade = (min, pnl, extra = {}) => ({ key: `t${min}`, path: `Tradoshi/Trades/2026/t${min}.md`, symbol: "XAUUSD", side: "long", at: T0 + min * MIN, openAt: T0 + (min - 5) * MIN, pnl, currency: "USD", reviewed: false, ...extra });

test("live time leaves the breaks out; trades are those of the session", () => {
	const s = session();
	assert.equal(l.liveTime(s, 0), 105 * MIN);
	assert.equal(l.clock(105 * MIN), "1 h 45");
	assert.equal(l.clock(42 * MIN), "42 min");
	const ts = [sTrade(-30, 10), sTrade(20, 100), sTrade(60, -40), sTrade(200, 5), sTrade(-10, 7, { openAt: T0 - 15 * MIN })];
	assert.deepEqual(l.sessionTrades(s, ts, 0).map((t) => t.pnl), [7, 100, -40]);
	const sum = l.summary(s, l.sessionTrades(s, ts, 0), 0, "Lesson");
	assert.deepEqual([sum.trades, sum.net, sum.wins, sum.losses, sum.notes, sum.lessons, sum.checklistDone], [3, 67, 2, 1, 2, 1, 1]);
	assert.deepEqual(sum.gate, { go: 1, nogo: 1, wait: 0 });
});

test("the session note reads without the plugin", () => {
	const s = session({ unplanned: true, reason: "News spike" });
	const ts = [sTrade(20, 100)];
	const time = (ms) => new Date(ms).toISOString().slice(11, 16);
	const md = l.sessionMarkdown(s, ts, 0, time, true, "Lesson");
	assert.ok(md.includes("**Live:** 09:00 → 11:00 (1 h 45)"));
	assert.ok(md.includes("**Unplanned**: News spike"));
	assert.ok(md.includes("- [x] Calendar") && md.includes("- [ ] Levels"));
	assert.ok(md.includes("- 09:05 · Market · Range \\#1 holds"));
	assert.ok(md.includes("- 09:10 · Trade gate · GO · Setup? Yes"));
	assert.ok(md.includes("- 09:20 · Trade · [[Tradoshi/Trades/2026/t20|XAUUSD long]] +100.00 USD"));
	assert.ok(md.includes("- 10:55 · Lesson · Wait for the retest"));
	assert.ok(!l.sessionMarkdown(s, ts, 0, time, false, "Lesson").includes("· Trade ·"));
	assert.equal(l.logSection(`x\n## Log\n\n- 09:05 · a\n- 09:06 · b\n\n## My notes\nmine`), "- 09:05 · a\n- 09:06 · b");
	assert.equal(l.logSection("## Log\n- one\n%% tradoshi:end %%\n"), "- one");
	assert.equal(l.logSection("no log"), null);
	const fm = l.sessionFrontmatter(s, ts, 0, (ms) => new Date(ms).toISOString().slice(0, 16), "[[Tradoshi/Days/2026/2026-10-20|2026-10-20]]", "Lesson");
	assert.deepEqual([fm.tradoshi_session, fm.session_day, fm.unplanned, fm.reason, fm.live_minutes, fm.trades, fm.pnl, fm.gate_go, fm.checklist], ["s1", "2026-10-20", true, "News spike", 105, 1, 100, 1, "1/2"]);
	assert.ok(!("tradoshi_day" in fm)); // never taken for a day note by the sync
	assert.equal(l.sessionFileName(s, "09:02", "Unplanned"), "2026-10-20 0902 London");
	assert.equal(l.sessionFileName({ ...s, window: null }, "09:02", "Unplanned"), "2026-10-20 0902 Unplanned");
});
