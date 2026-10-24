import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tradoshi-card-"));
const out = join(dir, "geometry.mjs");
writeFileSync(out, buildSync({ entryPoints: ["src/tradecard/geometry.ts"], bundle: true, format: "esm", write: false }).outputFiles[0].text);
const g = await import(pathToFileURL(out).href);

test("a long trade: stop below, target above, risk and reward on each side of the entry", () => {
	const l = g.ladder({ side: "long", entry: 100, exit: 104, stopLoss: 98, takeProfit: 106 });
	const pos = Object.fromEntries(l.marks.map((m) => [m.kind, m.pos]));
	assert.ok(pos.sl < pos.entry && pos.entry < pos.exit && pos.exit < pos.tp);
	assert.ok(pos.sl > 0 && pos.tp < 1);
	assert.deepEqual(l.risk, [pos.sl, pos.entry]);
	assert.deepEqual(l.reward, [pos.entry, pos.tp]);
});

test("a short trade: the stop above the entry is the risk", () => {
	const l = g.ladder({ side: "short", entry: 100, exit: 97, stopLoss: 102, takeProfit: 95 });
	const pos = Object.fromEntries(l.marks.map((m) => [m.kind, m.pos]));
	assert.deepEqual(l.risk, [pos.entry, pos.sl]);
	assert.deepEqual(l.reward, [pos.tp, pos.entry]);
});

test("a stop moved into profit is not a risk", () => {
	const l = g.ladder({ side: "long", entry: 100, exit: 104, stopLoss: 101, takeProfit: null });
	assert.equal(l.risk, null);
	assert.equal(l.reward, null);
});

test("no ladder without an entry and an exit", () => {
	assert.equal(g.ladder({ side: "long", entry: null, exit: 104, stopLoss: 98, takeProfit: 106 }), null);
});

test("planned reward to risk", () => {
	assert.equal(g.plannedRewardRisk({ side: "long", entry: 100, exit: 0, stopLoss: 98, takeProfit: 106 }), 3);
	assert.equal(g.plannedRewardRisk({ side: "short", entry: 100, exit: 0, stopLoss: 101, takeProfit: 98 }), 2);
	assert.equal(g.plannedRewardRisk({ side: "long", entry: 100, exit: 0, stopLoss: 101, takeProfit: 106 }), null);
});

test("risk from the result and the R multiple", () => {
	assert.equal(g.riskFromR(300, 1.5), 200);
	assert.equal(g.riskFromR(-100, -1), 100);
	assert.equal(g.riskFromR(100, null), null);
	assert.equal(g.riskFromR(100, 0), null);
});

test("outcome and price decimals", () => {
	assert.equal(g.outcomeOf(12), "win");
	assert.equal(g.outcomeOf(-0.5), "loss");
	assert.equal(g.outcomeOf(0.001), "breakeven");
	assert.equal(g.priceDigits(1.17214), 5);
	assert.equal(g.priceDigits(48832.9), 1);
	assert.equal(g.priceDigits(100), 0);
});
