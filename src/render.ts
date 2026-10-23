import type { ApiAccount, ApiDayNote, ApiTrade, TradeWithAccount } from "./types";

// Everything in this file is pure: it turns journal data into note paths, note
// properties and Markdown. Nothing here touches the vault, so it can be tested
// without Obsidian.

export const BLOCK_START = "%% tradoshi:start %%";
export const BLOCK_END = "%% tradoshi:end %%";

export type Frontmatter = Record<string, string | number | boolean | string[] | null>;

export interface RenderContext {
	folder: string;
	appUrl: string;
	appLinks: boolean;
	tradeNotes: boolean;
	dailyNotes: boolean;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local calendar date (YYYY-MM-DD) of an ISO instant. */
export function localDate(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local date and time (YYYY-MM-DDTHH:mm), the format of a date-time property. */
export function localDateTime(iso: string | null): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return `${localDate(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localTime(iso: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The instant a trade belongs to: its close, or its open while still running. */
export function tradeInstant(t: ApiTrade): string | null {
	return t.closeTime ?? t.openTime;
}

export function money(value: number, currency: string): string {
	const sign = value > 0 ? "+" : value < 0 ? "-" : "";
	return `${sign}${Math.abs(value).toFixed(2)} ${currency}`;
}

// A "#" is dropped rather than replaced: "#BTCUSD" reads better as "BTCUSD" than "-BTCUSD".
function cleanFileName(s: string): string {
	return s.replace(/#/g, "").replace(/[\\/:*?"<>|^[\]]/g, "-").replace(/\s+/g, " ").trim();
}

/** Obsidian tags allow letters, digits, "-", "_" and "/", and cannot be numbers only. */
export function toTag(label: string): string | null {
	const tag = label
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}_\-/]/gu, "")
		.replace(/^\/+|\/+$/g, "");
	if (!tag || /^\d+$/.test(tag)) return null;
	return tag;
}

export function result(t: ApiTrade): "win" | "loss" | "breakeven" {
	return t.pnl > 0 ? "win" : t.pnl < 0 ? "loss" : "breakeven";
}

function shortId(id: string): string {
	const clean = cleanFileName(id);
	return clean.length > 14 ? clean.slice(-12) : clean;
}

export function tradeBaseName(t: ApiTrade): string {
	const when = tradeInstant(t);
	const date = when ? localDate(when) : "undated";
	return cleanFileName(`${date} ${t.symbol || "trade"} ${t.side} ${shortId(t.id)}`);
}

export function tradePath(ctx: RenderContext, t: ApiTrade): string {
	const when = tradeInstant(t);
	const year = when ? localDate(when).slice(0, 4) : "undated";
	return `${ctx.folder}/Trades/${year}/${tradeBaseName(t)}.md`;
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
	return ctx.dailyNotes ? `[[${withoutExtension(dayPath(ctx, date))}|${date}]]` : date;
}

/** Link to a trade note, written for a table cell (the pipe is escaped). */
function tradeLinkInTable(ctx: RenderContext, t: ApiTrade): string {
	const label = `${t.symbol.replace(/[|[\]]/g, "")} ${t.side}`;
	return ctx.tradeNotes ? `[[${withoutExtension(tradePath(ctx, t))}\\|${label}]]` : label;
}

export function appLink(ctx: RenderContext, campaign: string, hash = "journal", extraQuery = ""): string {
	const extra = extraQuery ? `&${extraQuery}` : "";
	return `${ctx.appUrl}/?utm_source=obsidian&utm_medium=plugin&utm_campaign=${campaign}${extra}${hash ? `#${hash}` : ""}`;
}

// ── Trade notes ─────────────────────────────────────────────────────────────

/** Properties written by the plugin. Any other property in the note is left alone. */
export function tradeFrontmatter(t: ApiTrade, account: ApiAccount): Frontmatter {
	const tags = ["tradoshi/trade"];
	for (const label of t.tags) {
		const tag = toTag(label);
		if (tag && !tags.includes(tag)) tags.push(tag);
	}
	return {
		tradoshi_id: `${account.id}/${t.id}`,
		symbol: t.symbol,
		side: t.side,
		result: result(t),
		pnl: round(t.pnl),
		currency: account.currency,
		r_multiple: t.rMultiple,
		opened: localDateTime(t.openTime),
		closed: localDateTime(t.closeTime),
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
		tags,
	};
}

const round = (n: number): number => Math.round(n * 100) / 100;

// A "#" followed by text is read as a tag by Obsidian: "#BTCUSD" in a heading or a
// table would add a tag to the note. It is escaped wherever it is shown as text.
const text = (s: string): string => s.replace(/#/g, "\\#");

const cell = (v: string | number | null | undefined): string =>
	v === null || v === undefined || v === "" ? "-" : text(String(v)).replace(/\|/g, "\\|");

export function tradeBlock(ctx: RenderContext, t: ApiTrade, account: ApiAccount): string {
	const lines: string[] = [];
	const when = tradeInstant(t);
	lines.push(`# ${text(t.symbol)} ${t.side}, ${money(t.pnl, account.currency)}`);
	lines.push("");
	if (when) lines.push(`Day: ${dayLink(ctx, localDate(when))}`, "");
	lines.push("| | |", "|---|---|");
	lines.push(`| Account | ${cell(account.name)}${account.broker ? ` (${cell(account.broker)})` : ""} |`);
	lines.push(`| Opened | ${cell(localDateTime(t.openTime)?.replace("T", " "))} |`);
	lines.push(`| Closed | ${cell(localDateTime(t.closeTime)?.replace("T", " "))} |`);
	lines.push(`| Entry, exit | ${cell(t.entryPrice)} → ${cell(t.exitPrice)} |`);
	lines.push(`| Volume | ${cell(t.volume)} |`);
	lines.push(`| Stop loss, take profit | ${cell(t.stopLoss)}, ${cell(t.takeProfit)} |`);
	lines.push(`| Net P&L | ${money(t.pnl, account.currency)} |`);
	lines.push(`| Fees | commission ${t.commission.toFixed(2)}, swap ${t.swap.toFixed(2)} |`);
	if (t.rMultiple !== null) lines.push(`| R multiple | ${t.rMultiple} R |`);
	if (t.emotion) lines.push(`| Emotion | ${cell(t.emotion)} |`);
	if (t.rating !== null) lines.push(`| Execution rating | ${t.rating} / 5 |`);
	if (t.followedPlan !== null) lines.push(`| Followed the plan | ${t.followedPlan ? "yes" : "no"} |`);
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
				`| ${localTime(tradeInstant(trade))} | ${tradeLinkInTable(ctx, trade)} | ${cell(trade.volume)} | ${money(trade.pnl, account.currency)} | ${trade.rMultiple === null ? "-" : trade.rMultiple} | ${cell(account.name)} |`,
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
	lines.push(`Last sync: ${localDateTime(generatedAt)?.replace("T", " ") ?? "-"}`, "");

	lines.push("## Accounts", "", "| Account | Broker | Trades | Updated in Tradoshi |", "|---|---|---|---|");
	for (const a of accounts) {
		lines.push(`| ${cell(a.name)}${a.mode === "demo" ? " (demo)" : ""} | ${cell(a.broker)} | ${a.tradeCount} | ${cell(localDateTime(a.updatedAt)?.replace("T", " "))} |`);
	}
	if (!accounts.length) lines.push("| No account yet | - | 0 | - |");

	const since = new Date(now.getTime() - 30 * 86400000).toISOString();
	const recent = items.filter(({ trade }) => (tradeInstant(trade) ?? "") >= since);
	const s = summarize(recent);
	const rate = winRate(s);
	lines.push("", "## Last 30 days", "", "| Net P&L | Trades | Win rate |", "|---|---|---|");
	lines.push(`| ${pnlText(s)} | ${s.trades} | ${rate === null ? "-" : `${rate} %`} |`);

	const days = [...new Set(items.map(({ trade }) => tradeInstant(trade)).filter((x): x is string => !!x).map(localDate))]
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

// Tags are shared with the trader: the plugin adds its own and never removes one,
// so a tag written by hand on a trade note survives every sync.
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

export function groupByDay(items: TradeWithAccount[]): Map<string, TradeWithAccount[]> {
	const days = new Map<string, TradeWithAccount[]>();
	for (const item of items) {
		const when = tradeInstant(item.trade);
		if (!when) continue;
		const d = localDate(when);
		const list = days.get(d);
		if (list) list.push(item);
		else days.set(d, [item]);
	}
	return days;
}
