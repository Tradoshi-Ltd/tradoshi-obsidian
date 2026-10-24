import { Notice } from "obsidian";
import { money, sign } from "../format";
import { tradesLabel } from "../i18n";
import { mainCurrency } from "../stats";
import { tiles } from "../widgets/charts";
import { cardTitle, emptyCard, type Widget, type WidgetContext } from "../widgets/types";
import { periodOf } from "./periods";
import { dayStreak, reviewTodo, tradedWeeks, tradeStreak, weekStreak, type TradingDay } from "./streaks";
import { rt } from "./text";
import { periodShort, weekRange } from "./ui";
import { dayNotes, ensureDayNote, fmOf, localDay, openFile, openPeriod, reviewNotes, todayOf } from "./vault";

// Two dashboard widgets: review streaks (days, trades and weeks reviewed in a row) and
// the reviews left to do. Both look at the whole journal: the period and the filters
// of the dashboard do not change a habit.

interface ReviewState {
	/** The day the streaks are counted to: today, or the last day of the sample journal. */
	today: string;
	days: TradingDay[];
	reviewedWeeks: Set<string>;
	trades: { at: number; day: string; reviewed: boolean }[];
}

/**
 * Days with trades and whether each is reviewed. The sample journal plays a trader
 * with a habit: its last day still to review, one day missed two weeks earlier, and
 * one week left without its review.
 */
function reviewState(ctx: WidgetContext): ReviewState {
	const traded = [...new Set(ctx.data.trades.map((x) => x.day))].sort();
	if (ctx.data.sample) {
		const today = traded[traded.length - 1] ?? localDay(ctx.now);
		const open = new Set([traded[traded.length - 1], traded[traded.length - 11]]);
		const weeks = tradedWeeks(traded).filter((w) => w.end < today);
		const skipped = weeks[weeks.length - 4]?.id;
		return {
			today,
			days: traded.map((day) => ({ day, reviewed: !open.has(day) })),
			reviewedWeeks: new Set(weeks.map((w) => w.id).filter((id) => id !== skipped)),
			trades: ctx.data.trades.map((x) => ({ at: x.at, day: x.day, reviewed: !open.has(x.day) })),
		};
	}
	const today = todayOf(ctx.plugin);
	const notes = dayNotes(ctx.app);
	const reviewedWeeks = new Set<string>();
	for (const [id, file] of reviewNotes(ctx.app)) if (fmOf(ctx.app, file)?.review_done === true) reviewedWeeks.add(id);
	return {
		today,
		days: traded.map((day) => ({ day, reviewed: fmOf(ctx.app, notes.get(day) ?? null)?.review_done === true })),
		reviewedWeeks,
		trades: ctx.data.trades,
	};
}

export const reviewStreaksWidget: Widget = {
	id: "review-streaks",
	title: () => rt("streaksTitle"),
	size: "narrow",
	defaultOn: false,
	plan: "essentiel",
	render(card, ctx) {
		cardTitle(card, rt("streaksTitle"));
		const s = reviewState(ctx);
		if (!s.days.length) return emptyCard(card, rt("noTradeYet"));
		const days = dayStreak(s.days, s.today);
		const trades = tradeStreak(s.trades, s.today);
		const weeks = weekStreak(tradedWeeks(s.days.map((d) => d.day)), s.reviewedWeeks, s.today);
		tiles(
			card,
			[
				{ label: rt("streakDays"), value: String(days.current), sub: rt("streakBest", { n: days.best }), tone: days.current ? "pos" : "" },
				{ label: rt("streakTrades"), value: String(trades.current), sub: rt("streakBest", { n: trades.best }), tone: trades.current ? "pos" : "" },
				{ label: rt("streakWeeks"), value: String(weeks.current), sub: rt("streakBest", { n: weeks.best }), tone: weeks.current ? "pos" : "" },
			],
			"tradoshi-rv-streaks",
		);
		const todayTraded = s.days.find((d) => d.day === s.today);
		if (!ctx.data.sample && todayTraded && !todayTraded.reviewed) card.createDiv({ cls: "tradoshi-muted tradoshi-small", text: rt("todayPending") });
	},
};

export const reviewsTodoWidget: Widget = {
	id: "reviews-todo",
	title: () => rt("todoTitle"),
	size: "wide",
	defaultOn: true,
	render(card, ctx) {
		const s = reviewState(ctx);
		const todo = reviewTodo(s.days, s.reviewedWeeks, s.today);
		const total = todo.days.length + todo.weeks.length;
		cardTitle(card, rt("todoTitle"), total ? String(total) : undefined);
		if (!s.days.length) return emptyCard(card, rt("noTradeYet"));
		if (!total) return emptyCard(card, rt("todoNone"));
		const cols = card.createDiv({ cls: "tradoshi-rv-todo" });
		const sampleNotice = (): void => {
			new Notice(rt("sampleReviews"));
		};

		const dayCol = cols.createDiv();
		dayCol.createDiv({ cls: "tradoshi-rv-sub", text: rt("todoDays", { n: todo.days.length }) });
		if (!todo.days.length) dayCol.createDiv({ cls: "tradoshi-muted tradoshi-small", text: rt("todoDaysNone") });
		const list = dayCol.createDiv({ cls: "tradoshi-review-list" });
		for (const day of todo.days.slice(0, 6)) {
			const ts = ctx.data.trades.filter((x) => x.day === day);
			const c = mainCurrency(ts);
			const net = ts.filter((x) => x.currency === c).reduce((a, x) => a + x.pnl, 0);
			const row = list.createEl("button", { cls: "tradoshi-review-row" });
			row.createSpan({ text: `${day === localDay() ? rt("today") : periodShort(periodOf("day", day))} · ${tradesLabel(ts.length)}` });
			row.createSpan({ cls: `tradoshi-num ${sign(net)}`, text: money(net, c) });
			row.addEventListener("click", () => {
				if (ctx.data.sample) return sampleNotice();
				void ensureDayNote(ctx.plugin, day).then((file) => openFile(ctx.app, file, true));
			});
		}
		if (todo.days.length > 6) dayCol.createDiv({ cls: "tradoshi-muted tradoshi-small", text: rt("andMore", { n: todo.days.length - 6 }) });

		const weekCol = cols.createDiv();
		weekCol.createDiv({ cls: "tradoshi-rv-sub", text: rt("todoWeeks", { n: todo.weeks.length }) });
		if (!todo.weeks.length) weekCol.createDiv({ cls: "tradoshi-muted tradoshi-small", text: rt("todoWeeksNone") });
		const wlist = weekCol.createDiv({ cls: "tradoshi-review-list" });
		for (const w of todo.weeks.slice(0, 4)) {
			const row = wlist.createEl("button", { cls: "tradoshi-review-row" });
			row.createSpan({ text: weekRange(w) });
			row.createSpan({ cls: "tradoshi-muted", text: rt("startReview") });
			row.addEventListener("click", () => {
				if (ctx.data.sample) return sampleNotice();
				void openPeriod(ctx.plugin, w, true);
			});
		}
		if (todo.weeks.length > 4) weekCol.createDiv({ cls: "tradoshi-muted tradoshi-small", text: rt("andMore", { n: todo.weeks.length - 4 }) });
	},
};

export const REVIEW_WIDGETS: Widget[] = [reviewsTodoWidget, reviewStreaksWidget];
