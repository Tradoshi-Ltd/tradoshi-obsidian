import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tradoshi-accounts-"));
const out = join(dir, "stats.mjs");
writeFileSync(out, buildSync({ entryPoints: ["src/accounts/stats.ts"], bundle: true, format: "esm", write: false }).outputFiles[0].text);
const a = await import(pathToFileURL(out).href);

const trade = (account, at, pnl, currency = "EUR") => ({ account, at, pnl, currency, broker: "B" });
const trades = [trade("A", 1, 1000), trade("A", 2, -1500), trade("A", 3, 500), trade("B", 2, 200), trade("A", 4, 300, "USD")];
const settings = { type: "live", initial: 10000, target: 2000, hidden: false };

test("an account: balance, return and drawdown in %, in its own currency", () => {
	const f = a.accountFigures("A", trades, settings);
	assert.equal(f.currency, "EUR");
	assert.equal(f.trades, 3);
	assert.equal(f.net, 0);
	assert.equal(f.balance, 10000);
	assert.equal(f.returnPct, 0);
	assert.equal(f.maxDrawdown, 1500);
	assert.ok(Math.abs(f.maxDrawdownPct - (1500 / 11000) * 100) < 1e-9);
	assert.equal(f.currentDrawdown, 1000);
	assert.deepEqual(f.curve.map((p) => p.value), [11000, 9500, 10000]);
	assert.equal(f.winRate, (2 / 3) * 100);
	assert.equal(f.profitFactor, 1);
});

test("without a starting balance: no balance, no %", () => {
	const f = a.accountFigures("A", trades, { ...settings, initial: null });
	assert.equal(f.balance, null);
	assert.equal(f.maxDrawdownPct, null);
	assert.deepEqual(f.curve.map((p) => p.value), [1000, -500, 0]);
});

test("assets under management add each account's last balance", () => {
	const fa = a.accountFigures("A", trades, settings);
	const fb = a.accountFigures("B", trades, { ...settings, initial: 5000 });
	const curve = a.aumCurve([{ figures: fa, initial: 10000 }, { figures: fb, initial: 5000 }], "EUR");
	assert.deepEqual(curve.map((p) => p.value), [16000, 14500, 14700, 15200]);
});

test("position size from the balance, the risk and the stop", () => {
	const r = a.positionSize({ balance: 10000, riskPct: 1, entry: 1.085, stop: 1.083, pointValue: 100000 });
	assert.equal(r.risk, 100);
	assert.ok(Math.abs(r.size - 0.5) < 1e-9);
	assert.equal(a.positionSize({ balance: 10000, riskPct: 1, entry: 100, stop: 100, pointValue: 1 }).size, null);
});
