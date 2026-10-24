import type { ApiAccount, ApiDayNote, ApiTrade, TradeWithAccount } from "./types";

// Everything in this file is pure: it turns journal data into note paths, note
// properties and Markdown. Nothing here touches the vault, so it can be tested
// without Obsidian.

export const BLOCK_START = "%% tradoshi:start %%";
export const BLOCK_END = "%% tradoshi:end %%";

export type Frontmatter = Record<string, string | number | boolean | string[] | null>;

/** Where a note actually lives, so links follow notes the trader moved or renamed. */
export interface LinkResolver {
	/** Path of the note of a trade (without ".md"), or null when it has no note. */
	trade(key: string): string | null;
	/** Path of the note of a trading day (without ".md"), or null when it has no note. */
	day(date: string): string | null;
}

export interface RenderContext {
	folder: string;
	appUrl: string;
	appLinks: boolean;
	tradeNotes: boolean;
	dailyNotes: boolean;
	/** IANA time zone of the journal, e.g. "Europe/Paris". */
	timeZone: string;
	/** Hour (0 to 23) at which a trading day starts, in the journal time zone. */
	dayStartHour: number;
	links?: LinkResolver;
}

// ── Time zone and trading day ───────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		formatters.set(timeZone, f);
	}
	return f;
}

/** True when the time zone name is one the runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-CA", { timeZone });
		return true;
	} catch {
		return false;
	}
}

interface Zoned {
	date: string;
	time: string;
}

/** Calendar date and wall-clock time of an instant in a time zone. */
export function zoned(ms: number, timeZone: string): Zoned {
	const parts: Record<string, string> = {};
	for (const p of formatter(timeZone).formatToParts(new Date(ms))) parts[p.type] = p.value;
	return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const toMs = (iso: string | null): number | null => {
	if (!iso) return null;
	const ms = new Date(iso).getTime();
	return Number.isNaN(ms) ? null : ms;
};

/** Date and time (YYYY-MM-DDTHH:mm) in the journal time zone, the format of a date-time property. */
export function dateTime(ctx: RenderContext, iso: string | null): string | null {
	const ms = toMs(iso);
	if (ms === null) return null;
	const z = zoned(ms, ctx.timeZone);
	return `${z.date}T${z.time}`;
}

function clock(ctx: RenderContext, iso: string | null): string {
	const ms = toMs(iso);
	return ms === null ? "" : zoned(ms, ctx.timeZone).time;
}

/**
 * The trading day an instant belongs to. A day that starts before noon (e.g. 6:00)
 * gives the hours before it to the previous day; a day that starts in the evening
 * (e.g. 23:00, the forex week) gives the hours after it to the next day.
 */
export function tradingDay(ctx: RenderContext, iso: string): string | null {
	const ms = toMs(iso);
	if (ms === null) return null;
	const h = Math.min(Math.max(Math.trunc(ctx.dayStartHour) || 0, 0), 23);
	const shift = h === 0 ? 0 : h < 12 ? -h : 24 - h;
	return zoned(ms + shift * 3600000, ctx.timeZone).date;
}

/** The instant a trade belongs to: its close, or its open while still running. */
export function tradeInstant(t: ApiTrade): string | null {
	return t.closeTime ?? t.openTime;
}

export function tradeDay(ctx: RenderContext, t: ApiTrade): string | null {
	const when = tradeInstant(t);
	return when ? tradingDay(ctx, when) : null;
}

/** Identity of a trade across syncs, stored in the note as `tradoshi_id`. */
export function tradeKey(account: ApiAccount, t: ApiTrade): string {
	return `${account.id}/${t.id}`;
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function money(value: number, currency: string): string {
	const sign = value > 0 ? "+" : value < 0 ? "-" : "";
	return `${sign}${Math.abs(value).toFixed(2)} ${currency}`;
}

const round = (n: number): number => Math.round(n * 100) / 100;

// A "#" is dropped rather than replaced: "#BTCUSD" reads better as "BTCUSD" than "-BTCUSD".
function cleanFileName(s: string): string {
	return s.replace(/#/g, "").replace(/[\\/:*?"<>|^[\]]/g, "-").replace(/\s+/g, " ").trim();
}

// A "#" followed by text is read as a tag by Obsidian: "#BTCUSD" in a heading or a
// table would add a tag to the note. It is escaped wherever it is shown as text.
const text = (s: string): string => s.replace(/#/g, "\\#");

const cell = (v: string | number | null | undefined): string =>
	v === null || v === undefined || v === "" ? "-" : text(String(v)).replace(/\|/g, "\\|");

export function result(t: ApiTrade): "win" | "loss" | "breakeven" {
	return t.pnl > 0 ? "win" : t.pnl < 0 ? "loss" : "breakeven";
}

function shortId(id: string): string {
	const clean = cleanFileName(id);
	return clean.length > 14 ? clean.slice(-12) : clean;
}

// ── Paths ───────────────────────────────────────────────────────────────────

export function tradeBaseName(ctx: RenderContext, t: ApiTrade): string {
	return cleanFileName(`${tradeDay(ctx, t) ?? "undated"} ${t.symbol || "trade"} ${t.side} ${shortId(t.id)}`);
}

/** Where a new trade note is created. An existing note is found by its id, wherever it is. */
export function tradePath(ctx: RenderContext, t: ApiTrade): string {
	const day = tradeDay(ctx, t);
	return `${ctx.folder}/Trades/${day ? day.slice(0, 4) : "undated"}/${tradeBaseName(ctx, t)}.md`;
}

export function dayPath(ctx: RenderContext, date: string): string {
	return `${ctx.folder}/Days/${date.slice(0, 4)}/${date}.md`;
}

export function overviewPath(ctx: RenderContext): string {
	return `${ctx.folder}/Tradoshi.md`;
}

// Links carry the full path: a vault often has its own daily notes named
// YYYY-MM-DD, and a bare [[2026-08-06]] could open the wrong one.
const withoutExtension = (path: string): string => path.replace(/\.md$/, "");

export function dayLink(ctx: RenderContext, date: string): string {
	if (!ctx.dailyNotes) return date;
	const target = ctx.links ? ctx.links.day(date) : withoutExtension(dayPath(ctx, date));
	return target ? `[[${target}|${date}]]` : date;
}

/** Link to a trade note, written for a table cell (the pipe is escaped). */
function tradeLinkInTable(ctx: RenderContext, t: ApiTrade, account: ApiAccount): string {
	const label = `${t.symbol.replace(/[|[\]]/g, "")} ${t.side}`;
	if (!ctx.tradeNotes) return label;
	const target = ctx.links ? ctx.links.trade(tradeKey(account, t)) : withoutExtension(tradePath(ctx, t));
	return target ? `[[${target}\\|${label}]]` : label;
}

export function appLink(ctx: Pick<RenderContext, "appUrl">, campaign: string, hash = "journal", extraQuery = ""): string {
	const extra = extraQuery ? `&${extraQuery}` : "";
	return `${ctx.appUrl}/?utm_source=obsidian&utm_medium=plugin&utm_campaign=${campaign}${extra}${hash ? `#${hash}` : ""}`;
}

// ── Trade notes ─────────────────────────────────────────────────────────────

/**
 * Properties written by the plugin. Any other property in the note is left alone.
 * Tradoshi labels go to `tradoshi_tags`, replaced at every sync, so a label fixed
 * in Tradoshi is fixed in the note too; `tags` belongs to the trader.
 */
export function tradeFrontmatter(ctx: RenderContext, t: ApiTrade, account: ApiAccount): Frontmatter {
	return {
		tradoshi_id: tradeKey(account, t),
		trading_day: tradeDay(ctx, t),
		symbol: t.symbol,
		side: t.side,
		result: result(t),
		pnl: round(t.pnl),
		currency: account.currency,
		r_multiple: t.rMultiple,
		opened: dateTime(ctx, t.openTime),
		closed: dateTime(ctx, t.closeTime),
		closed_utc: t.closeTime,
		entry: t.entryPrice,
		exit: t.exitPrice,
		volume: t.volume,
		stop_loss: t.stopLoss,
		take_profit: t.takeProfit,
		commission: round(t.commission),
		swap: round(t.swap),
		account: account.name,
		broker: account.broker,
		emotion: t.emotion,
		rating: t.rating,
		followed_plan: t.followedPlan,
		tradoshi_tags: t.tags.length ? [...t.tags] : null,
		tags: ["tradoshi/trade"],
	};
}

export function tradeBlock(ctx: RenderContext, t: ApiTrade, account: ApiAccount): string {
	const lines: string[] = [];
	const day = tradeDay(ctx, t);
	lines.push(`# ${text(t.symbol)} ${t.side}, ${money(t.pnl, account.currency)}`);
	lines.push("");
	if (day) lines.push(`Day: ${dayLink(ctx, day)}`, "");
	lines.push("| | |", "|---|---|");
	lines.push(`| Account | ${cell(account.name)}${account.broker ? ` (${cell(account.broker)})` : ""} |`);
	lines.push(`| Opened | ${cell(dateTime(ctx, t.openTime)?.replace("T", " "))} |`);
	lines.push(`| Closed | ${cell(dateTime(ctx, t.closeTime)?.replace("T", " "))} |`);
	lines.push(`| Entry, exit | ${cell(t.entryPrice)} → ${cell(t.exitPrice)} |`);
	lines.push(`| Volume | ${cell(t.volume)} |`);
	lines.push(`| Stop loss, take profit | ${cell(t.stopLoss)}, ${cell(t.takeProfit)} |`);
	lines.push(`| Net P&L | ${money(t.pnl, account.currency)} |`);
	lines.push(`| Fees | commission ${t.commission.toFixed(2)}, swap ${t.swap.toFixed(2)} |`);
	if (t.rMultiple !== null) lines.push(`| R multiple | ${t.rMultiple} R |`);
	if (t.emotion) lines.push(`| Emotion | ${cell(t.emotion)} |`);
	if (t.rating !== null) lines.push(`| Execution rating | ${t.rating} / 5 |`);
	if (t.followedPlan !== null) lines.push(`| Followed the plan | ${t.followedPlan ? "yes" : "no"} |`);
	if (t.tags.length) lines.push(`| Tradoshi tags | ${t.tags.map(cell).join(", ")} |`);
	if (t.reviewNote) {
		lines.push("", "## Review from Tradoshi", "", t.reviewNote.trim());
	}
	if (ctx.appLinks) {
		lines.push("", `[Replay this trade in Tradoshi](${appLink(ctx, "trade_note")})`);
	}
	return lines.join("\n");
}

// ── Day notes ───────────────────────────────────────────────────────────────

export interface DaySummary {
	trades: number;
	wins: number;
	losses: number;
	pnlByCurrency: Record<string, number>;
}

export function summarize(items: TradeWithAccount[]): DaySummary {
	const s: DaySummary = { trades: items.length, wins: 0, losses: 0, pnlByCurrency: {} };
	for (const { trade, account } of items) {
		if (trade.pnl > 0) s.wins++;
		else if (trade.pnl < 0) s.losses++;
		s.pnlByCurrency[account.currency] = round((s.pnlByCurrency[account.currency] ?? 0) + trade.pnl);
	}
	return s;
}

export function winRate(s: DaySummary): number | null {
	const decided = s.wins + s.losses;
	return decided === 0 ? null : Math.round((s.wins / decided) * 100);
}

function pnlText(s: DaySummary): string {
	const parts = Object.entries(s.pnlByCurrency).map(([cur, v]) => money(v, cur));
	return parts.length ? parts.join(", ") : "0.00";
}

export function dayFrontmatter(date: string, items: TradeWithAccount[]): Frontmatter {
	const s = summarize(items);
	const currencies = Object.keys(s.pnlByCurrency);
	return {
		tradoshi_day: date,
		date,
		trades: s.trades,
		wins: s.wins,
		losses: s.losses,
		win_rate: winRate(s),
		pnl: currencies.length === 1 ? s.pnlByCurrency[currencies[0]] : null,
		currency: currencies.length === 1 ? currencies[0] : null,
		tags: ["tradoshi/day"],
	};
}

export function dayBlock(ctx: RenderContext, date: string, items: TradeWithAccount[], note: ApiDayNote | undefined): string {
	// No heading: Obsidian already shows the file name, which is the date.
	const lines: string[] = [];
	const sorted = [...items].sort((a, b) => (tradeInstant(a.trade) ?? "").localeCompare(tradeInstant(b.trade) ?? ""));
	if (sorted.length) {
		const s = summarize(sorted);
		const rate = winRate(s);
		lines.push(`**Net P&L:** ${pnlText(s)} · **Trades:** ${s.trades}${rate === null ? "" : ` · **Win rate:** ${rate} %`}`, "");
		lines.push("| Time | Trade | Volume | P&L | R | Account |", "|---|---|---|---|---|---|");
		for (const { trade, account } of sorted) {
			lines.push(
				`| ${clock(ctx, tradeInstant(trade))} | ${tradeLinkInTable(ctx, trade, account)} | ${cell(trade.volume)} | ${money(trade.pnl, account.currency)} | ${trade.rMultiple === null ? "-" : trade.rMultiple} | ${cell(account.name)} |`,
			);
		}
	} else {
		lines.push("No trades this day.");
	}
	if (note?.markdown) {
		lines.push("", "## Day notes from Tradoshi", "", note.markdown);
	}
	if (ctx.appLinks) {
		lines.push("", `[Review this day in Tradoshi](${appLink(ctx, "day_note")})`);
	}
	return lines.join("\n");
}

// ── Overview note ───────────────────────────────────────────────────────────

export function overviewBlock(
	ctx: RenderContext,
	accounts: ApiAccount[],
	items: TradeWithAccount[],
	generatedAt: string,
	now: Date = new Date(),
): string {
	const lines: string[] = [];
	lines.push(`Last sync: ${dateTime(ctx, generatedAt)?.replace("T", " ") ?? "-"}`, "");

	lines.push("## Accounts", "", "| Account | Broker | Trades | Updated in Tradoshi |", "|---|---|---|---|");
	for (const a of accounts) {
		lines.push(`| ${cell(a.name)}${a.mode === "demo" ? " (demo)" : ""} | ${cell(a.broker)} | ${a.tradeCount} | ${cell(dateTime(ctx, a.updatedAt)?.replace("T", " "))} |`);
	}
	if (!accounts.length) lines.push("| No account yet | - | 0 | - |");

	const since = now.getTime() - 30 * 86400000;
	const recent = items.filter(({ trade }) => (toMs(tradeInstant(trade)) ?? 0) >= since);
	const s = summarize(recent);
	const rate = winRate(s);
	lines.push("", "## Last 30 days", "", "| Net P&L | Trades | Win rate |", "|---|---|---|");
	lines.push(`| ${pnlText(s)} | ${s.trades} | ${rate === null ? "-" : `${rate} %`} |`);

	const days = [...new Set(items.map(({ trade }) => tradeDay(ctx, trade)).filter((x): x is string => !!x))]
		.sort()
		.reverse()
		.slice(0, 10);
	if (days.length) {
		lines.push("", "## Recent days", "");
		for (const d of days) lines.push(`- ${dayLink(ctx, d)}`);
	}

	lines.push(
		"",
		"> [!info] Where your trades come from",
		"> Trades synced from your brokers reach this vault once your Tradoshi journal is up to date. Open Tradoshi to fetch your latest trades, then sync again.",
	);
	if (ctx.appLinks) lines.push(`> [Open Tradoshi](${appLink(ctx, "overview")})`);
	return lines.join("\n");
}

// ── Assembling a note ───────────────────────────────────────────────────────

function yamlValue(v: string | number | boolean | string[] | null): string {
	if (v === null) return "";
	if (Array.isArray(v)) return v.length ? "\n" + v.map((x) => `  - ${yamlString(x)}`).join("\n") : "[]";
	if (typeof v === "string") return yamlString(v);
	return String(v);
}

function yamlString(s: string): string {
	return /^[\p{L}\p{N}_./-][\p{L}\p{N} _./()-]*$/u.test(s) && !/^(true|false|null|yes|no|~)$/i.test(s) && !/^[\d.-]+$/.test(s)
		? s
		: JSON.stringify(s);
}

export function toYaml(fm: Frontmatter): string {
	const lines = ["---"];
	for (const [k, v] of Object.entries(fm)) {
		if (v === null) continue;
		const val = yamlValue(v);
		lines.push(val.startsWith("\n") ? `${k}:${val}` : `${k}: ${val}`);
	}
	lines.push("---");
	return lines.join("\n");
}

/** A new note: properties, the managed block, and an empty space for the trader. */
export function newNote(fm: Frontmatter, block: string, personalHeading: string | null): string {
	const parts = [toYaml(fm), "", BLOCK_START, block, BLOCK_END, ""];
	if (personalHeading) parts.push(personalHeading, "", "");
	return parts.join("\n");
}

/**
 * Replaces the managed block of an existing note and keeps everything else as the
 * trader left it. Returns null when the markers are gone: the trader removed them,
 * so the plugin no longer touches the body of that note.
 */
export function replaceBlock(content: string, block: string): string | null {
	const start = content.indexOf(BLOCK_START);
	const end = content.indexOf(BLOCK_END, start + BLOCK_START.length);
	if (start === -1 || end === -1) return null;
	return content.slice(0, start) + BLOCK_START + "\n" + block + "\n" + content.slice(end);
}

// `tags` is shared with the trader: the plugin adds its own and never removes one,
// so a tag written by hand on a note survives every sync.
function missingTags(have: unknown, wanted: string[]): string[] {
	const current = Array.isArray(have) ? have.map(String) : typeof have === "string" ? have.split(/[,\s]+/) : [];
	return wanted.filter((t) => !current.includes(t));
}

/** True when a managed property differs from what the note currently holds. */
export function frontmatterDiffers(current: Record<string, unknown> | undefined, wanted: Frontmatter): boolean {
	for (const [k, v] of Object.entries(wanted)) {
		const have = current?.[k];
		if (k === "tags" && Array.isArray(v)) {
			if (missingTags(have, v).length) return true;
			continue;
		}
		if ((v === null || v === undefined) && (have === null || have === undefined)) continue;
		if (JSON.stringify(have) !== JSON.stringify(v)) return true;
	}
	return false;
}

/** Applies the managed properties to a note's properties, in place. */
export function applyFrontmatter(front: Record<string, unknown>, wanted: Frontmatter): void {
	for (const [k, v] of Object.entries(wanted)) {
		if (k === "tags" && Array.isArray(v)) {
			const have = front[k];
			const current = Array.isArray(have) ? have.map(String) : typeof have === "string" && have ? have.split(/[,\s]+/) : [];
			front[k] = [...current, ...missingTags(current, v)];
		} else if (v === null) {
			delete front[k];
		} else {
			front[k] = v;
		}
	}
}

export function groupByDay(ctx: RenderContext, items: TradeWithAccount[]): Map<string, TradeWithAccount[]> {
	const days = new Map<string, TradeWithAccount[]>();
	for (const item of items) {
		const d = tradeDay(ctx, item.trade);
		if (!d) continue;
		const list = days.get(d);
		if (list) list.push(item);
		else days.set(d, [item]);
	}
	return days;
}
