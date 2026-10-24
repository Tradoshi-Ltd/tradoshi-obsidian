import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

const dir = mkdtempSync(join(tmpdir(), "tradoshi-xlsx-"));
async function load(entry) {
	const out = join(dir, entry.replace(/\W/g, "_") + ".mjs");
	writeFileSync(out, buildSync({ entryPoints: [entry], bundle: true, format: "esm", write: false }).outputFiles[0].text);
	return import(pathToFileURL(out).href);
}
const x = await load("src/xlsx.ts");
const parsers = await load("src/import-parsers.ts");

/** A ZIP archive of the given files, deflated (or stored), as an Excel file is. */
function zip(files, store = false) {
	const parts = [];
	const central = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const raw = Buffer.from(text, "utf8");
		const data = store ? raw : deflateRawSync(raw);
		const nameBuf = Buffer.from(name, "utf8");
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(store ? 0 : 8, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		parts.push(local, nameBuf, data);
		const c = Buffer.alloc(46);
		c.writeUInt32LE(0x02014b50, 0);
		c.writeUInt16LE(store ? 0 : 8, 10);
		c.writeUInt32LE(data.length, 20);
		c.writeUInt32LE(raw.length, 24);
		c.writeUInt16LE(nameBuf.length, 28);
		c.writeUInt32LE(offset, 42);
		central.push(c, nameBuf);
		offset += local.length + nameBuf.length + data.length;
	}
	const cd = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	const all = Buffer.concat([...parts, cd, end]);
	return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}

const workbook = `<workbook xmlns:r="r"><sheets><sheet name="Trades" sheetId="1" r:id="rId3"/></sheets></workbook>`;
const rels = `<Relationships><Relationship Id="rId3" Type="ws" Target="worksheets/trades.xml"/></Relationships>`;
const styles = `<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>`;
const shared = `<sst><si><t>Symbol</t></si><si><t>Type</t></si><si><t>Open time</t></si><si><t>Close time</t></si><si><t>Profit</t></si><si><t>EURUSD</t></si><si><r><t>Bu</t></r><r><t>y</t></r></si><si><t>Sell</t></si></sst>`;
const sheet = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>
<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" s="1"><v>46037.375</v></c><c r="D2" s="1"><v>46037.5</v></c><c r="E2" s="2"><v>125.5</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>XAU&amp;USD</t></is></c><c r="B4" t="s"><v>7</v></c><c r="C4" s="1"><v>46038.25</v></c><c r="D4" s="1"><v>46038.3</v></c><c r="E4"><v>-40</v></c></row>
</sheetData></worksheet>`;
const files = { "xl/workbook.xml": workbook, "xl/_rels/workbook.xml.rels": rels, "xl/styles.xml": styles, "xl/sharedStrings.xml": shared, "xl/worksheets/trades.xml": sheet };

test("Excel dates and column letters", () => {
	assert.equal(x.excelDate(46037.375), "2026-01-15 09:00:00");
	assert.equal(x.columnIndex("A1"), 0);
	assert.equal(x.columnIndex("AA"), 26);
	assert.equal(x.decodeXml("A&amp;B &#233;&#x41;"), "A&B éA");
});

for (const store of [false, true]) {
	test(`reads the first sheet of a workbook (${store ? "stored" : "deflated"})`, async () => {
		const rows = await x.readXlsx(zip(files, store));
		assert.equal(rows.length, 4);
		assert.deepEqual(rows[0], ["Symbol", "Type", "Open time", "Close time", "Profit"]);
		assert.deepEqual(rows[1], ["EURUSD", "Buy", "2026-01-15 09:00:00", "2026-01-15 12:00:00", "125.5"]);
		assert.deepEqual(rows[2], []);
		assert.equal(rows[3][0], "XAU&USD");
	});
}

test("the rows of a workbook become trades, like a CSV", async () => {
	const rows = await x.readXlsx(zip(files));
	const p = parsers.parseRows(rows, "export.xlsx");
	assert.equal(p.trades.length, 2);
	const [a, b] = p.trades;
	assert.equal(a.symbol, "EURUSD");
	assert.equal(a.side, "long");
	assert.equal(a.pnl, 125.5);
	assert.equal(b.side, "short");
	assert.equal(b.pnl, -40);
});

test("a file that is not a workbook is refused", async () => {
	await assert.rejects(() => x.readXlsx(new TextEncoder().encode("Symbol;Profit\nEURUSD;1").buffer));
});

test("column names lose their unit and currency, in any of the four languages", () => {
	assert.equal(parsers.headerName("P&L net EUR"), "p&l net");
	assert.equal(parsers.headerName("Tamaño (lotes)"), "tamano");
	const rows = [
		["Fecha", "Instrumento", "Dirección", "Entrada", "Salida", "Tamaño (lotes)", "P&L bruto EUR", "Comisiones EUR", "P&L neto EUR"],
		["2026-01-05", "EURUSD", "Largo", "1.085", "1.091", "1", "120", "4", "116"],
		["2026-01-06", "GBPUSD", "Corto", "1.27", "1.268", "1", "-50", "4", "-54"],
	];
	const p = parsers.parseRows(rows, "diario.xlsx");
	assert.equal(p.trades.length, 2);
	assert.equal(p.trades[0].entryPrice, 1.085);
	assert.equal(p.trades[1].side, "short");
	// Costs written as positive amounts are costs: -4 each.
	assert.equal(p.trades[0].commission, -4);
	assert.equal(p.trades[0].pnl, 116);
});

test("a net result left empty is the gross minus the costs written as positive amounts", () => {
	const rows = [
		["Data", "Instrumento", "Sentido", "P&L bruto EUR", "Custos EUR", "P&L líquido EUR"],
		["2026-10-05", "WINZ26", "Comprado", "40", "1.2", ""],
	];
	const [t] = parsers.parseRows(rows, "diario.xlsx").trades;
	assert.equal(t.symbol, "WIN");
	assert.equal(t.side, "long");
	assert.ok(Math.abs(t.pnl - 38.8) < 1e-9);
});

test("\"Entry\" and \"Exit\" are times when they hold dates, prices when they hold numbers", () => {
	const times = parsers.parseRows([["Symbol", "Side", "Entry", "Exit", "Profit"], ["EURUSD", "Buy", "2026-01-05 09:00", "2026-01-05 11:30", "25"]], "a.csv");
	assert.deepEqual(Object.keys(times.mapping).sort(), ["close", "open", "pnl", "side", "symbol"]);
	const prices = parsers.parseRows([["Date", "Symbol", "Side", "Entry", "Exit", "Profit"], ["2026-01-05", "EURUSD", "Buy", "1.085", "1.091", "25"]], "b.csv");
	assert.equal(prices.mapping.entry, 3);
	assert.equal(prices.mapping.exit, 4);
});
