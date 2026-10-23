import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// render.ts has no Obsidian dependency: bundle it on the fly and test it as is.
const out = join(mkdtempSync(join(tmpdir(), "tradoshi-render-")), "render.mjs");
writeFileSync(out, buildSync({ entryPoints: ["src/render.ts"], bundle: true, format: "esm", write: false }).outputFiles[0].text);
const r = await import(pathToFileURL(out).href);

const ctx = { folder: "Tradoshi", appUrl: "https://app.tradoshi.com", appLinks: true, tradeNotes: true, dailyNotes: true };
const account = { id: "acc-1", name: "Main account", broker: "MetaTrader 5", currency: "USD", mode: "live", archived: false, updatedAt: "2026-10-20T10:00:00Z", tradeCount: 2, changed: true };
const trade = {
	id: "123456", symbol: "XAUUSD", side: "long", openTime: "2026-10-20T13:05:00Z", closeTime: "2026-10-20T14:10:00Z",
	entryPrice: 2650.5, exitPrice: 2660, volume: 0.5, pnl: 475.2, commission: -3.5, swap: 0, stopLoss: 2640, takeProfit: 2670,
	riskAmount: 250, rMultiple: 1.9, emotion: "Calm", rating: 4, followedPlan: true, reviewNote: "Clean break of the range.", tags: ["Good setup", "London"],
};

test("trade paths are stable and safe for the file system", () => {
	const path = r.tradePath(ctx, { ...trade, symbol: "EUR/USD" });
	assert.match(path, /^Tradoshi\/Trades\/2026\/2026-10-20 EUR-USD long 123456\.md$/);
});

test("long identifiers are shortened in file names", () => {
	assert.ok(r.tradeBaseName({ ...trade, id: "grp-ABCDEFGHIJKLMNOP-3" }).endsWith("IJKLMNOP-3"));
});

test("trade properties carry the result, the R multiple and slug tags", () => {
	const fm = r.tradeFrontmatter(trade, account);
	assert.equal(fm.result, "win");
	assert.equal(fm.r_multiple, 1.9);
	assert.deepEqual(fm.tags, ["tradoshi/trade", "Good-setup", "London"]);
	assert.equal(fm.tradoshi_id, "acc-1/123456");
});

test("numeric-only labels are not turned into tags", () => {
	assert.equal(r.toTag("2026"), null);
	assert.equal(r.toTag("  Revenge trade "), "Revenge-trade");
});

test("a new note holds properties, the managed block and the personal section", () => {
	const note = r.newNote(r.tradeFrontmatter(trade, account), r.tradeBlock(ctx, trade, account), "## My notes");
	assert.ok(note.startsWith("---\n"));
	assert.ok(note.includes(r.BLOCK_START) && note.includes(r.BLOCK_END));
	assert.ok(note.trimEnd().endsWith("## My notes"));
	assert.ok(note.includes("utm_source=obsidian"));
});

test("replacing the block keeps what the trader wrote", () => {
	const note = r.newNote({ symbol: "XAUUSD" }, "old block", "## My notes") + "My own analysis.\n";
	const next = r.replaceBlock(note, "new block");
	assert.ok(next.includes("new block") && !next.includes("old block"));
	assert.ok(next.endsWith("My own analysis.\n"));
	assert.equal(r.replaceBlock("no markers here", "x"), null);
});

test("tags written by hand survive a sync", () => {
	const front = { tags: ["mine"], symbol: "OLD" };
	r.applyFrontmatter(front, { tags: ["tradoshi/trade"], symbol: "XAUUSD", emotion: null });
	assert.deepEqual(front.tags, ["mine", "tradoshi/trade"]);
	assert.equal(front.symbol, "XAUUSD");
	assert.equal(r.frontmatterDiffers(front, { tags: ["tradoshi/trade"], symbol: "XAUUSD" }), false);
	assert.equal(r.frontmatterDiffers(front, { tags: ["tradoshi/trade"], symbol: "EURUSD" }), true);
});

test("a symbol starting with # does not become a tag", () => {
	const t = { ...trade, symbol: "#BTCUSD" };
	const block = r.tradeBlock(ctx, t, account);
	assert.ok(block.startsWith("# \\#BTCUSD long"));
	const day = r.dayBlock(ctx, "2026-10-20", [{ trade: t, account }], undefined);
	assert.ok(day.includes("\\|#BTCUSD long]]"));
});

test("app links can be turned off", () => {
	const block = r.tradeBlock({ ...ctx, appLinks: false }, trade, account);
	assert.ok(!block.includes("app.tradoshi.com"));
});

test("day notes sum P&L per currency and link trades by full path", () => {
	const eur = { ...account, id: "acc-2", currency: "EUR" };
	const items = [
		{ trade, account },
		{ trade: { ...trade, id: "2", pnl: -100 }, account },
		{ trade: { ...trade, id: "3", pnl: 50 }, account: eur },
	];
	const fm = r.dayFrontmatter("2026-10-20", items);
	assert.equal(fm.trades, 3);
	assert.equal(fm.win_rate, 67);
	assert.equal(fm.pnl, null);
	const block = r.dayBlock(ctx, "2026-10-20", items, { date: "2026-10-20", updatedAt: "", markdown: "Patient today." });
	assert.ok(block.includes("+375.20 USD") && block.includes("+50.00 EUR"));
	assert.ok(block.includes("[[Tradoshi/Trades/2026/"));
	assert.ok(block.includes("Patient today."));
});

test("YAML quotes values that would change type", () => {
	const yaml = r.toYaml({ a: "true", b: "12.5", c: "Main account", d: "a: b", e: null, f: [] });
	assert.ok(yaml.includes('a: "true"') && yaml.includes('b: "12.5"'));
	assert.ok(yaml.includes("c: Main account") && yaml.includes('d: "a: b"'));
	assert.ok(!yaml.includes("e:"));
	assert.ok(yaml.includes("f: []"));
});
