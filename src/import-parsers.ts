import type { ApiTrade } from "./types";

// Reads a broker statement on the trader's computer: a MetaTrader 4 or 5 report
// (HTML) or any CSV export. Nothing is sent anywhere. The CSV reader recognises
// columns in English, French, Spanish and Portuguese, and the trader can correct
// the mapping before importing.

export interface ParsedFile {
	format: "mt5" | "csv";
	account: { name: string; broker: string | null; currency: string };
	trades: ApiTrade[];
	warnings: string[];
}

// ── Shared helpers ──────────────────────────────────────────────────────────

export function norm(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/** "1 234,56", "1,234.56", "(12.50)", "-12.5 USD" → number. */
export function parseNumber(raw: string | undefined): number {
	if (raw === undefined || raw === null) return NaN;
	let s = String(raw).trim();
	const negative = /^\(.*\)$/.test(s);
	s = s.replace(/[\s\u00a0\u202f]/g, "").replace(/[^0-9.,-]/g, "");
	if (!s || s === "-") return NaN;
	const lastComma = s.lastIndexOf(",");
	const lastDot = s.lastIndexOf(".");
	if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
	else s = s.replace(/,/g, "");
	const n = parseFloat(s);
	return negative ? -Math.abs(n) : n;
}

export function normSide(raw: string): "long" | "short" | null {
	const n = norm(raw);
	if (/\b(buy|long|achat|compra|b)\b/.test(n) || n.startsWith("buy")) return "long";
	if (/\b(sell|short|vente|venta|venda|s)\b/.test(n) || n.startsWith("sell")) return "short";
	return null;
}

/** B3 futures: WINZ26 and WING27 are the same market, journaled as WIN. */
function symbolB3(symbol: string): string {
	const m = /^(WIN|WDO|IND|DOL|BGI|CCM|ICF|SJC)[FGHJKMNQUVXZ]\d{2}$/.exec(symbol.trim().toUpperCase());
	return m ? m[1] : symbol.trim();
}

/** Risk of a trade from its stop: the share of the gross result the stop distance represents. */
function riskFromStop(entry: number, exit: number | null, stop: number | null, gross: number): number | null {
	if (stop === null || exit === null || !entry || exit === entry || !gross) return null;
	const risk = Math.abs(gross) * (Math.abs(entry - stop) / Math.abs(exit - entry));
	return Number.isFinite(risk) && risk > 0 ? Math.round(risk * 100) / 100 : null;
}

function trade(fields: {
	id: string;
	symbol: string;
	side: "long" | "short";
	open: Date | null;
	close: Date | null;
	entry: number;
	exit: number | null;
	volume: number;
	gross: number;
	commission: number;
	swap: number;
	stop: number | null;
	target: number | null;
	net?: number;
}): ApiTrade {
	const pnl = Math.round((fields.net ?? fields.gross + fields.commission + fields.swap) * 100) / 100;
	const risk = riskFromStop(fields.entry, fields.exit, fields.stop, fields.gross);
	return {
		id: fields.id,
		symbol: symbolB3(fields.symbol),
		side: fields.side,
		openTime: fields.open ? fields.open.toISOString() : null,
		closeTime: fields.close ? fields.close.toISOString() : null,
		entryPrice: Number.isFinite(fields.entry) ? fields.entry : null,
		exitPrice: fields.exit !== null && Number.isFinite(fields.exit) ? fields.exit : null,
		volume: Number.isFinite(fields.volume) ? fields.volume : null,
		pnl,
		commission: Math.round(fields.commission * 100) / 100,
		swap: Math.round(fields.swap * 100) / 100,
		stopLoss: fields.stop,
		takeProfit: fields.target,
		riskAmount: risk,
		rMultiple: risk ? Math.round((pnl / risk) * 100) / 100 : null,
		emotion: null,
		rating: null,
		followedPlan: null,
		reviewNote: null,
		tags: [],
	};
}

// ── MetaTrader 4 and 5 reports (HTML) ───────────────────────────────────────

/** MetaTrader writes "YYYY.MM.DD HH:MM[:SS]" in the time zone of the broker server. */
function mtDate(raw: string): Date | null {
	const m = /(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
	if (!m) return null;
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? "0"));
}

const SECTIONS = ["positions", "deals", "orders", "transactions", "ordres", "ordre", "transaction", "ordres en attente", "posicoes", "ordens", "transacoes", "negocios", "ordens pendentes", "closed transactions", "open trades", "working orders"];

function cellsOf(tr: Element): string[] {
	// A spacer cell (class "hidden") follows the type in every data row of MT5: kept, it shifts every column.
	return Array.from(tr.querySelectorAll("th,td"))
		.filter((c) => !c.classList.contains("hidden"))
		.map((c) => (c.textContent ?? "").trim());
}

function sectionOf(cells: string[]): string | null {
	const filled = cells.filter((c) => c !== "");
	if (filled.length !== 1) return null;
	const n = norm(filled[0]);
	return SECTIONS.includes(n) ? n : null;
}

function looksLikeHeader(cells: string[]): boolean {
	const j = norm(cells.filter((c) => c).join(" "));
	return /\b(symbol|symbole|ativo|simbolo|item)\b/.test(j) && /\b(type|tipo|profit|benefice|lucro)\b/.test(j);
}

interface Deal {
	time: Date;
	ticket: string;
	symbol: string;
	side: "long" | "short";
	dir: "in" | "out" | "inout" | null;
	volume: number;
	price: number;
	order: string;
	commission: number;
	swap: number;
	profit: number;
}

function dealDirection(raw: string): Deal["dir"] {
	const n = norm(raw).replace(/\s+/g, "");
	if (!n) return null;
	if (/^(in\/out|entrada\/saida|entree\/sortie)$/.test(n)) return "inout";
	if (/^(in|entrada|entree)$/.test(n)) return "in";
	if (/^(out|outby|saida|sortie)/.test(n)) return "out";
	return null;
}

function headerAfter(rows: Element[], start: number): number {
	for (let i = start + 1; i < Math.min(start + 4, rows.length); i++) if (looksLikeHeader(cellsOf(rows[i]))) return i;
	return -1;
}

const at = (cells: string[], i: number): string => (i >= 0 && i < cells.length ? cells[i] : "");
const optional = (raw: string): number | null => {
	const n = parseNumber(raw);
	return Number.isFinite(n) && n !== 0 ? n : null;
};

/** The "Positions" table of MT5, or the closed trades table of MT4: one row per trade. */
function readPositions(rows: Element[], headerIdx: number): ApiTrade[] {
	const headers = cellsOf(rows[headerIdx]).map(norm);
	const all = (re: RegExp): number[] => headers.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i >= 0);
	const first = (re: RegExp): number => all(re)[0] ?? -1;
	const times = all(/^time$|heure|temps|horario|open time|close time/);
	const prices = all(/^price$|^prix$|^preco$/);
	const col = {
		open: times[0] ?? -1,
		close: times.length > 1 ? times[times.length - 1] : -1,
		id: first(/position|ticket|deal|order|#|posicao/),
		symbol: first(/symbol|symbole|ativo|simbolo|item/),
		type: first(/^type$|^tipo$/),
		volume: first(/volume|lots?|size/),
		entry: prices[0] ?? -1,
		exit: prices.length > 1 ? prices[prices.length - 1] : -1,
		stop: first(/s ?\/ ?l|^sl$|stop loss/),
		target: first(/t ?\/ ?p|^tp$|take profit/),
		commission: first(/commission|comissao/),
		swap: first(/swap|echange/),
		profit: first(/profit|benefice|p ?\/ ?l|lucro/),
	};
	const out: ApiTrade[] = [];
	for (let i = headerIdx + 1; i < rows.length; i++) {
		const cells = cellsOf(rows[i]);
		if (sectionOf(cells)) break;
		if (cells.length < 5) {
			if (/total|balance|solde|profit net|resultats|results/.test(norm(cells.join(" ")))) break;
			continue;
		}
		// A real position row has as many cells as the header; order rows have fewer.
		if (cells.length < headers.length) continue;
		const side = normSide(at(cells, col.type));
		const symbol = at(cells, col.symbol);
		const open = mtDate(at(cells, col.open));
		const close = col.close >= 0 ? mtDate(at(cells, col.close)) : null;
		if (!side || !symbol || !open || (col.close >= 0 && !close)) continue;
		out.push(
			trade({
				id: at(cells, col.id) || `${symbol}-${open.getTime()}`,
				symbol,
				side,
				open,
				close,
				entry: parseNumber(at(cells, col.entry)),
				exit: col.exit >= 0 ? parseNumber(at(cells, col.exit)) : null,
				volume: parseNumber(at(cells, col.volume)),
				gross: parseNumber(at(cells, col.profit)) || 0,
				commission: parseNumber(at(cells, col.commission)) || 0,
				swap: parseNumber(at(cells, col.swap)) || 0,
				stop: col.stop >= 0 ? optional(at(cells, col.stop)) : null,
				target: col.target >= 0 ? optional(at(cells, col.target)) : null,
			}),
		);
	}
	return out;
}

function readDeals(rows: Element[], start: number): Deal[] {
	const headerIdx = headerAfter(rows, start);
	if (headerIdx < 0) return [];
	const h = cellsOf(rows[headerIdx]).map(norm);
	const find = (re: RegExp): number => h.findIndex((x) => re.test(x));
	const exactOrder = find(/^(order|ordre|ordem)$/);
	const idx = {
		time: find(/^time$|heure|temps|horario/),
		ticket: find(/^deal$|ticket|^transaction$|^transacao$|^negocio$/),
		symbol: find(/symbol|symbole|ativo|simbolo/),
		type: find(/^type$|^tipo$/),
		direction: find(/direction|entry|sens|direcao/),
		volume: find(/volume|lots?/),
		price: find(/^price$|^prix$|^preco$/),
		order: exactOrder >= 0 ? exactOrder : find(/order|ordre|ordem|position/),
		commission: find(/commission|comissao/),
		swap: find(/swap|echange/),
		profit: find(/profit|benefice|lucro/),
	};
	if (idx.symbol < 0 || idx.type < 0 || idx.volume < 0 || idx.price < 0 || idx.time < 0) return [];
	const out: Deal[] = [];
	for (let i = headerIdx + 1; i < rows.length; i++) {
		const cells = cellsOf(rows[i]);
		if (sectionOf(cells)) break;
		if (cells.length < 5) continue;
		const symbol = at(cells, idx.symbol);
		const side = normSide(at(cells, idx.type));
		const time = mtDate(at(cells, idx.time));
		const volume = parseNumber(at(cells, idx.volume));
		const price = parseNumber(at(cells, idx.price));
		// Deposits ("balance") and total rows have no side and no volume.
		if (!symbol || !side || !time || !(volume > 0) || !Number.isFinite(price)) continue;
		out.push({
			time,
			ticket: at(cells, idx.ticket),
			symbol,
			side,
			dir: idx.direction >= 0 ? dealDirection(at(cells, idx.direction)) : null,
			volume,
			price,
			order: at(cells, idx.order),
			commission: parseNumber(at(cells, idx.commission)) || 0,
			swap: parseNumber(at(cells, idx.swap)) || 0,
			profit: parseNumber(at(cells, idx.profit)) || 0,
		});
	}
	return out;
}

const round = (x: number, n: number): number => Math.round(x * 10 ** n) / 10 ** n;

/**
 * Trades of a netting account (one net position per symbol), deal by deal: every
 * exit, partial or full, is a trade at the average price of the open entries; an
 * "in/out" deal closes the position and opens the rest in the other direction.
 */
function nettingTrades(deals: Deal[]): ApiTrade[] {
	type Seg = { side: "long" | "short"; vol: number; price: number; commission: number; swap: number; opened: Date; pos: string };
	const EPS = 1e-9;
	const open = new Map<string, Seg>();
	const out: ApiTrade[] = [];
	const close = (s: Seg, d: Deal, vol: number, profit: number, commission: number, swap: number): void => {
		const share = s.vol > 0 ? vol / s.vol : 0;
		const entryCommission = s.commission * share;
		const entrySwap = s.swap * share;
		s.commission -= entryCommission;
		s.swap -= entrySwap;
		out.push(
			trade({
				id: `${s.pos}-${d.ticket || out.length}`,
				symbol: d.symbol,
				side: s.side,
				open: s.opened,
				close: d.time,
				entry: round(s.price, 5),
				exit: round(d.price, 5),
				volume: round(vol, 2),
				gross: profit,
				commission: round(commission + entryCommission, 2),
				swap: round(swap + entrySwap, 2),
				stop: null,
				target: null,
			}),
		);
		s.vol = round(s.vol - vol, 8);
	};
	for (const d of [...deals].sort((a, b) => a.time.getTime() - b.time.getTime())) {
		const seg = open.get(d.symbol);
		const isOpen = !!seg && seg.vol > EPS;
		const dir = d.dir ?? (!isOpen || seg.side === d.side ? "in" : d.volume > seg.vol + EPS ? "inout" : "out");
		if (dir === "in") {
			if (!seg || !isOpen) {
				open.set(d.symbol, { side: d.side, vol: d.volume, price: d.price, commission: d.commission, swap: d.swap, opened: d.time, pos: d.order || d.ticket || `${d.symbol}-${d.time.getTime()}` });
			} else {
				const total = seg.vol + d.volume;
				seg.price = (seg.price * seg.vol + d.price * d.volume) / total;
				seg.vol = total;
				seg.commission += d.commission;
				seg.swap += d.swap;
			}
			continue;
		}
		if (!seg || !isOpen) continue;
		if (dir === "inout") {
			const q = Math.min(seg.vol, d.volume);
			const share = d.volume > 0 ? q / d.volume : 1;
			close(seg, d, q, d.profit, d.commission * share, d.swap);
			const rest = round(d.volume - q, 8);
			if (rest > EPS) open.set(d.symbol, { side: d.side, vol: rest, price: d.price, commission: d.commission * (1 - share), swap: 0, opened: d.time, pos: seg.pos });
			else open.delete(d.symbol);
			continue;
		}
		close(seg, d, Math.min(seg.vol, d.volume), d.profit, d.commission, d.swap);
	}
	return out;
}

/** Trades of a hedging account rebuilt from deals, paired by position. */
function pairedTrades(deals: Deal[]): ApiTrade[] {
	const byPos = new Map<string, Deal[]>();
	for (const d of deals) if (d.order) byPos.set(d.order, [...(byPos.get(d.order) ?? []), d]);
	const out: ApiTrade[] = [];
	for (const [pos, ds] of byPos) {
		ds.sort((a, b) => a.time.getTime() - b.time.getTime());
		const entry = ds.find((d) => d.dir === "in") ?? ds[0];
		const exit = [...ds].reverse().find((d) => d.dir === "out") ?? ds[ds.length - 1];
		if (entry === exit) continue;
		out.push(
			trade({
				id: pos,
				symbol: entry.symbol,
				side: entry.side,
				open: entry.time,
				close: exit.time,
				entry: entry.price,
				exit: exit.price,
				volume: entry.volume,
				gross: ds.reduce((s, d) => s + d.profit, 0),
				commission: ds.reduce((s, d) => s + d.commission, 0),
				swap: ds.reduce((s, d) => s + d.swap, 0),
				stop: null,
				target: null,
			}),
		);
	}
	return out;
}

export function parseMetaTrader(html: string, fileName: string): ParsedFile {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const rows = Array.from(doc.querySelectorAll("tr"));
	const text = doc.body?.textContent ?? "";
	const grab = (re: RegExp): string => re.exec(text)?.[1]?.trim() ?? "";
	const login = grab(/(?:Account|Compte|Conta)\s*:?\s*([0-9]{4,})/i);
	const broker = grab(/(?:Company|Soci[eé]t[eé]|Broker|Courtier|Corretora)\s*:?\s*([^\n\r]{2,60}?)(?:Date|$)/i) || null;
	const currency = grab(/(?:Currency|Devise|Moeda)\s*:?\s*([A-Z]{3})/i) || grab(/(?:Account|Compte|Conta)\s*:?\s*[0-9]{4,}\s*\(\s*([A-Z]{3})\b/i) || "USD";
	// The terminal writes the account mode after the currency: "8119003 (BRL, Server, real, Netting)".
	const accountDetails = /(?:Account|Compte|Conta)\s*:?\s*[0-9]{4,}\s*\(([^)]*)\)/i.exec(text)?.[1] ?? "";
	const netting = /\b(netting|compensa)/i.test(accountDetails);

	const sections: Record<string, number> = {};
	rows.forEach((tr, i) => {
		const s = sectionOf(cellsOf(tr));
		if (s && !(s in sections)) sections[s] = i;
	});
	const warnings: string[] = [];
	let trades: ApiTrade[] = [];
	const dealsAt = sections.deals ?? sections.transactions ?? sections.transacoes ?? sections.negocios;
	const deals = dealsAt !== undefined ? readDeals(rows, dealsAt) : [];
	if (deals.length && (netting || deals.some((d) => d.dir === "inout"))) trades = nettingTrades(deals);
	const positionsAt = sections.positions ?? sections.posicoes ?? sections["closed transactions"];
	if (!trades.length && positionsAt !== undefined) {
		const h = headerAfter(rows, positionsAt);
		if (h >= 0) trades = readPositions(rows, h);
	}
	if (!trades.length && deals.length) trades = pairedTrades(deals);
	if (!trades.length) {
		const h = rows.findIndex((tr) => looksLikeHeader(cellsOf(tr)));
		if (h >= 0) trades = readPositions(rows, h);
	}
	if (!trades.length) warnings.push("no-trade");
	const name = login ? `${broker ?? "MetaTrader"} ${login}` : fileName.replace(/\.[^.]+$/, "");
	return { format: "mt5", account: { name, broker: broker ?? "MetaTrader", currency }, trades, warnings };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

export type CsvField = "id" | "symbol" | "side" | "open" | "close" | "entry" | "exit" | "volume" | "pnl" | "gross" | "commission" | "swap" | "stop" | "target";

export const CSV_FIELDS: CsvField[] = ["symbol", "side", "open", "close", "entry", "exit", "volume", "pnl", "gross", "commission", "swap", "stop", "target", "id"];

/** Column names recognised for each field, normalised (lowercase, no accents). */
const ALIASES: Record<CsvField, RegExp> = {
	id: /^(ticket|id|trade id|position|position id|order|deal|#|n°|numero)$/,
	symbol: /^(symbol|symbole|instrument|ticker|asset|actif|ativo|simbolo|market|marche|contract|contrat|pair|paire|activo)$/,
	side: /^(side|type|direction|sens|action|tipo|lado|buy\/sell|long\/short|sentido|operacao)$/,
	open: /^(open time|opened|open date|entry time|entry date|date open|time open|ouverture|heure d'ouverture|date d'ouverture|date ouverture|abertura|data de abertura|apertura|fecha de apertura|open|date|time|entry)$/,
	close: /^(close time|closed|close date|exit time|exit date|date close|time close|fermeture|cloture|heure de cloture|date de cloture|date cloture|fechamento|data de fechamento|cierre|fecha de cierre|close|exit)$/,
	entry: /^(entry price|open price|price open|avg entry|prix d'entree|prix entree|prix d'ouverture|prix ouverture|preco de entrada|preco entrada|precio de entrada|entry px|buy price)$/,
	exit: /^(exit price|close price|price close|avg exit|prix de sortie|prix sortie|prix de cloture|prix cloture|preco de saida|preco saida|precio de salida|exit px|sell price)$/,
	volume: /^(volume|lots?|size|qty|quantity|quantite|contracts?|contrats?|quantidade|cantidad|position size|taille)$/,
	pnl: /^(net p&l|net pnl|net profit|profit net|resultat net|p&l net|pnl|p&l|profit|profit\/loss|resultat|result|gain|lucro|lucro liquido|resultado|resultado neto|realized p&l|realized pnl|net)$/,
	gross: /^(gross p&l|gross pnl|gross profit|profit brut|resultat brut|lucro bruto|resultado bruto)$/,
	commission: /^(commission|commissions|fees|fee|frais|comissao|comision|comisiones|taxas|costs?)$/,
	swap: /^(swap|swaps|rollover|financing|financement|echange)$/,
	stop: /^(s\/l|sl|stop|stop loss|stoploss)$/,
	target: /^(t\/p|tp|target|take profit|takeprofit|objectif)$/,
};

export function splitCsv(text: string): string[][] {
	const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
	const delimiter = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === delimiter) {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
			row = [];
			field = "";
		} else field += c;
	}
	row.push(field);
	if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
	return rows;
}

/** The header row (the first row naming at least three known columns) and the detected mapping. */
export function detectColumns(rows: string[][]): { header: number; mapping: Partial<Record<CsvField, number>> } {
	for (let r = 0; r < Math.min(rows.length, 15); r++) {
		const names = rows[r].map(norm);
		const mapping: Partial<Record<CsvField, number>> = {};
		for (const field of CSV_FIELDS) {
			const i = names.findIndex((n, idx) => ALIASES[field].test(n) && !Object.values(mapping).includes(idx));
			if (i >= 0) mapping[field] = i;
		}
		if (Object.keys(mapping).length >= 3) return { header: r, mapping };
	}
	return { header: 0, mapping: {} };
}

/** Day-month or month-day order of a file, read from all its dates. */
function dateOrder(values: string[], preferMonthFirst: boolean): "dmy" | "mdy" {
	for (const v of values) {
		const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(v.trim());
		if (!m) continue;
		if (Number(m[1]) > 12) return "dmy";
		if (Number(m[2]) > 12) return "mdy";
	}
	return preferMonthFirst ? "mdy" : "dmy";
}

export function parseDate(raw: string, order: "dmy" | "mdy"): Date | null {
	const s = raw.trim();
	if (!s) return null;
	if (/^\d{4}[.\-/]\d{2}[.\-/]\d{2}/.test(s)) {
		const m = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?/.exec(s);
		if (!m) return null;
		if (m[7]) return new Date(s.replace(" ", "T"));
		return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
	}
	const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i.exec(s);
	if (m) {
		const [a, b] = [Number(m[1]), Number(m[2])];
		const [day, month] = order === "dmy" ? [a, b] : [b, a];
		let year = Number(m[3]);
		if (year < 100) year += 2000;
		let hour = Number(m[4] ?? 0);
		if (m[7]?.toLowerCase() === "pm" && hour < 12) hour += 12;
		if (m[7]?.toLowerCase() === "am" && hour === 12) hour = 0;
		return new Date(year, month - 1, day, hour, Number(m[5] ?? 0), Number(m[6] ?? 0));
	}
	const d = new Date(s);
	return Number.isNaN(d.getTime()) ? null : d;
}

function hashOf(s: string): string {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return (h >>> 0).toString(36);
}

export function tradesFromCsv(rows: string[][], header: number, mapping: Partial<Record<CsvField, number>>, preferMonthFirst = false): { trades: ApiTrade[]; skipped: number } {
	const get = (r: string[], f: CsvField): string => (mapping[f] !== undefined ? r[mapping[f]] ?? "" : "");
	const data = rows.slice(header + 1);
	const order = dateOrder(data.flatMap((r) => [get(r, "open"), get(r, "close")]), preferMonthFirst);
	const trades: ApiTrade[] = [];
	let skipped = 0;
	for (const r of data) {
		const symbol = get(r, "symbol");
		const side = normSide(get(r, "side"));
		const close = parseDate(get(r, "close"), order) ?? parseDate(get(r, "open"), order);
		const open = parseDate(get(r, "open"), order);
		const net = parseNumber(get(r, "pnl"));
		const gross = parseNumber(get(r, "gross"));
		const commission = parseNumber(get(r, "commission")) || 0;
		const swap = parseNumber(get(r, "swap")) || 0;
		if (!symbol || !side || !close || (!Number.isFinite(net) && !Number.isFinite(gross))) {
			skipped++;
			continue;
		}
		const fields = {
			symbol,
			side,
			open,
			close,
			entry: parseNumber(get(r, "entry")),
			exit: mapping.exit !== undefined ? parseNumber(get(r, "exit")) : null,
			volume: parseNumber(get(r, "volume")),
			gross: Number.isFinite(gross) ? gross : net - commission - swap,
			commission,
			swap,
			stop: optional(get(r, "stop")),
			target: optional(get(r, "target")),
		};
		const id = get(r, "id") || hashOf([symbol, side, fields.open?.toISOString(), close.toISOString(), get(r, "volume"), get(r, "pnl")].join("|"));
		trades.push(trade({ ...fields, id, ...(Number.isFinite(net) ? { net } : {}) }));
	}
	return { trades, skipped };
}

export function parseCsv(text: string, fileName: string, preferMonthFirst = false): ParsedFile & { rows: string[][]; header: number; mapping: Partial<Record<CsvField, number>> } {
	const rows = splitCsv(text.replace(/^\uFEFF/, ""));
	const { header, mapping } = detectColumns(rows);
	const { trades, skipped } = tradesFromCsv(rows, header, mapping, preferMonthFirst);
	const warnings = skipped ? [`skipped:${skipped}`] : [];
	if (!trades.length) warnings.push("no-trade");
	return { format: "csv", account: { name: fileName.replace(/\.[^.]+$/, ""), broker: null, currency: "USD" }, trades, warnings, rows, header, mapping };
}
