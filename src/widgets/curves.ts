import { t, tradesLabel } from "../i18n";
import { compact, money, num, sign } from "../format";
import { dailyResults, drawdownCurve, rolling, summarize, underPeak } from "../stats-advanced";
import { lineChart } from "./charts";
import { chips, multiLine, svgBars } from "./analytics-charts";
import { tr } from "./analytics-i18n";
import { allTrades, dateShort, dateTime, dayLong, dayShort, periodTrades, span } from "./analytics-util";
import { cardTitle, emptyCard, type Widget, type WidgetContext } from "./types";

// Results through time: the drawdown curve, the result of each day and of each trade,
// and the rolling win rate and average win and loss.

export const drawdownWidget: Widget = {
	id: "drawdown",
	title: () => tr("ddTitle"),
	size: "wide",
	defaultOn: true,
	render(card, ctx) {
		const trades = periodTrades(ctx);
		const pts = drawdownCurve(trades);
		const max = -Math.min(0, ...pts.map((p) => p.value));
		cardTitle(card, tr("ddTitle"), pts.length && max > 0 ? tr("ddExtra", { v: money(-max, ctx.currency) }) : undefined);
		if (!pts.length) return emptyCard(card, t("noTrade"));
		lineChart(
			card,
			ctx,
			pts.map((p) => ({
				at: p.at,
				value: p.value,
				tip: [
					dateTime(p.at),
					`${p.trade.symbol} ${t(p.trade.side)} : ${money(p.trade.pnl, ctx.currency, 2)}`,
					p.value < 0 ? tr("ddTip", { v: money(p.value, ctx.currency, 2) }) : tr("atPeak"),
					tr("ddHigh", { v: money(p.peak, ctx.currency, 2) }),
				],
			})),
			{ label: tr("ddTitle"), currency: ctx.currency, height: 420, tone: "loss", firstLast: dateShort },
		);
		const now = pts[pts.length - 1].value;
		const up = underPeak(trades, ctx.now);
		const row = card.createDiv({ cls: "tradoshi-xstats" });
		const stat = (label: string, value: string, tone = ""): void => {
			const s = row.createDiv({ cls: "tradoshi-xstat" });
			s.createDiv({ cls: "tradoshi-xstat-label", text: label });
			s.createDiv({ cls: `tradoshi-xstat-value ${tone}`, text: value });
		};
		stat(tr("ddNow"), now < 0 ? money(now, ctx.currency) : tr("atPeak"), now < 0 ? "neg" : "pos");
		stat(tr("ddMax"), max > 0 ? money(-max, ctx.currency) : tr("noDrawdown"), max > 0 ? "neg" : "");
		stat(tr("underPeak"), up?.below ? `${span(up.current)} · ${tr("underSince", { date: dateShort(up.peakAt) })}` : tr("atPeak"));
		if (up?.longest) stat(tr("longestDd"), span(up.longest.to - up.longest.from));
	},
};

export const dailyPnlWidget: Widget = {
	id: "daily-pnl",
	title: () => tr("dailyTitle"),
	size: "half",
	defaultOn: true,
	render(card, ctx) {
		const days = dailyResults(periodTrades(ctx));
		const green = days.filter((d) => d.pnl > 0).length;
		cardTitle(card, tr("dailyTitle"), days.length ? tr("dailyExtra", { g: green, n: days.length }) : undefined);
		if (!days.length) return emptyCard(card, t("noTrade"));
		svgBars(
			card,
			ctx,
			days.map((d) => ({
				value: d.pnl,
				tip: [
					dayLong(d.day),
					money(d.pnl, ctx.currency, 2),
					tradesLabel(d.trades),
					d.wins + d.losses ? tr("pctWon", { v: Math.round((d.wins / (d.wins + d.losses)) * 100) }) : "",
				].filter(Boolean),
				open: () => void ctx.openDay(d.day),
			})),
			{ label: tr("dailyTitle"), axis: (v) => compact(v, ctx.currency), firstLast: [dayShort(days[0].day), dayShort(days[days.length - 1].day)] },
		);
	},
};

export const tradeBarsWidget: Widget = {
	id: "trade-bars",
	title: () => tr("tradesTitle"),
	size: "half",
	defaultOn: true,
	render(card, ctx) {
		const trades = periodTrades(ctx);
		const s = summarize(trades);
		cardTitle(card, tr("tradesTitle"), trades.length ? tr("tradesExtra", { w: s.wins, l: s.losses }) : undefined);
		if (!trades.length) return emptyCard(card, t("noTrade"));
		svgBars(
			card,
			ctx,
			trades.map((x, i) => ({
				value: x.pnl,
				tip: [`#${i + 1} · ${dateTime(x.at)}`, `${x.symbol} ${t(x.side)} : ${money(x.pnl, ctx.currency, 2)}`, x.r === null ? "" : `${x.r > 0 ? "+" : ""}${num(x.r)} R`, x.path ? t("openNote") : ""].filter(Boolean),
				open: x.path ? () => void ctx.openPath(x.path) : undefined,
			})),
			{ label: tr("tradesTitle"), axis: (v) => compact(v, ctx.currency), firstLast: [dateShort(trades[0].at), dateShort(trades[trades.length - 1].at)] },
		);
	},
};

// ── Rolling figures ─────────────────────────────────────────────────────────

const WINDOWS = [10, 20, 50];
const MODULE = "analytics";

function rollingWindow(ctx: WidgetContext): number {
	const w = ctx.plugin.moduleData<{ window?: number }>(MODULE, {}).window;
	return w && WINDOWS.includes(w) ? w : 20;
}

/**
 * Rolling points of the trades of the period. The windows reach back before the period,
 * so the first trades of a short period already have a full window behind them.
 */
function rollingOfPeriod(ctx: WidgetContext, window: number): ReturnType<typeof rolling> {
	const inPeriod = new Set(periodTrades(ctx).map((x) => x.key));
	return rolling(allTrades(ctx), window).filter((p) => inPeriod.has(p.trade.key));
}

/** Header with the window chips; false when there are too few trades to draw. */
function rollingHead(card: HTMLElement, ctx: WidgetContext, title: string, window: number, points: number): boolean {
	const head = cardTitle(card, title);
	chips(
		head,
		WINDOWS.map((w) => ({ value: w, label: String(w) })),
		window,
		(w) => {
			const data = ctx.plugin.moduleData<Record<string, unknown>>(MODULE, {});
			void ctx.plugin.saveModuleData(MODULE, { ...data, window: w }).then(() => ctx.redraw());
		},
		tr("windowLabel"),
	);
	if (points) return true;
	if (!periodTrades(ctx).length) emptyCard(card, t("noTrade"));
	else emptyCard(card, tr("rollNeed", { n: window, k: allTrades(ctx).length }));
	return false;
}

export const rollingWinRateWidget: Widget = {
	id: "rolling-win-rate",
	title: () => tr("rollWrTitle"),
	size: "half",
	defaultOn: true,
	render(card, ctx) {
		const window = rollingWindow(ctx);
		const pts = rollingOfPeriod(ctx, window);
		if (!rollingHead(card, ctx, tr("rollWrTitle"), window, pts.length)) return;
		const period = summarize(periodTrades(ctx)).winRate;
		multiLine(
			card,
			ctx,
			pts.map((_, i) => i),
			[{ name: tr("rollExtra", { n: window }), tone: "accent", values: pts.map((p) => p.winRate) }],
			{
				label: tr("rollWrTitle"),
				axis: (v) => `${Math.round(v)} %`,
				range: [0, 100],
				refs: period === null ? [] : [{ value: period, label: tr("periodWr", { v: Math.round(period) }) }],
				tip: (i) => {
					const p = pts[i];
					return [dateTime(p.trade.at), `${t("winRate")} : ${p.winRate === null ? "–" : `${num(p.winRate, 1)} %`}`, tr("rollExtra", { n: window })];
				},
				firstLast: [dateShort(pts[0].trade.at), dateShort(pts[pts.length - 1].trade.at)],
			},
		);
	},
};

export const rollingAverageWidget: Widget = {
	id: "rolling-average",
	title: () => tr("rollAvgTitle"),
	size: "half",
	defaultOn: true,
	render(card, ctx) {
		const window = rollingWindow(ctx);
		const pts = rollingOfPeriod(ctx, window);
		if (!rollingHead(card, ctx, tr("rollAvgTitle"), window, pts.length)) return;
		const c = ctx.currency;
		multiLine(
			card,
			ctx,
			pts.map((_, i) => i),
			[
				{ name: tr("avgWin"), tone: "gain", values: pts.map((p) => p.avgWin) },
				{ name: tr("avgLoss"), tone: "loss", values: pts.map((p) => p.avgLoss) },
			],
			{
				label: tr("rollAvgTitle"),
				axis: (v) => compact(v, c).replace(/^\+/, ""),
				tip: (i) => {
					const p = pts[i];
					const payoff = p.avgWin !== null && p.avgLoss ? tr("payoffAt", { v: num(p.avgWin / p.avgLoss) }) : "";
					return [
						dateTime(p.trade.at),
						`${tr("avgWin")} : ${p.avgWin === null ? "–" : money(p.avgWin, c)}`,
						`${tr("avgLoss")} : ${p.avgLoss === null ? "–" : money(-p.avgLoss, c)}`,
						payoff,
						tr("rollExtra", { n: window }),
					].filter(Boolean);
				},
				firstLast: [dateShort(pts[0].trade.at), dateShort(pts[pts.length - 1].trade.at)],
			},
		);
		const last = pts[pts.length - 1];
		if (last.avgWin !== null && last.avgLoss) {
			const ratio = last.avgWin / last.avgLoss;
			card.createDiv({ cls: `tradoshi-xnote ${sign(ratio - 1)}`, text: tr("payoffAt", { v: num(ratio) }) });
		}
	},
};

export const CURVE_WIDGETS: Widget[] = [drawdownWidget, dailyPnlWidget, tradeBarsWidget, rollingWinRateWidget, rollingAverageWidget];
