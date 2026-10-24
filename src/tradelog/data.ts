import type { App, TFile } from "obsidian";

// Every trade note of the vault for the trade log: missed and backtest trades included,
// with what the log shows and filters on. Missed and backtest trades are kept out of the
// dashboard figures (journal-data.ts), not out of the log.

export type TradeKind = "executed" | "missed" | "backtest";

export interface LogTrade {
	path: string;
	key: string;
	account: string;
	broker: string | null;
	currency: string;
	symbol: string;
	side: "long" | "short";
	/** Close, ms since epoch. */
	at: number;
	openAt: number | null;
	day: string;
	pnl: number;
	r: number | null;
	entry: number | null;
	exit: number | null;
	stopLoss: number | null;
	takeProfit: number | null;
	volume: number | null;
	fees: number;
	emotion: string | null;
	rating: number | null;
	followedPlan: boolean | null;
	/** Tradoshi tags and the trader's own (`review_tags`). */
	tags: string[];
	reviewed: boolean;
	kind: TradeKind;
	thesis: string | null;
	/** Images and videos embedded in the note. */
	media: number;
	/** True when the trade lives in the vault only (hand entry, imported file). */
	local: boolean;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const MEDIA = /\.(png|jpe?g|gif|webp|bmp|svg|avif|mp4|webm|mov|m4v)$/i;

export function tradeOf(app: App, file: TFile): LogTrade | null {
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter;
	const key = str(fm?.tradoshi_id);
	const day = str(fm?.trading_day);
	const pnl = num(fm?.pnl);
	if (!fm || !key || !day || pnl === null) return null;
	const closed = Date.parse(str(fm.closed_utc) ?? "");
	const at = Number.isFinite(closed) ? closed : Date.parse(`${day}T12:00:00`);
	const held = typeof fm.opened === "string" && typeof fm.closed === "string" ? Date.parse(`${fm.closed}Z`) - Date.parse(`${fm.opened}Z`) : NaN;
	const own = Array.isArray(fm.review_tags) ? fm.review_tags.map(String) : [];
	const synced = Array.isArray(fm.tradoshi_tags) ? fm.tradoshi_tags.map(String) : [];
	return {
		path: file.path,
		key,
		account: str(fm.account) ?? "Account",
		broker: str(fm.broker),
		currency: str(fm.currency) ?? "USD",
		symbol: str(fm.symbol) ?? "",
		side: fm.side === "short" ? "short" : "long",
		at,
		openAt: Number.isFinite(held) && held >= 0 ? at - held : null,
		day,
		pnl,
		r: num(fm.r_multiple),
		entry: num(fm.entry),
		exit: num(fm.exit),
		stopLoss: num(fm.stop_loss),
		takeProfit: num(fm.take_profit),
		volume: num(fm.volume),
		fees: (num(fm.commission) ?? 0) + (num(fm.swap) ?? 0),
		emotion: str(fm.emotion),
		rating: num(fm.rating),
		followedPlan: typeof fm.followed_plan === "boolean" ? fm.followed_plan : null,
		tags: [...new Set([...synced, ...own])],
		reviewed: fm.review_done === true,
		kind: fm.trade_type === "missed" ? "missed" : fm.trade_type === "backtest" ? "backtest" : "executed",
		thesis: str(fm.review_thesis),
		media: (cache?.embeds ?? []).filter((e) => MEDIA.test(e.link.split("#")[0].split("?")[0])).length,
		local: key.startsWith("file-"),
	};
}

export function logTrades(app: App): LogTrade[] {
	const out: LogTrade[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const t = tradeOf(app, file);
		if (t) out.push(t);
	}
	return out;
}
