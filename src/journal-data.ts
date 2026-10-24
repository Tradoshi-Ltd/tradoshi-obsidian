import type { App } from "obsidian";
import { sampleTag } from "./i18n";
import { SAMPLE_ACCOUNTS, SAMPLE_LAST_CLOSE, SAMPLE_TAG_CATEGORIES, SAMPLE_TRADES } from "./sample-data";
import type { DashTrade } from "./stats";

// Where the dashboard reads its trades: the trade notes of the vault, so the figures
// are computed on the trader's computer, from his own files, and work offline. Before
// an account is connected, the sample journal stands in.

export interface DashData {
	sample: boolean;
	trades: DashTrade[];
	accounts: string[];
	/** Category of each Tradoshi tag ("Setups", "Mistakes"…). */
	categories: Record<string, string>;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Hour of a "YYYY-MM-DDTHH:mm" property, already in the journal time zone. */
function hourOf(v: unknown): number | null {
	const m = typeof v === "string" ? /T(\d{2}):/.exec(v) : null;
	return m ? Number(m[1]) : null;
}

/**
 * Open of a trade, in milliseconds. `opened` and `closed` are written in the journal
 * time zone; their difference is the holding time whatever the zone, so the open is
 * the absolute close minus that difference.
 */
function openOf(opened: unknown, closed: unknown, at: number): number | null {
	if (typeof opened !== "string" || typeof closed !== "string") return null;
	const held = Date.parse(`${closed}Z`) - Date.parse(`${opened}Z`);
	return Number.isFinite(held) && held >= 0 ? at - held : null;
}

export function tradesFromVault(app: App): DashTrade[] {
	const out: DashTrade[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		const key = str(fm?.tradoshi_id);
		const day = str(fm?.trading_day);
		const pnl = num(fm?.pnl);
		if (!fm || !key || !day || pnl === null) continue;
		// Missed and backtest trades are journaled, not counted.
		if (fm.trade_type === "missed" || fm.trade_type === "backtest") continue;
		const atIso = str(fm.closed_utc) ?? (str(fm.closed) ? `${String(fm.closed)}:00` : null) ?? `${day}T12:00:00`;
		const parsed = new Date(atIso).getTime();
		const at = Number.isNaN(parsed) ? new Date(`${day}T12:00:00Z`).getTime() : parsed;
		out.push({
			key,
			path: file.path,
			account: str(fm.account) ?? "Account",
			currency: str(fm.currency) ?? "USD",
			symbol: str(fm.symbol) ?? "",
			side: fm.side === "short" ? "short" : "long",
			at,
			day,
			hour: hourOf(fm.opened),
			openAt: openOf(fm.opened, fm.closed, at),
			pnl,
			r: num(fm.r_multiple),
			emotion: str(fm.emotion),
			followedPlan: typeof fm.followed_plan === "boolean" ? fm.followed_plan : null,
			tags: Array.isArray(fm.tradoshi_tags) ? fm.tradoshi_tags.map(String) : [],
			entry: num(fm.entry),
			exit: num(fm.exit),
			volume: num(fm.volume),
			stopLoss: num(fm.stop_loss),
			takeProfit: num(fm.take_profit),
			fees: (num(fm.commission) ?? 0) + (num(fm.swap) ?? 0),
			rating: num(fm.rating),
			broker: str(fm.broker),
			reviewed: fm.review_done === true,
		});
	}
	return out;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const localDay = (ms: number): string => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const WEEK = 7 * 86400000;

/** The sample journal, moved by whole weeks so that it is recent and weekdays stay weekdays. */
export function sampleTrades(now: number = Date.now()): DashTrade[] {
	const base = Date.parse(SAMPLE_LAST_CLOSE);
	const last = base + Math.floor((now - base) / WEEK) * WEEK;
	return SAMPLE_TRADES.map((r, i) => {
		const [acc, symbol, short, openedMin, closedMin, entry, exit, volume, pnl, rMultiple, emotion, followed, tags] = r;
		const at = last - closedMin * 60000;
		const opened = new Date(last - openedMin * 60000);
		const account = SAMPLE_ACCOUNTS[acc];
		return {
			key: `sample/${i}`,
			path: null,
			account: account.name,
			currency: account.currency,
			symbol,
			side: short ? "short" : "long",
			at,
			day: localDay(at),
			hour: opened.getHours(),
			openAt: opened.getTime(),
			pnl,
			r: rMultiple,
			emotion,
			followedPlan: followed === null ? null : followed === 1,
			tags: tags.map(sampleTag),
			entry,
			exit,
			volume,
			stopLoss: null,
			takeProfit: null,
			fees: 0,
			rating: null,
			broker: null,
			reviewed: i % 3 !== 0,
		};
	});
}

export function loadDashData(app: App, connected: boolean, categories: Record<string, string>): DashData {
	const trades = connected ? tradesFromVault(app) : [];
	if (!connected) {
		const categories = Object.fromEntries(Object.entries(SAMPLE_TAG_CATEGORIES).map(([tag, cat]) => [sampleTag(tag), cat]));
		return { sample: true, trades: sampleTrades(), accounts: SAMPLE_ACCOUNTS.map((a) => a.name), categories };
	}
	return { sample: false, trades, accounts: [...new Set(trades.map((t) => t.account))].sort(), categories };
}
