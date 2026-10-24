import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tradoshi-manual-"));
const out = join(dir, "calc.mjs");
writeFileSync(out, buildSync({ entryPoints: ["src/manual/calc.ts"], bundle: true, format: "esm", write: false }).outputFiles[0].text);
const c = await import(pathToFileURL(out).href);

const base = { side: "long", entry: 100, exit: 104, volume: 2, pointValue: 10, stopLoss: 98, commission: -3, swap: -1, pnlTyped: null };

test("a long trade: gross from the prices, net after costs, risk at the stop, R", () => {
	assert.deepEqual(c.figures(base), { gross: 80, pnl: 76, risk: 40, r: 1.9 });
});

test("a short trade gains when the price falls", () => {
	const f = c.figures({ ...base, side: "short", entry: 104, exit: 100, stopLoss: 106 });
	assert.equal(f.gross, 80);
	assert.equal(f.risk, 40);
});

test("a typed P&L wins over the prices; no stop, no R", () => {
	const f = c.figures({ ...base, pnlTyped: 55.555, stopLoss: null });
	assert.equal(f.pnl, 55.56);
	assert.equal(f.risk, null);
	assert.equal(f.r, null);
});

test("nothing to compute without the prices or the size", () => {
	assert.equal(c.figures({ ...base, exit: null }).pnl, null);
	assert.equal(c.figures({ ...base, volume: null }).pnl, null);
});

test("a stop on the winning side is no risk", () => {
	assert.equal(c.figures({ ...base, stopLoss: 101 }).risk, null);
});

test("wall times in the journal time zone, around daylight saving", () => {
	assert.equal(c.wallToUtc("2026-07-14T09:30", "Europe/Paris"), "2026-07-14T07:30:00.000Z");
	assert.equal(c.wallToUtc("2026-01-14T09:30", "Europe/Paris"), "2026-01-14T08:30:00.000Z");
	assert.equal(c.wallToUtc("2026-07-14T09:30", "America/New_York"), "2026-07-14T13:30:00.000Z");
	assert.equal(c.wallToUtc("2026-07-14T09:30", "UTC"), "2026-07-14T09:30:00.000Z");
	assert.equal(c.wallToUtc("not a date", "UTC"), null);
});

test("numbers typed the French or the English way", () => {
	assert.equal(c.parseTyped("1 234,5"), 1234.5);
	assert.equal(c.parseTyped("1,234.5"), 1234.5);
	assert.equal(c.parseTyped("-0.5"), -0.5);
	assert.equal(c.parseTyped("-3,50"), -3.5);
	assert.equal(c.parseTyped("1.17214"), 1.17214);
	assert.equal(c.parseTyped(""), null);
	assert.equal(c.parseTyped("abc"), null);
});
