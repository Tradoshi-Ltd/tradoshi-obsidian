import { emotionLabel } from "../i18n";
import { dateLabel, duration, money, num, sign } from "../format";
import { priceDigits } from "../tradecard/geometry";
import type { LogTrade } from "./data";
import { lt } from "./text";

export interface Column {
	id: string;
	label(): string;
	/** Value used to sort; null sorts last. */
	value(t: LogTrade, cats: Record<string, string>): number | string | null;
	render(td: HTMLTableCellElement, t: LogTrade, cats: Record<string, string>): void;
	numeric?: boolean;
}

const price = (v: number | null): string => (v === null ? "–" : num(v, priceDigits(v)));
const byCat = (t: LogTrade, cats: Record<string, string>, cat: string): string[] => t.tags.filter((x) => (cats[x] ?? "").toLowerCase() === cat);
const others = (t: LogTrade, cats: Record<string, string>): string[] => t.tags.filter((x) => !["setups", "mistakes"].includes((cats[x] ?? "").toLowerCase()));
const pills = (td: HTMLElement, tags: string[], cls: string): void => {
	for (const x of tags) td.createSpan({ cls: `tradoshi-tag ${cls}`, text: x });
};
const time = (ms: number | null): string => (ms === null ? "–" : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

export const COLUMNS: Column[] = [
	{ id: "date", label: () => lt("cDate"), value: (t) => t.at, render: (td, t) => td.setText(dateLabel(t.at, { day: "2-digit", month: "2-digit", year: "2-digit" })) },
	{ id: "open", label: () => lt("cOpen"), value: (t) => t.openAt, render: (td, t) => td.setText(time(t.openAt)) },
	{ id: "close", label: () => lt("cClose"), value: (t) => t.at, render: (td, t) => td.setText(time(t.at)) },
	{ id: "symbol", label: () => lt("cSymbol"), value: (t) => t.symbol, render: (td, t) => td.createSpan({ cls: "tradoshi-strong", text: t.symbol }) },
	{ id: "side", label: () => lt("cSide"), value: (t) => t.side, render: (td, t) => td.setText(lt(t.side)) },
	{ id: "account", label: () => lt("cAccount"), value: (t) => t.account, render: (td, t) => td.createSpan({ cls: "tradoshi-muted", text: t.account }) },
	{
		id: "pnl",
		label: () => lt("cPnl"),
		numeric: true,
		value: (t) => t.pnl,
		render: (td, t) => td.createSpan({ cls: `tradoshi-strong ${sign(t.pnl)}${t.kind === "executed" ? "" : " tradoshi-muted"}`, text: money(t.pnl, t.currency, 2) }),
	},
	{ id: "r", label: () => lt("cR"), numeric: true, value: (t) => t.r, render: (td, t) => td.createSpan({ cls: sign(t.r ?? 0), text: t.r === null ? "–" : num(t.r) }) },
	{ id: "duration", label: () => lt("cDuration"), numeric: true, value: (t) => (t.openAt === null ? null : t.at - t.openAt), render: (td, t) => td.setText(t.openAt === null ? "–" : duration(t.at - t.openAt)) },
	{ id: "entry", label: () => lt("cEntry"), numeric: true, value: (t) => t.entry, render: (td, t) => td.setText(price(t.entry)) },
	{ id: "exit", label: () => lt("cExit"), numeric: true, value: (t) => t.exit, render: (td, t) => td.setText(price(t.exit)) },
	{ id: "stop", label: () => lt("cStop"), numeric: true, value: (t) => t.stopLoss, render: (td, t) => td.setText(price(t.stopLoss)) },
	{ id: "target", label: () => lt("cTarget"), numeric: true, value: (t) => t.takeProfit, render: (td, t) => td.setText(price(t.takeProfit)) },
	{ id: "size", label: () => lt("cSize"), numeric: true, value: (t) => t.volume, render: (td, t) => td.setText(price(t.volume)) },
	{ id: "fees", label: () => lt("cFees"), numeric: true, value: (t) => t.fees, render: (td, t) => td.setText(t.fees ? money(t.fees, t.currency, 2) : "–") },
	{ id: "setups", label: () => lt("cSetups"), value: (t, c) => byCat(t, c, "setups").join(", ") || null, render: (td, t, c) => pills(td, byCat(t, c, "setups"), "is-setup") },
	{ id: "mistakes", label: () => lt("cMistakes"), value: (t, c) => byCat(t, c, "mistakes").join(", ") || null, render: (td, t, c) => pills(td, byCat(t, c, "mistakes"), "is-mistake") },
	{ id: "tags", label: () => lt("cTags"), value: (t, c) => others(t, c).join(", ") || null, render: (td, t, c) => pills(td, others(t, c), "") },
	{ id: "emotion", label: () => lt("cEmotion"), value: (t) => t.emotion, render: (td, t) => td.setText(t.emotion ? emotionLabel(t.emotion) : "–") },
	{ id: "plan", label: () => lt("cPlan"), value: (t) => (t.followedPlan === null ? null : t.followedPlan ? 1 : 0), render: (td, t) => td.setText(t.followedPlan === null ? "–" : t.followedPlan ? "✓" : "✗") },
	{ id: "rating", label: () => lt("cRating"), numeric: true, value: (t) => t.rating, render: (td, t) => td.setText(t.rating === null ? "–" : `${t.rating}/5`) },
	{ id: "reviewed", label: () => lt("cReviewed"), value: (t) => (t.reviewed ? 1 : 0), render: (td, t) => td.createSpan({ cls: t.reviewed ? "pos" : "tradoshi-muted", text: t.reviewed ? "✓" : "–" }) },
	{ id: "type", label: () => lt("cType"), value: (t) => t.kind, render: (td, t) => td.setText(lt(t.kind)) },
	{ id: "thesis", label: () => lt("cThesis"), value: (t) => t.thesis, render: (td, t) => td.createSpan({ cls: "tradoshi-log-thesis", text: t.thesis ?? "" }) },
	{ id: "media", label: () => lt("cMedia"), numeric: true, value: (t) => t.media, render: (td, t) => td.setText(t.media ? String(t.media) : "") },
];

export const DEFAULT_COLUMNS = ["date", "symbol", "side", "account", "pnl", "r", "duration", "setups", "mistakes", "reviewed"];
