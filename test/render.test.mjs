import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// render.ts and plan.ts have no Obsidian dependency: bundle them on the fly and test them as is.
const dir = mkdtempSync(join(tmpdir(), "tradoshi-render-"));
async function load(entry) {
	const out = join(dir, entry.replace(/\W/g, "_") + ".mjs");
	writeFileSync(out, buildSync({ entryPoints: [entry], bundle: true, format: "esm", write: false }).outputFiles[0].text);
	return import(pathToFileURL(out).href);
}
const r = await load("src/render.ts");
const plan = await load("src/plan.ts");

const ctx = {
	folder: "Tradoshi",
	appUrl: "https://app.tradoshi.com",
	appLinks: true,
	tradeNotes: true,
	dailyNotes: true,
	timeZone: "Europe/Paris",
	dayStartHour: 0,
};
const account = { id: "acc-1", name: "Main account", broker: "MetaTrader 5", currency: "USD", mode: "live", archived: false, updatedAt: "2026-10-20T10:00:00Z", tradeCount: 2, changed: true };
const trade = {
	id: "123456", symbol: "XAUUSD", side: "long", openTime: "2026-10-20T13:05:00Z", closeTime: "2026-10-20T14:10:00Z",
	entryPrice: 2650.5, exitPrice: 2660, volume: 0.5, pnl: 475.2, commission: -3.5, swap: 0, stopLoss: 2640, takeProfit: 2670,
	riskAmount: 250, rMultiple: 1.9, emotion: "Calm", rating: 4, followedPlan: true, reviewNote: "Clean break of the range.", tags: ["Good setup", "London"],
};

// ── Time zone and trading day ───────────────────────────────────────────────

test("dates and times follow the journal time zone, not the computer", () => {
	assert.equal(r.dateTime(ctx, "2026-10-20T22:30:00Z"), "2026-10-21T00:30");
	assert.equal(r.dateTime({ ...ctx, timeZone: "Pacific/Tahiti" }, "2026-10-20T22:30:00Z"), "2026-10-20T12:30");
});

test("a trading day can start in the evening, like the forex week", () => {
	const forex = { ...ctx, dayStartHour: 23 };
	assert.equal(r.tradingDay(forex, "2026-10-20T21:30:00Z"), "2026-10-21"); // 23:30 in Paris belongs to the next day
	assert.equal(r.tradingDay(forex, "2026-10-20T20:30:00Z"), "2026-10-20"); // 22:30 in Paris stays on the day
});

test("a trading day can start in the morning", () => {
	const morning = { ...ctx, dayStartHour: 6 };
	assert.equal(r.tradingDay(morning, "2026-10-21T02:00:00Z"), "2026-10-20"); // 04:00 in Paris, before the start
	assert.equal(r.tradingDay(morning, "2026-10-21T05:00:00Z"), "2026-10-21"); // 07:00 in Paris
});

test("unknown time zones are rejected", () => {
	assert.equal(r.isValidTimeZone("Pacific/Tahiti"), true);
	assert.equal(r.isValidTimeZone("Mars/Olympus"), false);
});

// ── Notes ───────────────────────────────────────────────────────────────────

test("trade paths are stable and safe for the file system", () => {
	assert.equal(r.tradePath(ctx, { ...trade, symbol: "EUR/USD" }), "Tradoshi/Trades/2026/2026-10-20 EUR-USD long 123456.md");
	assert.ok(r.tradeBaseName(ctx, { ...trade, id: "grp-ABCDEFGHIJKLMNOP-3" }).endsWith("IJKLMNOP-3"));
	assert.ok(r.tradeBaseName(ctx, { ...trade, symbol: "#BTCUSD" }).includes(" BTCUSD "));
});

test("trade properties carry the identity, the trading day and the Tradoshi tags apart", () => {
	const fm = r.tradeFrontmatter(ctx, trade, account);
	assert.equal(fm.tradoshi_id, "acc-1/123456");
	assert.equal(fm.trading_day, "2026-10-20");
	assert.equal(fm.closed, "2026-10-20T16:10");
	assert.equal(fm.closed_utc, "2026-10-20T14:10:00Z");
	assert.equal(fm.result, "win");
	assert.deepEqual(fm.tradoshi_tags, ["Good setup", "London"]);
	assert.deepEqual(fm.tags, ["tradoshi/trade"]);
});

test("a Tradoshi tag removed in the app is removed from the note, a tag of the trader stays", () => {
	const front = { tags: ["tradoshi/trade", "mine"], tradoshi_tags: ["Breakout", "Pullback"] };
	r.applyFrontmatter(front, r.tradeFrontmatter(ctx, { ...trade, tags: ["Pullback"] }, account));
	assert.deepEqual(front.tradoshi_tags, ["Pullback"]);
	assert.deepEqual(front.tags, ["tradoshi/trade", "mine"]);
	r.applyFrontmatter(front, r.tradeFrontmatter(ctx, { ...trade, tags: [] }, account));
	assert.equal(front.tradoshi_tags, undefined);
});

test("a new note holds properties, the managed block and the personal section", () => {
	const note = r.newNote(r.tradeFrontmatter(ctx, trade, account), r.tradeBlock(ctx, trade, account), "## My notes");
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

test("a symbol starting with # does not become a tag", () => {
	const t = { ...trade, symbol: "#BTCUSD" };
	assert.ok(r.tradeBlock(ctx, t, account).startsWith("# \\#BTCUSD long"));
	const rec = r.recordOf(ctx, t, account, "Tradoshi/Trades/2026/x");
	assert.ok(r.dayBlock(ctx, "2026-10-20", [rec], undefined).includes("[[Tradoshi/Trades/2026/x\\|#BTCUSD long]]"));
});

test("app links can be turned off", () => {
	assert.ok(!r.tradeBlock({ ...ctx, appLinks: false }, trade, account).includes("app.tradoshi.com"));
});

test("links follow notes where they really are", () => {
	const moved = { ...ctx, links: { trade: () => null, day: () => null } };
	const day = r.dayBlock(moved, "2026-10-20", [r.recordOf(moved, trade, account, "Archive/My XAUUSD trade")], undefined);
	assert.ok(day.includes("[[Archive/My XAUUSD trade\\|XAUUSD long]]"));
	assert.ok(r.tradeBlock(moved, trade, account).includes("Day: 2026-10-20"));
});

test("a trade note read back from its properties gives the same record", () => {
	const fm = r.tradeFrontmatter(ctx, trade, account);
	const back = r.recordFromProperties("Tradoshi/Trades/2026/a.md", fm);
	assert.deepEqual(back, r.recordOf(ctx, trade, account, "Tradoshi/Trades/2026/a"));
});

test("day notes sum P&L per currency and carry their identity", () => {
	const eur = { ...account, id: "acc-2", currency: "EUR" };
	const items = [
		r.recordOf(ctx, trade, account, "Tradoshi/Trades/2026/a"),
		r.recordOf(ctx, { ...trade, id: "2", pnl: -100 }, account, "Tradoshi/Trades/2026/b"),
		r.recordOf(ctx, { ...trade, id: "3", pnl: 50 }, eur, "Tradoshi/Trades/2026/c"),
	];
	const fm = r.dayFrontmatter("2026-10-20", items);
	assert.equal(fm.tradoshi_day, "2026-10-20");
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

// ── Planning: identity, renames, deletions ──────────────────────────────────

function vaultOf(notes) {
	const byKey = new Map(), byPath = new Map();
	for (const [path, key] of Object.entries(notes)) {
		if (key) { byPath.set(path, key); if (!byKey.has(key)) byKey.set(key, path); }
	}
	return new plan.PlannedVault(byKey, byPath, (p) => p in notes);
}

test("a note renamed or moved by the trader is updated where it is", () => {
	const v = vaultOf({ "Archive/my trade.md": "trade:acc-1/123456" });
	assert.deepEqual(v.plan("trade:acc-1/123456", "Tradoshi/Trades/2026/x.md", new Set()), { kind: "update", path: "Archive/my trade.md" });
});

test("a trade closed on another day keeps its note instead of getting a second one", () => {
	const v = vaultOf({ "Tradoshi/Trades/2026/2026-10-19 XAUUSD long 1.md": "trade:acc-1/1" });
	const act = v.plan("trade:acc-1/1", "Tradoshi/Trades/2026/2026-10-20 XAUUSD long 1.md", new Set());
	assert.deepEqual(act, { kind: "update", path: "Tradoshi/Trades/2026/2026-10-19 XAUUSD long 1.md" });
});

test("a note deleted by the trader is not written again", () => {
	const v = vaultOf({});
	assert.deepEqual(v.plan("trade:acc-1/1", "Tradoshi/Trades/2026/a.md", new Set(["trade:acc-1/1"])), { kind: "skip" });
});

test("two trades that would share a name get two notes", () => {
	const v = vaultOf({ "Tradoshi/Trades/2026/a.md": "trade:acc-1/1" });
	assert.deepEqual(v.plan("trade:acc-2/1", "Tradoshi/Trades/2026/a.md", new Set()), { kind: "create", path: "Tradoshi/Trades/2026/a (2).md" });
	assert.deepEqual(v.plan("trade:acc-3/1", "Tradoshi/Trades/2026/a.md", new Set()), { kind: "create", path: "Tradoshi/Trades/2026/a (3).md" });
});

test("a note of the trader at the same path is never taken over", () => {
	const v = vaultOf({ "Tradoshi/Days/2026/2026-10-20.md": undefined });
	assert.deepEqual(v.plan("day:2026-10-20", "Tradoshi/Days/2026/2026-10-20.md", new Set()), { kind: "create", path: "Tradoshi/Days/2026/2026-10-20 (2).md" });
});

test("notes written by version 1.0 are recognised", () => {
	assert.equal(plan.keyFromProperties({ tags: ["tradoshi/day"], date: "2026-10-20" }), "day:2026-10-20");
	assert.equal(plan.keyFromProperties({ tags: ["tradoshi/overview"] }), "overview");
	assert.equal(plan.keyFromProperties({ tradoshi_id: "a/1" }), "trade:a/1");
	assert.equal(plan.keyFromProperties({ title: "my note" }), undefined);
});

// ── Files imported on the trader's computer ─────────────────────────────────

const imp = await load("src/import-parsers.ts");

test("a CSV export in English is read with its columns", () => {
	const csv = "Symbol,Side,Open time,Close time,Entry price,Exit price,Volume,Net P&L,Commission\nXAUUSD,buy,2026-10-20 13:05,2026-10-20 14:10,2650.5,2660,0.5,475.20,-3.5\n";
	const p = imp.parseCsv(csv, "export.csv");
	assert.equal(p.trades.length, 1);
	assert.equal(p.trades[0].side, "long");
	assert.equal(p.trades[0].pnl, 475.2);
	assert.equal(p.trades[0].commission, -3.5);
});

test("a French CSV with semicolons, decimal commas and day-first dates", () => {
	const csv = "Instrument;Sens;Ouverture;Clôture;Prix d'entrée;Prix de sortie;Volume;Résultat net\nEURUSD;Vente;21/10/2026 09:15;21/10/2026 10:02;1,0850;1,0820;1;30,00\nGBPUSD;Achat;03/10/2026 14:00;13/10/2026 16:30;1,2650;1,2600;0,5;-1 250,50\n";
	const p = imp.parseCsv(csv, "releve.csv");
	assert.equal(p.trades.length, 2);
	assert.equal(p.trades[0].side, "short");
	assert.equal(p.trades[0].pnl, 30);
	assert.equal(new Date(p.trades[0].closeTime).getDate(), 21);
	assert.equal(p.trades[1].pnl, -1250.5);
	assert.equal(new Date(p.trades[1].closeTime).getMonth(), 9);
});

test("rows without a result are skipped, and counted", () => {
	const csv = "Symbol,Type,Close time,Profit\nXAUUSD,sell,2026-10-20 14:10,12\nUS30,buy,2026-10-20 15:00,\n";
	const p = imp.parseCsv(csv, "x.csv");
	assert.equal(p.trades.length, 1);
	assert.ok(p.warnings.includes("skipped:1"));
});

test("the same file imported twice gives the same trades", () => {
	const csv = "Symbol,Type,Close time,Profit\nXAUUSD,sell,2026-10-20 14:10,12\n";
	assert.equal(imp.parseCsv(csv, "x.csv").trades[0].id, imp.parseCsv(csv, "x.csv").trades[0].id);
});

test("numbers in every format", () => {
	assert.equal(imp.parseNumber("1 234,56"), 1234.56);
	assert.equal(imp.parseNumber("1,234.56"), 1234.56);
	assert.equal(imp.parseNumber("(12.50)"), -12.5);
	assert.equal(imp.parseNumber("-12.5 USD"), -12.5);
});

test("the guide page follows the trader's language, English otherwise", () => {
	assert.equal(r.guideLink("fr", "settings"), "https://tradoshi.com/obsidian.html?utm_source=obsidian&utm_medium=plugin&utm_campaign=settings");
	assert.ok(r.guideLink("es", "x").startsWith("https://tradoshi.com/es/obsidian.html?"));
	assert.ok(r.guideLink("pt", "x").startsWith("https://tradoshi.com/en/obsidian.html?"));
	assert.ok(r.guideLink("en", "x").startsWith("https://tradoshi.com/en/obsidian.html?"));
});
