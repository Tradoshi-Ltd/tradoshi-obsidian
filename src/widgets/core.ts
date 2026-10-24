import { emotionLabel, locale, t, tradesLabel } from "../i18n";
import { compactNumber, dateLabel, money, noonOf, num, sign } from "../format";
import { previousPeriod } from "../filters";
import { byCategory, byEmotion, byWeekday, dayTotals, equity, kpis, mainCurrency, planSplit, type Group } from "../stats";
import { columns, groupBars, lineChart, tiles } from "./charts";
import { cardTitle, emptyCard, type Widget } from "./types";

// The first widgets of the dashboard: key figures, equity, calendar, discipline,
// setups, emotions, weekdays and recent trades.

const perTrade = (): string => t("perTrade").split(" ").pop() ?? "";

export const kpisWidget: Widget = {
	id: "kpis",
	title: () => t("keyFigures"),
	size: "full",
	defaultOn: true,
	render(card, ctx) {
		card.addClass("is-bare");
		const k = kpis(ctx.trades, ctx.currency);
		// The same figures for the period just before, to compare with.
		const prevRange = previousPeriod(ctx.period, ctx.now);
		const prevTrades = prevRange ? ctx.all.filter((x) => x.at > prevRange.from && x.at <= prevRange.to) : [];
		const p = prevTrades.length ? kpis(prevTrades, ctx.currency) : null;
		const before = (text: string): string => (p ? t("previousPeriod", { v: text }) : " ");
		tiles(card, [
			{ label: t("net"), value: money(k.net, k.currency), sub: before(p ? money(p.net, k.currency) : ""), tone: sign(k.net) },
			{ label: t("winRate"), value: k.winRate === null ? "–" : `${num(k.winRate, 1)} %`, sub: before(p?.winRate == null ? "–" : `${num(p.winRate, 1)} %`) },
			{ label: t("profitFactor"), value: k.profitFactor === null ? "–" : num(k.profitFactor), sub: t("winsOverLosses") },
			{ label: t("expectancy"), value: k.expectancy === null ? "–" : money(k.expectancy, k.currency), sub: t("perTrade"), tone: sign(k.expectancy ?? 0) },
			{
				label: t("avgR"),
				value: k.avgR === null ? "–" : `${k.avgR > 0 ? "+" : ""}${num(k.avgR)} R`,
				sub: k.avgR === null ? " " : t("rCoverage", { n: k.rCoverage, total: k.trades }),
				tone: sign(k.avgR ?? 0),
			},
			{ label: t("trades"), value: String(k.trades), sub: before(p ? String(p.trades) : "") },
			{ label: t("maxDrawdown"), value: k.maxDrawdown ? money(-k.maxDrawdown, k.currency) : "–", sub: t("fromPeak"), tone: k.maxDrawdown ? "neg" : "" },
			{
				label: t("bestDay"),
				value: k.bestDay ? money(k.bestDay.pnl, k.currency) : "–",
				sub: k.bestDay ? dateLabel(noonOf(k.bestDay.day), { day: "numeric", month: "short" }) : " ",
				tone: k.bestDay ? "pos" : "",
			},
		]);
		if (k.otherCurrency) card.createEl("p", { cls: "tradoshi-note", text: t("mixedCurrency", { c: k.currency, n: k.otherCurrency }) });
	},
};

export const equityWidget: Widget = {
	id: "equity",
	title: () => t("equity"),
	size: "wide",
	defaultOn: true,
	render(card, ctx) {
		const pts = equity(ctx.trades, ctx.currency);
		cardTitle(card, t("equity"), pts.length ? t("tradesCount", { n: pts.length }) : undefined);
		if (!pts.length) return emptyCard(card, t("noTrade"));
		lineChart(
			card,
			ctx,
			pts.map((p) => ({
				at: p.at,
				value: p.value,
				tip: [
					dateLabel(p.at, { weekday: "short", day: "numeric", month: "short" }),
					`${p.trade.symbol} ${t(p.trade.side)} : ${money(p.trade.pnl, ctx.currency, 2)}`,
					`Σ ${money(p.value, ctx.currency, 2)}`,
				],
			})),
			{ label: t("equity"), currency: ctx.currency, firstLast: (ms) => dateLabel(ms, { day: "numeric", month: "short" }) },
		);
	},
};

export const calendarWidget: Widget = {
	id: "calendar",
	title: () => t("calendar"),
	size: "narrow",
	defaultOn: true,
	render(card, ctx) {
		const anchor = ctx.all.reduce((m, x) => Math.max(m, x.at), 0) || ctx.now;
		let month = ctx.state.calendar as { y: number; m: number } | undefined;
		if (!month) {
			const d = new Date(anchor);
			month = { y: d.getFullYear(), m: d.getMonth() };
			ctx.state.calendar = month;
		}
		const { y, m } = month;
		const head = card.createDiv({ cls: "tradoshi-card-title" });
		head.createSpan({ text: new Date(y, m, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" }) });
		const nav = head.createSpan({ cls: "tradoshi-cal-nav" });
		const go = (delta: number): void => {
			const d = new Date(y, m + delta, 1);
			ctx.state.calendar = { y: d.getFullYear(), m: d.getMonth() };
			ctx.redraw();
		};
		nav.createEl("button", { cls: "clickable-icon", text: "‹", attr: { "aria-label": t("previousMonth") } }).addEventListener("click", () => go(-1));
		nav.createEl("button", { cls: "clickable-icon", text: "›", attr: { "aria-label": t("nextMonth") } }).addEventListener("click", () => go(1));

		// The calendar uses the currency most trades of the month are in.
		const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;
		const ofMonth = ctx.all.filter((x) => x.day.startsWith(prefix));
		const calCurrency = ofMonth.length ? mainCurrency(ofMonth) : ctx.currency;
		const days = dayTotals(ctx.all.filter((x) => x.currency === calCurrency));
		const pad = (n: number): string => String(n).padStart(2, "0");
		const key = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		const first = new Date(y, m, 1);
		const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
		const weekend = [...days.keys()].some((k) => {
			const d = new Date(noonOf(k));
			return d.getMonth() === m && d.getFullYear() === y && (d.getDay() === 0 || d.getDay() === 6);
		});
		const cols = weekend ? 7 : 5;
		const grid = card.createDiv({ cls: `tradoshi-cal tradoshi-cal-${cols}` });
		for (let c = 0; c < cols; c++) grid.createDiv({ cls: "tradoshi-cal-head", text: new Date(2024, 0, 1 + c).toLocaleDateString(locale(), { weekday: "short" }) });
		grid.createDiv({ cls: "tradoshi-cal-head", text: t("week") });
		for (let w = 0; w < 6; w++) {
			const weekStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7);
			if (w > 3 && weekStart.getMonth() !== m) break;
			let wp = 0;
			let wn = 0;
			for (let c = 0; c < cols; c++) {
				const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + c);
				const v = days.get(key(d));
				const cell = grid.createEl("button", { cls: "tradoshi-cell" });
				cell.createSpan({ cls: "tradoshi-cell-day", text: String(d.getDate()) });
				if (d.getMonth() !== m) {
					cell.addClass("is-out");
					cell.disabled = true;
					continue;
				}
				if (v) {
					wp += v.pnl;
					wn += v.trades;
					cell.addClass(v.pnl >= 0 ? "is-gain" : "is-loss");
					cell.createSpan({ cls: "tradoshi-cell-pnl", text: compactNumber(v.pnl) });
					cell.createSpan({ cls: "tradoshi-cell-n", text: tradesLabel(v.trades) });
					cell.setAttr("aria-label", `${key(d)} ${money(v.pnl, calCurrency)}`);
					cell.addEventListener("click", () => void ctx.openDay(key(d)));
				} else {
					cell.disabled = true;
				}
			}
			const total = grid.createDiv({ cls: "tradoshi-cell tradoshi-cell-week" });
			total.createSpan({ cls: "tradoshi-cell-day", text: `${t("week").charAt(0)}${w + 1}` });
			if (wn) {
				total.createSpan({ cls: `tradoshi-cell-pnl ${sign(wp)}`, text: compactNumber(wp) });
				total.createSpan({ cls: "tradoshi-cell-n", text: tradesLabel(wn) });
			}
		}
	},
};

export const disciplineWidget: Widget = {
	id: "discipline",
	title: () => t("discipline"),
	size: "third",
	defaultOn: true,
	render(card, ctx) {
		cardTitle(card, t("discipline"));
		const { followed, broken } = planSplit(ctx.trades, ctx.currency);
		if (followed || broken) {
			const box = card.createDiv({ cls: "tradoshi-insight" });
			const line = (label: string, g: Group | null): void => {
				if (!g) return;
				const l = box.createDiv();
				l.createSpan({ text: `${label} : ` });
				l.createSpan({ cls: `tradoshi-strong ${sign(g.expectancy)}`, text: money(g.expectancy, ctx.currency) });
				l.createSpan({ cls: "tradoshi-muted", text: ` ${t("perTrade")} (${g.trades})` });
			};
			line(t("planFollowed"), followed);
			line(t("planBroken"), broken);
		}
		card.createDiv({ cls: "tradoshi-muted tradoshi-small", text: t("mistakes") });
		const mistakes = byCategory(ctx.trades, ctx.data.categories, "Mistakes", ctx.currency);
		if (!mistakes.length) emptyCard(card, t("noMistake"));
		else groupBars(card, mistakes, ctx.currency, perTrade());
	},
};

export const setupsWidget: Widget = {
	id: "setups",
	title: () => t("setups"),
	size: "third",
	defaultOn: true,
	render(card, ctx) {
		cardTitle(card, t("setups"));
		const groups = byCategory(ctx.trades, ctx.data.categories, "Setups", ctx.currency);
		if (!groups.length) emptyCard(card, t("noSetup"));
		else groupBars(card, groups, ctx.currency, perTrade());
	},
};

export const emotionsWidget: Widget = {
	id: "emotions",
	title: () => t("emotions"),
	size: "third",
	defaultOn: true,
	render(card, ctx) {
		cardTitle(card, t("emotions"));
		const groups = byEmotion(ctx.trades, ctx.currency).map((g) => ({ ...g, label: emotionLabel(g.label) }));
		if (!groups.length) emptyCard(card, t("noEmotion"));
		else groupBars(card, groups, ctx.currency, perTrade());
	},
};

export const recentWidget: Widget = {
	id: "recent",
	title: () => t("recent"),
	size: "wide",
	defaultOn: true,
	render(card, ctx) {
		cardTitle(card, t("recent"));
		const rows = [...ctx.trades].sort((a, b) => b.at - a.at).slice(0, 8);
		if (!rows.length) return emptyCard(card, t("noTrade"));
		const table = card.createEl("table", { cls: "tradoshi-table" });
		const head = table.createEl("tr");
		for (const h of [t("date"), t("symbol"), t("side"), t("account"), "R", t("result")]) head.createEl("th", { text: h });
		for (const x of rows) {
			const tr = table.createEl("tr");
			tr.createEl("td", { text: dateLabel(x.at, { day: "2-digit", month: "2-digit" }) });
			tr.createEl("td", { cls: "tradoshi-strong", text: x.symbol });
			tr.createEl("td", { text: t(x.side) });
			tr.createEl("td", { cls: "tradoshi-muted", text: x.account });
			tr.createEl("td", { cls: "tradoshi-num", text: x.r === null ? "–" : num(x.r) });
			tr.createEl("td", { cls: `tradoshi-num tradoshi-strong ${sign(x.pnl)}`, text: money(x.pnl, x.currency, 2) });
			if (x.path) {
				tr.addClass("is-link");
				tr.setAttr("tabindex", "0");
				tr.setAttr("aria-label", t("openNote"));
				const open = (): void => void ctx.openPath(x.path);
				tr.addEventListener("click", open);
				tr.addEventListener("keydown", (e) => {
					if (e.key === "Enter") open();
				});
			}
		}
	},
};

export const weekdaysWidget: Widget = {
	id: "weekdays",
	title: () => t("weekdays"),
	size: "narrow",
	defaultOn: true,
	render(card, ctx) {
		cardTitle(card, t("weekdays"));
		columns(
			card,
			ctx,
			byWeekday(ctx.trades, ctx.currency).map((d) => ({
				label: new Date(2024, 0, 1 + d.day).toLocaleDateString(locale(), { weekday: "short" }),
				value: d.pnl,
				empty: !d.trades,
				tip: [money(d.pnl, ctx.currency, 2), t("tradesCount", { n: d.trades })],
			})),
			{ label: t("weekdays") },
		);
	},
};

export const CORE_WIDGETS: Widget[] = [kpisWidget, equityWidget, calendarWidget, disciplineWidget, setupsWidget, emotionsWidget, recentWidget, weekdaysWidget];
