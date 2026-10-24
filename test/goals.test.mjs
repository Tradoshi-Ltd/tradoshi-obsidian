import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tradoshi-goals-"));
const out = join(dir, "goals.mjs");
writeFileSync(out, buildSync({ entryPoints: ["src/goal-list.ts"], bundle: true, format: "esm", write: false }).outputFiles[0].text);
const g = await import(pathToFileURL(out).href);

const t = (day, pnl, extra = {}) => ({ account: "A", day, pnl, r: pnl > 0 ? 1 : -1, reviewed: false, currency: "EUR", ...extra });
const trades = [t("2026-10-19", 100), t("2026-10-21", -50, { reviewed: true }), t("2026-10-22", 80), t("2026-10-22", 20, { account: "B" }), t("2026-10-22", 10, { currency: "USD" })];

test("periods: the day, the week from Monday, the month", () => {
	assert.deepEqual(g.periodBounds("day", "2026-10-22"), { from: "2026-10-22", to: "2026-10-22" });
	assert.deepEqual(g.periodBounds("week", "2026-10-22"), { from: "2026-10-19", to: "2026-10-25" });
	assert.deepEqual(g.periodBounds("month", "2026-02-10"), { from: "2026-02-01", to: "2026-02-28" });
});

test("at most 2 trades a day: kept, then went beyond", () => {
	const goal = { id: "1", metric: "trades", period: "day", direction: "atMost", target: 2, account: "all" };
	assert.equal(g.evaluateGoal(goal, trades, "2026-10-21", "EUR").met, true);
	const r = g.evaluateGoal(goal, trades, "2026-10-22", "EUR");
	assert.equal(r.value, 3);
	assert.equal(r.met, false);
});

test("a weekly result on one account, in the account currency only", () => {
	const goal = { id: "2", metric: "pnl", period: "week", direction: "atLeast", target: 200, account: "A" };
	const r = g.evaluateGoal(goal, trades, "2026-10-22", "EUR");
	assert.equal(r.value, 130);
	assert.equal(r.met, null);
	assert.ok(Math.abs(r.progress - 0.65) < 1e-9);
	assert.equal(g.evaluateGoal({ ...goal, target: 100 }, trades, "2026-10-22", "EUR").met, true);
});

test("win rate and trades reviewed, in %", () => {
	assert.equal(g.measure("winRate", trades.slice(0, 3)), (2 / 3) * 100);
	assert.equal(g.measure("reviewed", trades.slice(0, 2)), 50);
	assert.equal(g.measure("winRate", []), null);
	assert.equal(g.measure("pnl", []), 0);
});
