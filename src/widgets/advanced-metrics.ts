import { t } from "../i18n";
import { amount, money, num, pctSign, sign } from "../format";
import { advancedMetrics } from "../stats-advanced";
import type { DashTrade } from "../stats";
import { infoTiles, type InfoTile } from "./analytics-charts";
import { daysTraded, outcomeCount, tr, tradeRun } from "./analytics-i18n";
import { dateShort, periodTrades, span } from "./analytics-util";
import { cardTitle, emptyCard, type Widget } from "./types";

// Advanced metrics: 24 figures in three rows (risk and return, wins and losses, time
// and activity). Each tile explains on hover how it is computed; a figure the notes
// cannot give says so instead of showing zero.

const DASH = "–";

export const advancedMetricsWidget: Widget = {
	id: "advanced-metrics",
	title: () => tr("advTitle"),
	size: "full",
	defaultOn: true,
	render(card, ctx) {
		const trades = periodTrades(ctx);
		cardTitle(card, tr("advTitle"), trades.length ? tr("hoverHint") : undefined);
		if (!trades.length) return emptyCard(card, t("noTrade"));
		const m = advancedMetrics(trades, ctx.now);
		const c = ctx.currency;
		const ratio = (v: number | null): string => (v === null ? DASH : num(v));
		const tradeSub = (x: DashTrade | null): string => (x ? `${dateShort(x.at)} · ${x.symbol}` : " ");

		const up = m.underPeak;
		const longest = up?.longest ?? null;
		const risk: InfoTile[] = [
			{ label: tr("sharpe"), value: ratio(m.sharpe), sub: m.sharpe === null ? tr("needDays") : m.days < 15 ? tr("shortHistory") : tr("sharpeSub"), tone: sign(m.sharpe ?? 0), info: [tr("sharpeInfo1"), tr("sharpeInfo2")] },
			{
				label: tr("calmar"),
				value: ratio(m.calmar),
				sub: m.calmar === null ? tr("noDrawdown") : m.days < 40 ? tr("shortHistory") : tr("calmarSub"),
				tone: sign(m.calmar ?? 0),
				info: [tr("calmarInfo1"), tr("calmarInfo2")],
			},
			{ label: tr("recovery"), value: ratio(m.recovery), sub: m.recovery === null ? tr("noDrawdown") : tr("recoverySub"), tone: sign(m.recovery ?? 0), info: [tr("recoveryInfo")] },
			{ label: tr("payoff"), value: ratio(m.payoff), sub: tr("payoffSub"), info: [tr("payoffInfo")] },
			{ label: tr("avgDay"), value: m.avgPerDay === null ? DASH : money(m.avgPerDay, c), sub: daysTraded(m.days), tone: sign(m.avgPerDay ?? 0) },
			{ label: tr("dayVol"), value: m.dayStdDev === null ? DASH : amount(m.dayStdDev, c), sub: m.dayStdDev === null ? tr("needDays") : tr("dayVolSub"), info: [tr("dayVolInfo")] },
			{
				label: tr("underPeak"),
				value: !up ? DASH : up.below ? span(up.current) : tr("atPeak"),
				sub: !up ? " " : up.below ? tr("underSince", { date: dateShort(up.peakAt) }) : tr("highOn", { date: dateShort(up.peakAt) }),
				tone: up?.below ? "neg" : "pos",
				info: [tr("underInfo")],
			},
			{
				label: tr("longestDd"),
				value: longest ? span(longest.to - longest.from) : DASH,
				sub: !longest ? tr("noDrawdown") : longest.open ? tr("ongoing", { date: dateShort(longest.from) }) : `${dateShort(longest.from)} → ${dateShort(longest.to)}`,
				info: [tr("longestDdInfo")],
			},
		];

		const st = m.streaks;
		const wins: InfoTile[] = [
			{ label: tr("avgWin"), value: m.avgWin === null ? DASH : money(m.avgWin, c), sub: outcomeCount("win", m.wins), tone: "pos" },
			{ label: tr("avgLoss"), value: m.avgLoss === null ? DASH : money(m.avgLoss, c), sub: outcomeCount("loss", m.losses), tone: "neg" },
			{ label: tr("largestWin"), value: m.largestWin ? money(m.largestWin.pnl, c) : DASH, sub: tradeSub(m.largestWin), tone: "pos" },
			{ label: tr("largestLoss"), value: m.largestLoss ? money(m.largestLoss.pnl, c) : DASH, sub: tradeSub(m.largestLoss), tone: "neg" },
			{ label: tr("breakEven"), value: m.breakEvenRate === null ? DASH : `${num(m.breakEvenRate, 1)}${pctSign()}`, sub: tr("breakEvenSub", { n: m.evens }) },
			{ label: tr("winStreak"), value: String(st.bestWin?.length ?? 0), sub: tr("inARow"), tone: st.bestWin ? "pos" : "", info: [tr("streakInfo")] },
			{ label: tr("lossStreak"), value: String(st.bestLoss?.length ?? 0), sub: tr("inARow"), tone: st.bestLoss ? "neg" : "", info: [tr("streakInfo")] },
			{
				label: tr("currentStreak"),
				value: st.current ? tradeRun(st.current.kind, st.current.length) : DASH,
				tone: st.current?.kind === "win" ? "pos" : st.current ? "neg" : "",
				info: [tr("streakInfo")],
			},
		];

		const h = m.hold;
		const holdSub = (v: number | null): string => (v === null ? tr("noOpenTime") : h.known < m.trades ? tr("holdOf", { n: h.known, total: m.trades }) : tr("holdSub"));
		const fees = m.fees.known ? m.fees.total : null;
		const time: InfoTile[] = [
			{ label: tr("holdWin"), value: h.winners === null ? DASH : span(h.winners), sub: holdSub(h.winners), info: [tr("holdInfo")] },
			{ label: tr("holdLoss"), value: h.losers === null ? DASH : span(h.losers), sub: holdSub(h.losers), info: [tr("holdInfo")] },
			{ label: tr("perDay"), value: m.tradesPerDay === null ? DASH : num(m.tradesPerDay, 1), sub: tr("perDaySub") },
			{ label: tr("daysTraded"), value: String(m.days), sub: tr("daysTradedSub") },
			{ label: tr("volume"), value: m.volume ? num(m.volume.total) : DASH, sub: m.volume ? tr("volumeSub") : tr("noVolume") },
			{ label: tr("avgVolume"), value: m.volume ? num(m.volume.average) : DASH, sub: m.volume ? tr("avgVolumeSub") : tr("noVolume") },
			{ label: tr("fees"), value: fees === null ? DASH : money(fees, c, 2), sub: fees === null ? tr("noFees") : tr("feesSub"), tone: fees ? "neg" : "" },
			{ label: tr("beforeFees"), value: fees === null ? DASH : money(m.gross, c), sub: fees === null ? tr("noFees") : tr("beforeFeesSub"), tone: fees === null ? "" : sign(m.gross) },
		];

		for (const [title, items] of [
			[tr("gRisk"), risk],
			[tr("gWins"), wins],
			[tr("gTime"), time],
		] as const) {
			card.createDiv({ cls: "tradoshi-xgroup", text: title });
			infoTiles(card, ctx, items);
		}
	},
};
