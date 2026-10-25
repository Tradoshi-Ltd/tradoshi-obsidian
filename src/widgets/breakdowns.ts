import { t, tradesLabel } from "../i18n";
import { colon, compact, money, num, pctSign, sign } from "../format";
import type { DashTrade, Group } from "../stats";
import { byHour, bySide, hourSample, otherTags, rankHour, sideCurves, topGroups, type HourBucket, type Summary } from "../stats-advanced";
import { columns, groupBars } from "./charts";
import { chips, multiLine } from "./analytics-charts";
import { tr } from "./analytics-i18n";
import { dateShort, dateTime, periodTrades } from "./analytics-util";
import { cardTitle, emptyCard, type Widget, type WidgetContext } from "./types";

// Where the results come from: long against short, the hour of the open, the symbol
// and the tags other than setups and mistakes.

const perTrade = (): string => t("perTrade").split(" ").pop() ?? "";
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (v: number | null): string => (v === null ? "–" : `${num(v, 1)}${pctSign()}`);

export const longShortWidget: Widget = {
	id: "long-short",
	title: () => tr("sideTitle"),
	size: "narrow",
	defaultOn: true,
	render(card, ctx) {
		cardTitle(card, tr("sideTitle"));
		const trades = periodTrades(ctx);
		if (!trades.length) return emptyCard(card, t("noTrade"));
		const c = ctx.currency;
		const { long, short } = bySide(trades);
		const table = card.createDiv({ cls: "tradoshi-scroll-x" }).createEl("table", { cls: "tradoshi-table tradoshi-xside" });
		const head = table.createEl("tr");
		head.createEl("th");
		head.createEl("th", { cls: "tradoshi-num", text: cap(t("long")) });
		head.createEl("th", { cls: "tradoshi-num", text: cap(t("short")) });
		const row = (label: string, f: (s: Summary) => string, tone?: (s: Summary) => string): void => {
			const tr0 = table.createEl("tr");
			tr0.createEl("td", { cls: "tradoshi-muted", text: label });
			for (const s of [long, short]) tr0.createEl("td", { cls: `tradoshi-num tradoshi-strong ${s.trades && tone ? tone(s) : ""}`, text: s.trades ? f(s) : "–" });
		};
		row(t("net"), (s) => money(s.net, c), (s) => sign(s.net));
		row(t("trades"), (s) => String(s.trades));
		row(t("winRate"), (s) => pct(s.winRate));
		row(t("expectancy"), (s) => (s.expectancy === null ? "–" : money(s.expectancy, c)), (s) => sign(s.expectancy ?? 0));
		row(t("profitFactor"), (s) => (s.profitFactor === null ? "–" : num(s.profitFactor)));

		const curves = sideCurves(trades);
		card.createDiv({ cls: "tradoshi-xsubtitle", text: tr("sideCurves") });
		multiLine(
			card,
			ctx,
			curves.map((p) => p.trade.at),
			[
				{ name: cap(t("long")), tone: "long", values: curves.map((p) => (p.longN ? p.long : null)) },
				{ name: cap(t("short")), tone: "short", dashed: true, values: curves.map((p) => (p.shortN ? p.short : null)) },
			],
			{
				label: tr("sideCurves"),
				time: true,
				ratio: 0.5,
				axis: (v) => compact(v, c),
				tip: (i) => {
					const p = curves[i];
					return [
						dateTime(p.trade.at),
						`${cap(t("long"))}${colon()}${money(p.long, c, 2)} (${tradesLabel(p.longN)})`,
						`${cap(t("short"))}${colon()}${money(p.short, c, 2)} (${tradesLabel(p.shortN)})`,
					];
				},
				firstLast: [dateShort(curves[0].trade.at), dateShort(curves[curves.length - 1].trade.at)],
			},
		);
	},
};

const pad = (n: number): string => String(n).padStart(2, "0");
const hourRange = (h: number): string => `${pad(h)}:00–${pad(h + 1)}:00`;

export const hoursWidget: Widget = {
	id: "hours",
	title: () => tr("hourTitle"),
	size: "third",
	defaultOn: true,
	render(card, ctx) {
		const mode = ctx.state.hours === "avg" ? "avg" : "total";
		const head = cardTitle(card, tr("hourTitle"));
		chips(
			head,
			[
				{ value: "total", label: tr("hourTotal") },
				{ value: "avg", label: tr("hourAvg") },
			],
			mode,
			(v) => {
				ctx.state.hours = v;
				ctx.redraw();
			},
			tr("hourMode"),
		);
		const trades = periodTrades(ctx);
		if (!trades.length) return emptyCard(card, t("noTrade"));
		const { buckets, unknown } = byHour(trades);
		const traded = buckets.filter((b) => b.trades);
		if (!traded.length) return emptyCard(card, tr("noHour"));
		const c = ctx.currency;
		const from = traded[0].hour;
		const to = traded[traded.length - 1].hour;
		const shown = buckets.slice(from, to + 1);
		const value = (b: HourBucket): number => (mode === "avg" && b.trades ? b.net / b.trades : b.net);
		const winRate = (b: HourBucket): string => (b.wins + b.losses ? tr("pctWon", { v: Math.round((b.wins / (b.wins + b.losses)) * 100) }) : "");
		columns(
			card,
			ctx,
			shown.map((b) => ({
				label: pad(b.hour),
				value: value(b),
				empty: !b.trades,
				tip: [hourRange(b.hour), `${money(b.net, c, 2)} · ${money(b.trades ? b.net / b.trades : 0, c, 2)}/${perTrade()}`, tradesLabel(b.trades), winRate(b)].filter(Boolean),
			})),
			{ label: tr("hourTitle"), dense: shown.length > 8 },
		);
		const known = trades.length - unknown;
		const min = hourSample(known);
		const best = rankHour(buckets, min, "best");
		const worst = rankHour(buckets, min, "worst");
		if (best) card.querySelector(".tradoshi-columns")?.children.item(best.hour - from)?.addClass("is-best");
		const box = card.createDiv({ cls: "tradoshi-insight tradoshi-xhours" });
		const line = (label: string, b: HourBucket): void => {
			const l = box.createDiv();
			l.createSpan({ text: `${label}${colon()}` });
			l.createSpan({ cls: "tradoshi-strong", text: hourRange(b.hour) });
			l.createSpan({ cls: `tradoshi-strong ${sign(b.net)}`, text: ` ${money(b.net, c)}` });
			l.createSpan({ cls: "tradoshi-muted", text: ` · ${money(b.net / b.trades, c)}/${perTrade()} · ${tradesLabel(b.trades)}` });
		};
		if (best) line(tr("bestHour"), best);
		if (worst) line(tr("worstHour"), worst);
		if (!best && !worst) box.createDiv({ cls: "tradoshi-muted", text: tr("hourFew", { n: min }) });
		if (unknown) card.createEl("p", { cls: "tradoshi-note", text: tr("hourUnknown", { n: unknown }) });
	},
};

/** The groups, then the "others" row, on one scale. */
function breakdown(card: HTMLElement, ctx: WidgetContext, keysOf: (x: DashTrade) => string[], empty: string): void {
	const { groups, others } = topGroups(periodTrades(ctx), keysOf, 8);
	if (!groups.length) return emptyCard(card, empty);
	const rows: Group[] = others ? [...groups, { ...others, label: tr("others", { n: others.count }) }] : groups;
	groupBars(card, rows, ctx.currency, perTrade());
}

export const symbolsWidget: Widget = {
	id: "symbols",
	title: () => tr("symTitle"),
	size: "third",
	defaultOn: true,
	render(card, ctx) {
		cardTitle(card, tr("symTitle"));
		if (!ctx.trades.length) return emptyCard(card, t("noTrade"));
		breakdown(card, ctx, (x) => (x.symbol ? [x.symbol] : []), tr("noSymbol"));
	},
};

export const tagsWidget: Widget = {
	id: "tags",
	title: () => tr("tagTitle"),
	size: "third",
	defaultOn: true,
	render(card, ctx) {
		cardTitle(card, tr("tagTitle"));
		if (!ctx.trades.length) return emptyCard(card, t("noTrade"));
		breakdown(card, ctx, (x) => otherTags(x, ctx.data.categories), tr("noTag"));
	},
};

export const BREAKDOWN_WIDGETS: Widget[] = [longShortWidget, hoursWidget, symbolsWidget, tagsWidget];
