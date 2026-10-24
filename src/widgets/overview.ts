import { locale, t, tradesLabel } from "../i18n";
import { colon, money, num, pctSign, sign } from "../format";
import { dayTotals } from "../stats";
import { dailyResults, dayKey, SCORE_MIN_DAYS, SCORE_MIN_TRADES, streaks, tradingScore, weekSummary, yearGrid, type Run, type ScorePart, type WeekStats } from "../stats-advanced";
import { columns } from "./charts";
import { dayRun, daysTraded, tr, tradeRun } from "./analytics-i18n";
import { allTrades, dayLong, dayShort, periodTrades } from "./analytics-util";
import { cardTitle, emptyCard, type Widget } from "./types";

// The trader's overview: the map of the year, the week against the one before, the
// streaks, and a trading score whose every part is shown.

const weekdayShort = (d: number): string => new Date(2024, 0, 1 + d).toLocaleDateString(locale(), { weekday: "short" });

export const yearMapWidget: Widget = {
	id: "year-map",
	title: () => tr("heatTitle"),
	size: "full",
	defaultOn: false,
	render(card, ctx) {
		const c = ctx.currency;
		const totals = dayTotals(allTrades(ctx));
		const g = yearGrid(totals, dayKey(ctx.now));
		cardTitle(card, tr("heatTitle"), g.traded ? tr("heatExtra", { n: g.traded, v: money(g.net, c) }) : undefined);
		if (!g.traded) return emptyCard(card, t("noTrade"));
		// One row per day of the week, one column per week; the oldest weeks are hidden
		// when the card is narrow (6 months, then 3), so the cells stay readable.
		const weeks = card.createDiv({ cls: "tradoshi-heat" });
		const age = (w: number): string => {
			const a = g.weeks.length - 1 - w;
			return `${a >= 13 ? " is-old13" : ""}${a >= 26 ? " is-old26" : ""}`;
		};
		const months = weeks.createDiv({ cls: "tradoshi-heat-row is-months" });
		months.createDiv({ cls: "tradoshi-heat-name" });
		g.weeks.forEach((_, w) => {
			const m = g.months.find((x) => x.week === w);
			months.createDiv({ cls: `tradoshi-heat-slot${age(w)}`, text: m ? new Date(m.year, m.month, 1).toLocaleDateString(locale(), { month: "short" }) : "" });
		});
		// Saturday and Sunday only take a row when one of them was traded.
		const rows = g.weeks.some((col) => col[5].pnl !== null || col[6].pnl !== null) ? 7 : 5;
		for (let d = 0; d < rows; d++) {
			const row = weeks.createDiv({ cls: "tradoshi-heat-row" });
			row.createDiv({ cls: "tradoshi-heat-name", text: d % 2 === 0 ? weekdayShort(d) : "" });
			g.weeks.forEach((col, w) => {
				const cell = col[d];
				const tone = cell.level > 0 ? ` is-g${cell.level}` : cell.level < 0 ? ` is-l${-cell.level}` : cell.pnl !== null ? " is-even" : "";
				const el = row.createDiv({ cls: `tradoshi-heat-cell${tone}${cell.future ? " is-future" : ""}${age(w)}`, attr: { "data-day": cell.day } });
				if (cell.pnl !== null) {
					el.setAttr("tabindex", "0");
					el.setAttr("role", "button");
					el.setAttr("aria-label", `${dayLong(cell.day)} ${money(cell.pnl, c)}`);
				}
			});
		}
		const cellOf = (e: Event): { day: string; traded: boolean } | null => {
			const el = e.target instanceof Element ? e.target.closest("[data-day]") : null;
			const day = el?.getAttribute("data-day");
			return day && !el?.hasClass("is-future") ? { day, traded: el?.getAttribute("role") === "button" } : null;
		};
		weeks.addEventListener("mousemove", (e) => {
			const hit = cellOf(e);
			if (!hit) return ctx.hideTip();
			const v = totals.get(hit.day);
			ctx.tip(e, v ? [dayLong(hit.day), money(v.pnl, c, 2), tradesLabel(v.trades)] : [dayLong(hit.day), tr("heatNone")]);
		});
		weeks.addEventListener("mouseleave", () => ctx.hideTip());
		weeks.addEventListener("click", (e) => {
			const hit = cellOf(e);
			if (hit?.traded) void ctx.openDay(hit.day);
		});
		weeks.addEventListener("keydown", (e) => {
			const hit = cellOf(e);
			if (hit?.traded && (e.key === "Enter" || e.key === " ")) {
				e.preventDefault();
				void ctx.openDay(hit.day);
			}
		});
		const legend = card.createDiv({ cls: "tradoshi-heat-legend" });
		legend.createSpan({ text: tr("heatLoss") });
		for (const cls of ["is-l4", "is-l3", "is-l2", "is-l1", "", "is-g1", "is-g2", "is-g3", "is-g4"]) legend.createSpan({ cls: `tradoshi-heat-cell ${cls}` });
		legend.createSpan({ text: tr("heatGain") });
	},
};

export const weekSummaryWidget: Widget = {
	id: "week-summary",
	title: () => tr("weekTitle"),
	size: "wide",
	defaultOn: false,
	render(card, ctx) {
		const c = ctx.currency;
		const { current, previous } = weekSummary(allTrades(ctx), dayKey(ctx.now));
		cardTitle(card, tr("weekTitle"), `${dayShort(current.monday)} – ${dayShort(current.days[6].day)}`);
		const cols = card.createDiv({ cls: "tradoshi-xweek" });
		const block = (title: string, w: WeekStats, isCurrent: boolean): void => {
			const b = cols.createDiv({ cls: "tradoshi-xweek-block" });
			b.createDiv({ cls: "tradoshi-xstat-label", text: title });
			if (!w.trades) {
				b.createDiv({ cls: "tradoshi-xweek-net", text: "–" });
				b.createDiv({ cls: "tradoshi-muted tradoshi-xweek-line", text: isCurrent ? tr("weekNone") : tr("heatNone") });
				return;
			}
			b.createDiv({ cls: `tradoshi-xweek-net ${sign(w.net)}`, text: money(w.net, c) });
			b.createDiv({
				cls: "tradoshi-muted tradoshi-xweek-line",
				text: `${tradesLabel(w.trades)} · ${daysTraded(w.daysTraded)}${w.winRate === null ? "" : ` · ${num(w.winRate, 0)}${pctSign()}`}`,
			});
			const day = (label: string, d: { day: string; pnl: number } | null): void => {
				if (!d) return;
				const l = b.createDiv({ cls: "tradoshi-xweek-line" });
				l.createSpan({ cls: "tradoshi-muted", text: `${label}${colon()}${dayLong(d.day)} ` });
				l.createSpan({ cls: `tradoshi-strong ${sign(d.pnl)}`, text: money(d.pnl, c) });
			};
			day(tr("weekBest"), w.best);
			if (w.daysTraded > 1) day(tr("weekWorst"), w.worst);
		};
		block(tr("thisWeek"), current, true);
		block(tr("lastWeek"), previous, false);
		if (current.trades && previous.trades) {
			const delta = current.net - previous.net;
			card.createDiv({ cls: `tradoshi-xnote ${sign(delta)}`, text: tr("weekVs", { v: money(delta, c) }) });
		}
		const weekend = [...current.days, ...previous.days].some((d, i) => i % 7 >= 5 && d.trades > 0);
		const days = current.days.slice(0, weekend ? 7 : 5);
		const mini = card.createDiv({ cls: "tradoshi-xweek-mini" });
		columns(
			mini,
			ctx,
			days.map((d, i) => ({ label: weekdayShort(i), value: d.pnl ?? 0, empty: d.pnl === null, tip: d.pnl === null ? [dayLong(d.day), tr("heatNone")] : [dayLong(d.day), money(d.pnl, c, 2), tradesLabel(d.trades)] })),
			{ label: tr("thisWeek") },
		);
	},
};

export const streaksWidget: Widget = {
	id: "streaks",
	title: () => tr("streakTitle"),
	size: "narrow",
	defaultOn: false,
	render(card, ctx) {
		const trades = allTrades(ctx);
		cardTitle(card, tr("streakTitle"), trades.length ? tr("allTime") : undefined);
		if (!trades.length) return emptyCard(card, t("noTrade"));
		const days = dailyResults(trades);
		const grid = card.createDiv({ cls: "tradoshi-xstreaks" });
		const block = (title: string, s: ReturnType<typeof streaks>, label: (k: "win" | "loss", n: number) => string, dateOf: (i: number) => string): void => {
			const b = grid.createDiv({ cls: "tradoshi-xstreak" });
			b.createDiv({ cls: "tradoshi-xstat-label", text: title });
			const now = s.current;
			b.createDiv({ cls: `tradoshi-xstreak-now ${now ? (now.kind === "win" ? "pos" : "neg") : ""}`, text: now ? label(now.kind, now.length) : "–" });
			b.createDiv({ cls: "tradoshi-muted tradoshi-small", text: now ? `${tr("streakNow")} · ${dateOf(now.from)}` : tr("streakNow") });
			const record = (name: string, r: Run | null, tone: string): void => {
				const l = b.createDiv({ cls: "tradoshi-xweek-line" });
				l.createSpan({ cls: "tradoshi-muted", text: `${name}${colon()}` });
				l.createSpan({ cls: `tradoshi-strong ${r ? tone : ""}`, text: r ? label(r.kind, r.length) : "–" });
				if (r && r.length > 1) l.createSpan({ cls: "tradoshi-muted", text: ` · ${tr("fromTo", { from: dateOf(r.from), to: dateOf(r.to) })}` });
			};
			record(tr("recordWin"), s.bestWin, "pos");
			record(tr("recordLoss"), s.bestLoss, "neg");
		};
		block(tr("streakDays"), streaks(days.map((d) => d.pnl)), dayRun, (i) => dayShort(days[i].day));
		block(tr("streakTrades"), streaks(trades.map((x) => x.pnl)), tradeRun, (i) => dayShort(trades[i].day));
		card.createEl("p", { cls: "tradoshi-note", text: tr("streakInfo") });
	},
};

// ── Trading score ───────────────────────────────────────────────────────────

const PART_NAMES = {
	profitFactor: ["pProfitFactor", "dProfitFactor"],
	winRate: ["pWinRate", "dWinRate"],
	payoff: ["pPayoff", "dPayoff"],
	greenDays: ["pGreenDays", "dGreenDays"],
	discipline: ["pDiscipline", "dDiscipline"],
	recovery: ["pRecovery", "dRecovery"],
} as const;

const PERCENT_PARTS = new Set(["winRate", "greenDays", "discipline"]);

function partValue(p: ScorePart): string {
	if (p.value === null) return "–";
	if (p.value === Infinity) return tr("noLoss");
	return PERCENT_PARTS.has(p.id) ? `${num(p.value, 1)}${pctSign()}` : num(p.value);
}

function ruleValue(p: ScorePart, v: number): string {
	const n = Number.isInteger(v) ? String(v) : num(v, 1);
	return PERCENT_PARTS.has(p.id) ? `${n}${pctSign()}` : n;
}

function band(score: number): { label: string; tone: string } {
	if (score >= 80) return { label: tr("scoreExcellent"), tone: "is-gain" };
	if (score >= 60) return { label: tr("scoreSolid"), tone: "is-gain" };
	if (score >= 40) return { label: tr("scoreDeveloping"), tone: "is-accent" };
	return { label: tr("scoreWeak"), tone: "is-loss" };
}

export const scoreWidget: Widget = {
	id: "trading-score",
	title: () => tr("scoreTitle"),
	size: "half",
	defaultOn: false,
	render(card, ctx) {
		cardTitle(card, tr("scoreTitle"));
		const trades = periodTrades(ctx);
		if (!trades.length) return emptyCard(card, t("noTrade"));
		const s = tradingScore(trades);
		const top = card.createDiv({ cls: "tradoshi-xscore" });
		const ring = top.createSvg("svg", { cls: "tradoshi-xscore-ring", attr: { viewBox: "0 0 100 100", role: "img", "aria-label": `${tr("scoreTitle")} ${s.score ?? "–"}` } });
		const R = 42;
		const C = 2 * Math.PI * R;
		ring.createSvg("circle", { cls: "tradoshi-xscore-track", attr: { cx: 50, cy: 50, r: R } });
		if (s.score !== null) {
			ring.createSvg("circle", {
				cls: ["tradoshi-xscore-arc", band(s.score).tone],
				attr: { cx: 50, cy: 50, r: R, "stroke-dasharray": `${((s.score / 100) * C).toFixed(1)} ${C.toFixed(1)}`, transform: "rotate(-90 50 50)" },
			});
		}
		ring.createSvg("text", { cls: "tradoshi-xscore-value", attr: { x: 50, y: 55, "text-anchor": "middle" } }).textContent = s.score === null ? "–" : String(s.score);
		const side = top.createDiv({ cls: "tradoshi-xscore-side" });
		if (s.score !== null) {
			side.createDiv({ cls: "tradoshi-xscore-band", text: band(s.score).label });
			side.createDiv({ cls: "tradoshi-muted", text: tr("scoreOf") });
		} else {
			side.createDiv({ cls: "tradoshi-muted", text: tr("scoreNeed", { n: SCORE_MIN_TRADES, d: SCORE_MIN_DAYS, k: s.decisive, j: s.days }) });
		}
		const list = card.createDiv({ cls: "tradoshi-xparts" });
		for (const p of s.parts) {
			const [name, desc] = PART_NAMES[p.id];
			const row = list.createDiv({ cls: `tradoshi-xpart${p.points === null ? " is-out" : ""}` });
			const head = row.createDiv({ cls: "tradoshi-xpart-head" });
			head.createSpan({ cls: "tradoshi-strong", text: tr(name) });
			head.createSpan({ cls: "tradoshi-xpart-value", text: partValue(p) });
			head.createSpan({ cls: "tradoshi-xpart-points", text: p.points === null ? tr("leftOut") : tr("pts", { n: Math.round(p.points) }) });
			const track = row.createDiv({ cls: "tradoshi-xpart-track" });
			if (p.points !== null) track.createDiv({ cls: "tradoshi-xpart-bar" }).setCssProps({ "--w": `${p.points}%` });
			row.createDiv({
				cls: "tradoshi-xpart-rule",
				text: `${tr(desc)} · ${tr("rule", { zero: ruleValue(p, p.zero), full: ruleValue(p, p.full) })} · ${tr("weight", { w: p.weight })}`,
			});
			if (p.id === "discipline" && p.points === null) row.createDiv({ cls: "tradoshi-xpart-rule", text: tr("disciplineMissing") });
		}
		card.createEl("p", { cls: "tradoshi-note", text: tr("scoreFoot") });
	},
};

export const OVERVIEW_WIDGETS: Widget[] = [weekSummaryWidget, streaksWidget, scoreWidget, yearMapWidget];
