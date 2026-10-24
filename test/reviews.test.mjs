import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The review logic has no Obsidian dependency: bundle it on the fly and test it as is.
const dir = mkdtempSync(join(tmpdir(), "tradoshi-reviews-"));
async function load(entry) {
	const out = join(dir, entry.replace(/\W/g, "_") + ".mjs");
	writeFileSync(out, buildSync({ entryPoints: [entry], bundle: true, format: "esm", write: false }).outputFiles[0].text);
	return import(pathToFileURL(out).href);
}
const p = await load("src/reviews/periods.ts");
const q = await load("src/reviews/questions.ts");
const d = await load("src/reviews/defaults.ts");
const s = await load("src/reviews/streaks.ts");
const f = await load("src/reviews/figures.ts");
const r = await load("src/render.ts");

// ── Periods ─────────────────────────────────────────────────────────────────

test("ISO weeks: a week belongs to the year of its Thursday", () => {
	assert.deepEqual(p.isoWeek("2026-10-20"), { year: 2026, week: 43 });
	assert.deepEqual(p.isoWeek("2025-12-29"), { year: 2026, week: 1 }); // a Monday, the week of 1 January 2026 (a Thursday)
	assert.deepEqual(p.isoWeek("2027-01-01"), { year: 2026, week: 53 }); // a Friday, still in 2026's last week
	assert.deepEqual(p.isoWeek("2027-01-04"), { year: 2027, week: 1 });
	assert.equal(p.weeksInYear(2026), 53);
	assert.equal(p.weeksInYear(2025), 52);
});

test("each kind of period has its id and its first and last day", () => {
	assert.deepEqual(p.periodOf("week", "2026-10-22"), { kind: "week", id: "2026-W43", start: "2026-10-19", end: "2026-10-25" });
	assert.deepEqual(p.periodOf("month", "2024-02-10"), { kind: "month", id: "2024-02", start: "2024-02-01", end: "2024-02-29" });
	assert.deepEqual(p.periodOf("quarter", "2026-11-05"), { kind: "quarter", id: "2026-Q4", start: "2026-10-01", end: "2026-12-31" });
	assert.deepEqual(p.periodOf("year", "2026-11-05"), { kind: "year", id: "2026", start: "2026-01-01", end: "2026-12-31" });
	assert.deepEqual(p.periodOf("day", "2026-10-20"), { kind: "day", id: "2026-10-20", start: "2026-10-20", end: "2026-10-20" });
});

test("an id is read back into its period, and a wrong one is refused", () => {
	for (const id of ["2026-10-20", "2026-W43", "2026-W01", "2026-W53", "2026-10", "2026-Q4", "2026"]) assert.equal(p.parsePeriod(id).id, id);
	assert.equal(p.parsePeriod("2026-W01").start, "2025-12-29");
	for (const id of ["2025-W53", "2026-13", "2026-Q5", "2026-02-30", "week 43", ""]) assert.equal(p.parsePeriod(id), null);
});

test("periods move by whole periods, across years", () => {
	assert.equal(p.shiftPeriod(p.parsePeriod("2026-W53"), 1).id, "2027-W01");
	assert.equal(p.shiftPeriod(p.parsePeriod("2026-W01"), -1).id, "2025-W52");
	assert.equal(p.shiftPeriod(p.parsePeriod("2026-01"), -1).id, "2025-12");
	assert.equal(p.shiftPeriod(p.parsePeriod("2026-11"), 3).id, "2027-02");
	assert.equal(p.shiftPeriod(p.parsePeriod("2026-Q1"), -1).id, "2025-Q4");
	assert.equal(p.shiftPeriod(p.parsePeriod("2026"), 1).id, "2027");
	assert.equal(p.shiftPeriod(p.parsePeriod("2026-03-01"), -1).id, "2026-02-28");
});

test("day, week, month, quarter, year: each one links to the one above and the ones below", () => {
	assert.equal(p.parentOf(p.parsePeriod("2026-10-20")).id, "2026-W43");
	// The week of Monday 28 September 2026 has its Thursday on 1 October: it is a week of October.
	assert.equal(p.parentOf(p.parsePeriod("2026-W40")).id, "2026-10");
	assert.equal(p.parentOf(p.parsePeriod("2026-10")).id, "2026-Q4");
	assert.equal(p.parentOf(p.parsePeriod("2026-Q4")).id, "2026");
	assert.equal(p.parentOf(p.parsePeriod("2026")), null);
	assert.deepEqual(p.childrenOf(p.parsePeriod("2026-W43")).map((x) => x.id), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
	assert.deepEqual(p.childrenOf(p.parsePeriod("2026-10")).map((x) => x.id), ["2026-W40", "2026-W41", "2026-W42", "2026-W43", "2026-W44"]);
	assert.deepEqual(p.childrenOf(p.parsePeriod("2026-09")).map((x) => x.id), ["2026-W36", "2026-W37", "2026-W38", "2026-W39"]);
	assert.deepEqual(p.childrenOf(p.parsePeriod("2026-Q4")).map((x) => x.id), ["2026-10", "2026-11", "2026-12"]);
	assert.deepEqual(p.childrenOf(p.parsePeriod("2026")).map((x) => x.id), ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
	// Every week of a month has that month as its parent.
	for (const w of p.childrenOf(p.parsePeriod("2026-10"))) assert.equal(p.parentOf(w).id, "2026-10");
});

test("review notes: path, link properties, links read back", () => {
	const week = p.parsePeriod("2026-W01");
	assert.equal(p.reviewPath("Tradoshi", week), "Tradoshi/Reviews/2026/2026-W01.md");
	assert.equal(p.noteLink("Tradoshi/Reviews/2026/2026-10.md", "October"), "[[Tradoshi/Reviews/2026/2026-10|October]]");
	const fm = p.reviewFrontmatter(week, {
		up: "[[Tradoshi/Reviews/2026/2026-01|2026-01]]",
		previous: null,
		next: "[[Tradoshi/Reviews/2026/2026-W02|2026-W02]]",
		children: ["[[Tradoshi/Days/2025/2025-12-29|2025-12-29]]"],
	});
	assert.equal(fm.tradoshi_review, "week");
	assert.equal(fm.period, "2026-W01");
	assert.equal(fm.review_month, "[[Tradoshi/Reviews/2026/2026-01|2026-01]]");
	assert.equal(fm.review_next, "[[Tradoshi/Reviews/2026/2026-W02|2026-W02]]");
	assert.ok(!("review_previous" in fm));
	assert.deepEqual(fm.review_days, ["[[Tradoshi/Days/2025/2025-12-29|2025-12-29]]"]);
	assert.equal(p.linkTarget("[[Tradoshi/Reviews/2026/2026-10|October]]"), "Tradoshi/Reviews/2026/2026-10");
	assert.equal(p.linkTarget("[[A note]]"), "A note");
	assert.equal(p.linkTarget("plain text"), null);
	assert.ok(p.linksTo(["[[x|1]]", "[[Tradoshi/Days/2026/2026-10-20|20]]"], "Tradoshi/Days/2026/2026-10-20.md"));
	assert.ok(!p.linksTo("[[x]]", "y.md"));
	assert.ok(p.reviewBody().startsWith("```tradoshi-review\n```"));
});

test("the day note carries the report card block, and stays readable without the plugin", () => {
	const ctx = { folder: "Tradoshi", appUrl: "https://app.tradoshi.com", appLinks: false, tradeNotes: true, dailyNotes: true, timeZone: "Europe/Paris", dayStartHour: 0 };
	const rec = { key: "a/1", path: "Tradoshi/Trades/2026/x", account: "Main", broker: null, currency: "USD", symbol: "XAUUSD", side: "long", day: "2026-10-20", closed: "2026-10-20T15:10", volume: 1, pnl: 120, r: 1.2 };
	const block = r.dayBlock(ctx, "2026-10-20", [rec], undefined);
	assert.ok(block.startsWith("```tradoshi-day\n```"));
	assert.ok(block.includes("+120.00 USD") && block.includes("[[Tradoshi/Trades/2026/x\\|XAUUSD long]]"));
	assert.ok(r.dayBlock(ctx, "2026-10-20", [], undefined).includes("No trades this day."));
});

// ── Questions ───────────────────────────────────────────────────────────────

const yesno = (id, extra = {}) => ({ id, text: id, kind: "yesno", ...extra });
const text = (id, extra = {}) => ({ id, text: id, kind: "text", ...extra });

test("a question shown only after a given answer, and only when its parent is shown", () => {
	const qs = [yesno("rules"), text("which", { showWhen: { id: "rules", value: "no" } }), text("why", { showWhen: { id: "which", value: "size" } }), text("always")];
	assert.deepEqual(q.visibleQuestions(qs, {}).map((x) => x.id), ["rules", "always"]);
	assert.deepEqual(q.visibleQuestions(qs, { rules: false }).map((x) => x.id), ["rules", "which", "always"]);
	assert.deepEqual(q.visibleQuestions(qs, { rules: false, which: "size" }).map((x) => x.id), ["rules", "which", "why", "always"]);
	// The parent hidden again: its follow-ups go with it, whatever their own answers.
	assert.deepEqual(q.visibleQuestions(qs, { rules: true, which: "size" }).map((x) => x.id), ["rules", "always"]);
	assert.deepEqual(q.progress(qs, { rules: false, which: "" }), { answered: 1, total: 3 });
});

test("answers are read back in the type of their question", () => {
	assert.equal(q.coerceAnswer(yesno("a"), "oui"), true);
	assert.equal(q.coerceAnswer(yesno("a"), false), false);
	assert.equal(q.coerceAnswer(yesno("a"), "maybe"), null);
	assert.equal(q.coerceAnswer({ id: "g", text: "g", kind: "scale" }, "4"), 4);
	assert.equal(q.coerceAnswer({ id: "g", text: "g", kind: "scale" }, 9), null);
	assert.equal(q.coerceAnswer(text("t"), "  "), null);
	assert.equal(q.coerceAnswer(text("t"), ["a", "b"]), "a, b");
	assert.deepEqual(q.answersOf({ review_rules: true, review_t: "x", rules: false }, [yesno("rules"), text("t"), text("u")]), { rules: true, t: "x" });
});

test("a property name is made from the question, unique and never one the plugin uses", () => {
	assert.equal(q.slugId("Did you follow your plan?", []), "did_you_follow_your_plan");
	assert.equal(q.slugId("Qu'as-tu bien fait ?", []), "qu_as_tu_bien_fait");
	assert.equal(q.slugId("Grade", ["grade"]), "grade_2");
	assert.equal(q.slugId("Done", []), "done_answer");
	assert.equal(q.slugId("1st thing", []), "q_1st_thing");
	assert.equal(q.slugId("???", []), "q");
});

test("question sets are checked before they are saved", () => {
	const kinds = (qs) => q.validateTemplate(qs).map((i) => `${i.index}:${i.kind}`);
	assert.deepEqual(kinds([yesno("a"), text("b", { showWhen: { id: "a", value: "no" } })]), []);
	assert.deepEqual(kinds([text("a"), text("a")]), ["1:id-duplicate"]);
	assert.deepEqual(kinds([text("Bad id")]), ["0:id-invalid"]);
	assert.deepEqual(kinds([text("done")]), ["0:id-reserved"]);
	assert.deepEqual(kinds([{ id: "c", text: "c", kind: "choice", options: ["x"] }]), ["0:options-missing"]);
	assert.deepEqual(kinds([{ id: "c", text: "c", kind: "choice", options: ["x", "X"] }]), ["0:option-duplicate"]);
	assert.deepEqual(kinds([text("b", { showWhen: { id: "a", value: "no" } })]), ["0:parent-missing"]);
	assert.deepEqual(kinds([text("b", { showWhen: { id: "a", value: "no" } }), yesno("a")]), ["0:parent-after"]);
	assert.deepEqual(kinds([text("a"), text("b", { showWhen: { id: "a", value: "x" } })]), ["1:parent-kind"]);
	assert.deepEqual(kinds([yesno("a"), text("b", { showWhen: { id: "a", value: "maybe" } })]), ["1:parent-value"]);
	// Two questions waiting on each other.
	const loop = [yesno("a", { showWhen: { id: "b", value: "yes" } }), yesno("b", { showWhen: { id: "a", value: "yes" } })];
	assert.ok(kinds(loop).includes("0:loop") && kinds(loop).includes("1:loop"));
	assert.deepEqual(q.dependents([yesno("a"), yesno("b", { showWhen: { id: "a", value: "no" } }), text("c", { showWhen: { id: "b", value: "yes" } }), text("d")], "a"), ["b", "c"]);
});

test("the default questions are complete, valid and alike in the four languages", () => {
	for (const id of q.TEMPLATE_IDS) {
		const en = d.defaultQuestions(id, "en");
		assert.ok(en.length >= 3 && en.length <= 5, `${id} has ${en.length} questions`);
		for (const lang of ["en", "fr", "es", "pt"]) {
			const qs = d.defaultQuestions(id, lang);
			assert.deepEqual(q.validateTemplate(qs), [], `${id} ${lang}`);
			assert.deepEqual(qs.map((x) => `${x.id}:${x.kind}:${x.options?.length ?? 0}:${x.carry ?? false}`), en.map((x) => `${x.id}:${x.kind}:${x.options?.length ?? 0}:${x.carry ?? false}`), `${id} ${lang}`);
			for (const x of qs) assert.ok(x.text.trim().length > 5);
			// Choices are edited as a list separated by commas: none may hold one.
			for (const x of qs) for (const o of x.options ?? []) assert.ok(!o.includes(","), `${lang} ${o}`);
		}
	}
	// The trade card's own fields are the same properties as the quick review's.
	assert.ok(d.defaultQuestions("loss", "fr").some((x) => x.id === "thesis") && d.defaultQuestions("win", "es").some((x) => x.id === "lesson"));
	assert.equal(q.tradeTemplate(10), "win");
	assert.equal(q.tradeTemplate(-1), "loss");
	assert.equal(q.tradeTemplate(0), "even");
});

// ── Streaks ─────────────────────────────────────────────────────────────────

test("a streak counts the latest reviewed in a row; today, not reviewed yet, does not break it", () => {
	const days = [
		{ day: "2026-10-12", reviewed: true },
		{ day: "2026-10-13", reviewed: true },
		{ day: "2026-10-14", reviewed: true },
		{ day: "2026-10-15", reviewed: false },
		{ day: "2026-10-16", reviewed: true },
		{ day: "2026-10-19", reviewed: true },
		{ day: "2026-10-20", reviewed: false },
	];
	assert.deepEqual(s.dayStreak(days, "2026-10-20"), { current: 2, best: 3 });
	assert.deepEqual(s.dayStreak(days, "2026-10-21"), { current: 0, best: 3 });
	assert.deepEqual(s.dayStreak([...days.slice(0, 6), { day: "2026-10-20", reviewed: true }], "2026-10-20"), { current: 3, best: 3 });
	assert.deepEqual(s.dayStreak([], "2026-10-20"), { current: 0, best: 0 });
});

test("trade and week streaks", () => {
	const trades = [
		{ at: 1, day: "2026-10-19", reviewed: true },
		{ at: 2, day: "2026-10-19", reviewed: true },
		{ at: 3, day: "2026-10-20", reviewed: false },
	];
	assert.deepEqual(s.tradeStreak(trades, "2026-10-20"), { current: 2, best: 2 });
	assert.deepEqual(s.tradeStreak(trades, "2026-10-21"), { current: 0, best: 2 });
	const weeks = s.tradedWeeks(["2026-10-06", "2026-10-07", "2026-10-13", "2026-10-21"]);
	assert.deepEqual(weeks.map((w) => w.id), ["2026-W41", "2026-W42", "2026-W43"]);
	assert.deepEqual(s.weekStreak(weeks, new Set(["2026-W41", "2026-W42"]), "2026-10-21"), { current: 2, best: 2 });
	assert.deepEqual(s.weekStreak(weeks, new Set(["2026-W41"]), "2026-10-21"), { current: 0, best: 1 });
});

test("what is left to review: days not reviewed, finished weeks without a review", () => {
	const days = [
		{ day: "2026-10-07", reviewed: true },
		{ day: "2026-10-13", reviewed: false },
		{ day: "2026-10-14", reviewed: true },
		{ day: "2026-10-21", reviewed: false },
	];
	const todo = s.reviewTodo(days, new Set(["2026-W41"]), "2026-10-21");
	assert.deepEqual(todo.days, ["2026-10-21", "2026-10-13"]);
	assert.deepEqual(todo.weeks.map((w) => w.id), ["2026-W42"]);
});

// ── Figures ─────────────────────────────────────────────────────────────────

const at = (day, hh) => Date.parse(`${day}T${hh}:00Z`);
const trade = (day, hh, pnl, extra = {}) => ({
	key: `${day}-${hh}`, path: `T/${day}-${hh}.md`, account: "A", currency: "USD", symbol: "XAUUSD", side: "long",
	at: at(day, hh), day, hour: null, openAt: at(day, hh) - 600000, pnl, r: pnl / 100, emotion: null, followedPlan: null,
	tags: [], entry: null, exit: null, volume: null, stopLoss: null, takeProfit: null, fees: 0, rating: null, broker: null, reviewed: false, ...extra,
});

test("a day's figures: best and worst trade, R, discipline, mistakes", () => {
	const ts = [
		trade("2026-10-20", "09:00", 200, { followedPlan: true }),
		trade("2026-10-20", "10:00", -100, { followedPlan: false, tags: ["Impulsive"] }),
		trade("2026-10-20", "11:00", 50, { currency: "EUR" }),
	];
	const fig = f.dayFigures(ts, { Impulsive: "Mistakes" });
	assert.equal(fig.currency, "USD");
	assert.equal(fig.otherCurrency, 1);
	assert.equal(fig.net, 100);
	assert.equal(fig.winRate, 50);
	assert.equal(fig.best.pnl, 200);
	assert.equal(fig.worst.pnl, -100);
	assert.equal(fig.rTotal, 1.5);
	assert.equal(fig.planFollowed, 1);
	assert.equal(fig.planKnown, 2);
	assert.equal(fig.mistakes, 1);
	const curve = f.intraday(ts, "USD");
	assert.deepEqual(curve.map((x) => x.value), [0, 200, 100]);
	assert.equal(curve[0].at, at("2026-10-20", "09:00") - 600000);
});

test("a period against the previous one, split by day, week or month", () => {
	const ts = [trade("2026-10-19", "09:00", 300), trade("2026-10-19", "10:00", -100), trade("2026-10-21", "09:00", -50), trade("2026-10-24", "09:00", 20)];
	const week = p.parsePeriod("2026-W43");
	const fig = f.periodFigures(f.tradesIn(week, ts), "USD");
	assert.equal(fig.net, 170);
	assert.equal(fig.tradingDays, 3);
	assert.equal(fig.greenDays, 2);
	assert.equal(fig.redDays, 1);
	assert.deepEqual(fig.bestDay, { day: "2026-10-19", pnl: 200 });
	assert.deepEqual(fig.worstDay, { day: "2026-10-21", pnl: -50 });
	assert.equal(fig.maxDrawdown, 150);
	assert.equal(f.delta(170, 100), 70);
	assert.equal(f.delta(null, 100), null);
	// Monday to Friday always, Saturday because it was traded, not Sunday.
	const rows = f.breakdown(week, ts, "USD");
	assert.deepEqual(rows.map((x) => x.period.id), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
	assert.deepEqual(rows.map((x) => x.net), [200, 0, -50, 0, 0, 20]);
	assert.deepEqual(f.breakdown(p.parsePeriod("2026"), ts, "USD").length, 12);
	assert.deepEqual(f.cumulativeByDay(week, ts, "USD", "2026-10-22"), [200, 200, 150, 150, null, null, null]);
	const top = f.topTrades(ts, "USD", 2);
	assert.deepEqual(top.best.map((x) => x.pnl), [300, 20]);
	assert.deepEqual(top.worst.map((x) => x.pnl), [-100, -50]);
});

test("setups ranked by result, mistakes by cost", () => {
	const ts = [trade("2026-10-19", "09:00", 300, { tags: ["Breakout"] }), trade("2026-10-19", "10:00", -100, { tags: ["Range", "Oversized"] }), trade("2026-10-20", "10:00", -300, { tags: ["Impulsive"] })];
	const res = f.setupsAndMistakes(ts, { Breakout: "Setups", Range: "Setups", Oversized: "Mistakes", Impulsive: "Mistakes" }, "USD");
	assert.deepEqual(res.setups.map((g) => g.label), ["Breakout", "Range"]);
	assert.deepEqual(res.mistakes.map((g) => g.label), ["Impulsive", "Oversized"]);
});
