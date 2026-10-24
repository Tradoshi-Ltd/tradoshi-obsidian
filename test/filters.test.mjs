import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tradoshi-filters-"));
const out = join(dir, "filters.mjs");
writeFileSync(out, buildSync({ entryPoints: ["src/filters.ts"], bundle: true, format: "esm", write: false }).outputFiles[0].text);
const f = await import(pathToFileURL(out).href);

const DAY = 86400000;
const now = new Date(2026, 9, 24, 15, 0).getTime();

test("the period before: same length, month before, year before, none for all time", () => {
	assert.deepEqual(f.previousPeriod(30, now), { from: now - 60 * DAY, to: now - 30 * DAY });
	assert.deepEqual(f.previousPeriod(-2, now), { from: new Date(2026, 8, 1).getTime(), to: new Date(2026, 9, 1).getTime() });
	assert.deepEqual(f.previousPeriod(-1, now), { from: new Date(2025, 0, 1).getTime(), to: new Date(2026, 0, 1).getTime() });
	assert.equal(f.previousPeriod(0, now), null);
});

const trades = [
	{ symbol: "EURUSD", side: "long", pnl: 10, tags: ["Breakout", "Late"] },
	{ symbol: "EURUSD", side: "short", pnl: -5, tags: ["Range"] },
	{ symbol: "XAUUSD", side: "long", pnl: 0, tags: [] },
];

test("filters: symbols, side, outcome, setups, tags any or all, left out", () => {
	const none = { ...f.NO_FILTERS };
	assert.equal(f.applyFilters(trades, none).length, 3);
	assert.equal(f.applyFilters(trades, { ...none, symbols: ["EURUSD"] }).length, 2);
	assert.equal(f.applyFilters(trades, { ...none, side: "short" }).length, 1);
	assert.equal(f.applyFilters(trades, { ...none, outcome: "win" }).length, 1);
	assert.equal(f.applyFilters(trades, { ...none, outcome: "loss" }).length, 1);
	assert.equal(f.applyFilters(trades, { ...none, tags: ["Breakout", "Late"], tagMode: "all" }).length, 1);
	assert.equal(f.applyFilters(trades, { ...none, tags: ["Breakout", "Range"], tagMode: "any" }).length, 2);
	assert.equal(f.applyFilters(trades, { ...none, excludeTags: ["Range"] }).length, 2);
	assert.equal(f.activeFilterCount({ ...none, symbols: ["A"], side: "long" }), 2);
});
