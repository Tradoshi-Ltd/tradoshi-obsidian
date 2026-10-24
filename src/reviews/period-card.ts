import { MarkdownRenderChild, setIcon, TFile, type App } from "obsidian";
import { colon, money, num, pctSign, percent, sign } from "../format";
import { t, tradesLabel } from "../i18n";
import { tradesFromVault } from "../journal-data";
import type TradoshiPlugin from "../main";
import { lockPanel, offerEvents, showable } from "../offer";
import { mainCurrency, type DashTrade, type Group } from "../stats";
import { multiLine } from "../widgets/analytics-charts";
import type { WidgetContext } from "../widgets/types";
import { questionsFor } from "./data";
import { breakdown, cumulativeByDay, delta, periodFigures, setupsAndMistakes, topTrades, tradesIn, type PeriodFigures } from "./figures";
import { answerText, questionForm, type Answer } from "./form";
import { daysOf, parentOf, parsePeriod, periodOf, shiftPeriod, type Period } from "./periods";
import { answersOf, progress, propertyOf, type Question, type TemplateId } from "./questions";
import { TemplatesModal } from "./templates-modal";
import { rt } from "./text";
import { cardTip, periodLabel, periodShort, reviewTitle, section, typingIn } from "./ui";
import { dayNotes, fmOf, linkReview, markReviewed, openFile, openPeriod, reviewNotes, setProps, todayOf } from "./vault";

// The review of a week, a month, a quarter or a year, drawn in its review note: the
// figures against the period before, the curve of both, the period split day by day
// (or week by week, month by month), the daily reviews of a week side by side, the
// best and worst trades, setups and mistakes, and the questions of the review.

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export class PeriodCard extends MarkdownRenderChild {
	private timer: number | null = null;
	private dirty = false;
	private period: Period | null = null;
	private linked = false;
	/** Days of a week whose daily review is unfolded. */
	private openDays = new Set<string>();

	constructor(
		containerEl: HTMLElement,
		private readonly plugin: TradoshiPlugin,
		private readonly sourcePath: string,
		private readonly source: string,
	) {
		super(containerEl);
	}

	private get app(): App {
		return this.plugin.app;
	}

	onload(): void {
		this.render();
		const onOffer = (): void => this.render();
		offerEvents.add(onOffer);
		this.register(() => offerEvents.delete(onOffer));
		this.registerEvent(
			this.app.metadataCache.on("changed", (file, _data, cache) => {
				const p = this.period;
				const fm = cache.frontmatter;
				const day = typeof fm?.trading_day === "string" ? fm.trading_day : typeof fm?.tradoshi_day === "string" ? fm.tradoshi_day : null;
				if (file.path === this.sourcePath || (p && day && day >= p.start && day <= p.end)) this.schedule();
			}),
		);
		this.registerDomEvent(this.containerEl, "focusout", () => {
			if (this.dirty) this.schedule();
		});
	}

	onunload(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
	}

	private schedule(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			if (typingIn(this.containerEl)) this.dirty = true;
			else {
				this.dirty = false;
				this.render();
			}
		}, 300);
	}

	private render(): void {
		const root = this.containerEl;
		root.empty();
		root.addClass("tradoshi-dc");
		root.addClass("tradoshi-rv");
		const file = this.app.vault.getFileByPath(this.sourcePath);
		const fm = fmOf(this.app, file);
		const p = parsePeriod(this.source.trim()) ?? parsePeriod(str(fm?.period) ?? "");
		if (!p || p.kind === "day") {
			root.createEl("p", { cls: "tradoshi-empty", text: rt("notAPeriod") });
			return;
		}
		this.period = p;
		// The review note of the period itself holds the answers; the block shown in another note reads them.
		const own = !!file && fm?.tradoshi_review === p.kind && fm.period === p.id;
		const note = own ? file : (reviewNotes(this.app).get(p.id) ?? null);
		if (own && file && !this.linked) {
			this.linked = true;
			void linkReview(this.plugin, p, file);
		}
		const all = tradesFromVault(this.app);
		const trades = tradesIn(p, all);
		const prevP = shiftPeriod(p, -1);
		const prevTrades = tradesIn(prevP, all);
		const currency = mainCurrency(trades.length ? trades : prevTrades.length ? prevTrades : all);
		const cur = periodFigures(trades, currency);
		const prev = periodFigures(prevTrades, currency);
		const tipper = cardTip(root);

		this.drawHead(root, p, note);
		this.drawCompare(root, cur, prev, prevTrades.length > 0, currency);
		if (trades.length || prevTrades.length) this.drawCurve(root, p, prevP, all, currency, tipper);
		this.drawBreakdown(root, p, all, currency);
		if (p.kind === "week") this.drawDailyReviews(root, p, all);
		if (trades.length) this.drawBestWorst(root, trades, currency);
		this.drawQuestions(root, p, note, own);
	}

	// ── Head ─────────────────────────────────────────────────────────────────

	private drawHead(root: HTMLElement, p: Period, note: TFile | null): void {
		const head = root.createDiv({ cls: "tradoshi-rv-head" });
		const title = head.createDiv({ cls: "tradoshi-rv-title" });
		title.createSpan({ cls: "tradoshi-rv-name", text: reviewTitle(p.kind) });
		title.createSpan({ cls: "tradoshi-muted", text: periodLabel(p) });
		const done = fmOf(this.app, note)?.review_done === true;
		title.createSpan({ cls: `tradoshi-badge ${done ? "is-reviewed" : ""}`, text: done ? `✓ ${rt("reviewed")}` : p.end >= todayOf(this.plugin) ? rt("inProgress") : rt("toReview") });
		const nav = head.createDiv({ cls: "tradoshi-rv-nav" });
		const go = (label: string, aria: string, target: Period | null): void => {
			const b = nav.createEl("button", { text: label, attr: { "aria-label": aria } });
			b.disabled = !target;
			if (target) b.addEventListener("click", () => void openPeriod(this.plugin, target));
		};
		go("‹", rt("previousPeriod"), shiftPeriod(p, -1));
		const up = parentOf(p);
		if (up) go(periodShort(up), reviewTitle(up.kind), up);
		go("›", rt("nextPeriod"), shiftPeriod(p, 1));
		if (!showable(this.plugin, "essentiel")) return;
		const b = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": rt("cmdQuestions") } });
		setIcon(b, "list-checks");
		b.addEventListener("click", () => new TemplatesModal(this.app, this.plugin, p.kind as TemplateId, () => this.render()).open());
	}

	// ── Figures against the previous period ─────────────────────────────────

	private drawCompare(root: HTMLElement, cur: PeriodFigures, prev: PeriodFigures, hasPrev: boolean, c: string): void {
		const grid = root.createDiv({ cls: "tradoshi-rv-kpis" });
		const tile = (label: string, now: number | null, before: number | null, fmt: (v: number) => string, better: "up" | "down" | "none", tone = ""): void => {
			const k = grid.createDiv({ cls: "tradoshi-kpi" });
			k.createDiv({ cls: "tradoshi-kpi-label", text: label });
			k.createDiv({ cls: `tradoshi-kpi-value ${tone}`, text: now === null ? "–" : fmt(now) });
			const sub = k.createDiv({ cls: "tradoshi-kpi-sub" });
			if (!hasPrev || before === null) {
				sub.setText(hasPrev ? `${rt("before")} –` : rt("noPrevious"));
				return;
			}
			const d = delta(now, before);
			sub.createSpan({ text: `${rt("before")} ${fmt(before)} ` });
			if (d !== null && Math.abs(d) > 1e-9) {
				const good = better === "up" ? d > 0 : d < 0;
				sub.createSpan({ cls: better === "none" ? "" : good ? "pos" : "neg", text: d > 0 ? "▲" : "▼" });
			}
		};
		tile(t("net"), cur.net, prev.net, (v) => money(v, c), "up", sign(cur.net));
		tile(t("trades"), cur.trades, prev.trades, (v) => String(v), "none");
		tile(t("winRate"), cur.winRate, prev.winRate, (v) => `${num(v, 0)}${pctSign()}`, "up");
		tile(t("profitFactor"), cur.profitFactor, prev.profitFactor, (v) => num(v), "up");
		tile(t("expectancy"), cur.expectancy, prev.expectancy, (v) => money(v, c), "up", sign(cur.expectancy ?? 0));
		tile(t("avgR"), cur.avgR, prev.avgR, (v) => `${v > 0 ? "+" : ""}${num(v)} R`, "up", sign(cur.avgR ?? 0));
		tile(t("maxDrawdown"), cur.trades ? cur.maxDrawdown : null, prev.trades ? prev.maxDrawdown : null, (v) => (v ? money(-v, c) : "–"), "down", cur.maxDrawdown ? "neg" : "");
		tile(rt("greenDays"), cur.tradingDays ? cur.greenDays : null, prev.tradingDays ? prev.greenDays : null, (v) => String(v), "up");
		const extra: string[] = [];
		if (cur.tradingDays) extra.push(rt("daysTraded", { n: cur.tradingDays, g: cur.greenDays, r: cur.redDays }));
		if (cur.bestDay) extra.push(`${rt("bestDay")} ${periodShort(periodOf("day", cur.bestDay.day))} ${money(cur.bestDay.pnl, c)}`);
		if (cur.worstDay) extra.push(`${rt("worstDay")} ${periodShort(periodOf("day", cur.worstDay.day))} ${money(cur.worstDay.pnl, c)}`);
		if (cur.planRate !== null) extra.push(`${rt("planFollowed")} ${percent(cur.planRate, 0)}`);
		if (extra.length) root.createDiv({ cls: "tradoshi-muted tradoshi-small tradoshi-rv-facts", text: extra.join(" · ") });
	}

	private drawCurve(root: HTMLElement, p: Period, prevP: Period, all: DashTrade[], c: string, tipper: ReturnType<typeof cardTip>): void {
		const today = todayOf(this.plugin);
		const days = daysOf(p);
		const prevDays = daysOf(prevP);
		const now = cumulativeByDay(p, all, c, today);
		const before = cumulativeByDay(prevP, all, c, today);
		const prevValues = days.map((_, i) => (i < before.length ? before[i] : (before[before.length - 1] ?? null)));
		const sec = section(root, rt("curveVs"));
		multiLine(
			sec,
			tipper as unknown as WidgetContext,
			days.map((_, i) => i),
			[
				{ name: periodShort(p), tone: (now.filter((v): v is number => v !== null).pop() ?? 0) >= 0 ? "gain" : "loss", values: now },
				{ name: periodShort(prevP), tone: "accent", values: prevValues, dashed: true },
			],
			{
				label: rt("curveVs"),
				axis: (v) => money(v, c),
				ratio: 0.3,
				firstLast: [periodShort(periodOf("day", days[0])), periodShort(periodOf("day", days[days.length - 1]))],
				tip: (i) => {
					const lines = [`${periodShort(periodOf("day", days[i]))}${colon()}${now[i] === null ? "–" : money(now[i] ?? 0, c, 2)}`];
					if (prevDays[i]) lines.push(`${periodShort(periodOf("day", prevDays[i]))}${colon()}${before[i] === null || before[i] === undefined ? "–" : money(before[i] ?? 0, c, 2)}`);
					return lines;
				},
			},
		);
	}

	// ── The period split ─────────────────────────────────────────────────────

	private drawBreakdown(root: HTMLElement, p: Period, all: DashTrade[], c: string): void {
		const rows = breakdown(p, all, c);
		const title = p.kind === "week" ? rt("dayByDay") : p.kind === "month" ? rt("weekByWeek") : rt("monthByMonth");
		const sec = section(root, title);
		const days = dayNotes(this.app);
		const reviews = reviewNotes(this.app);
		const today = todayOf(this.plugin);
		const table = sec.createEl("table", { cls: "tradoshi-table tradoshi-rv-table" });
		const head = table.createEl("tr");
		for (const h of [rt("period"), t("trades"), t("winRate"), t("net"), rt("reviewedShort"), rt("grade")]) head.createEl("th", { text: h });
		const max = Math.max(...rows.map((r) => Math.abs(r.net)), 1);
		for (const r of rows) {
			const note = r.period.kind === "day" ? (days.get(r.period.id) ?? null) : (reviews.get(r.period.id) ?? null);
			const nfm = fmOf(this.app, note);
			const tr = table.createEl("tr");
			const cell = tr.createEl("td");
			const canOpen = !!note || r.trades > 0 || (r.period.kind !== "day" && r.period.start <= today);
			const link = cell.createEl("a", { text: periodShort(r.period), href: "#" });
			if (!canOpen) link.addClass("tradoshi-muted");
			link.addEventListener("click", (e) => {
				e.preventDefault();
				if (canOpen) void openPeriod(this.plugin, r.period);
			});
			tr.createEl("td", { cls: "tradoshi-num", text: r.trades ? String(r.trades) : "–" });
			tr.createEl("td", { cls: "tradoshi-num", text: r.winRate === null ? "–" : `${num(r.winRate, 0)}${pctSign()}` });
			const pnl = tr.createEl("td", { cls: "tradoshi-num" });
			if (r.trades) {
				const bar = pnl.createDiv({ cls: "tradoshi-rv-cellbar" });
				bar.createDiv({ cls: `tradoshi-rv-cellbar-fill ${r.net >= 0 ? "is-gain" : "is-loss"}` }).setCssProps({ "--w": `${Math.max(3, (Math.abs(r.net) / max) * 100)}%` });
				bar.createSpan({ cls: `tradoshi-strong ${sign(r.net)}`, text: money(r.net, c) });
			} else pnl.setText("–");
			tr.createEl("td", { cls: "tradoshi-num", text: nfm?.review_done === true ? "✓" : note ? "…" : "–" });
			const grade = typeof nfm?.review_grade === "number" ? `${nfm.review_grade} / 5` : "–";
			tr.createEl("td", { cls: "tradoshi-num", text: grade });
		}
	}

	/** Each day of the week with what its report card says: plan, review, trades reviewed. */
	private drawDailyReviews(root: HTMLElement, p: Period, all: DashTrade[]): void {
		const days = dayNotes(this.app);
		const inWeek = daysOf(p).filter((d) => days.has(d));
		if (!inWeek.length) return;
		const sec = section(root, rt("dailyReviews"), rt("dailyReviewsHint"));
		const pre = questionsFor(this.plugin, "pre");
		const post = questionsFor(this.plugin, "post");
		for (const d of inWeek) {
			const file = days.get(d) ?? null;
			const fm = fmOf(this.app, file);
			const ts = all.filter((x) => x.day === d);
			const c = ts.length ? mainCurrency(ts) : null;
			const net = ts.filter((x) => x.currency === c).reduce((a, x) => a + x.pnl, 0);
			const details = sec.createEl("details", { cls: "tradoshi-rv-day" });
			if (this.openDays.has(d)) details.open = true;
			details.addEventListener("toggle", () => {
				if (details.open) this.openDays.add(d);
				else this.openDays.delete(d);
			});
			const summary = details.createEl("summary");
			summary.createSpan({ cls: "tradoshi-strong", text: periodShort(periodOf("day", d)) });
			if (c) summary.createSpan({ cls: sign(net), text: ` ${money(net, c)}` });
			summary.createSpan({ cls: "tradoshi-muted", text: ` · ${tradesLabel(ts.length)}${ts.length ? ` · ${rt("reviewedOf", { n: ts.filter((x) => x.reviewed).length, total: ts.length })}` : ""}` });
			if (fm?.review_done === true) summary.createSpan({ cls: "tradoshi-badge is-reviewed", text: "✓" });
			const body = details.createDiv({ cls: "tradoshi-rv-day-body" });
			const answered = (qs: Question[]): Question[] => {
				const a = answersOf(fm, qs);
				return qs.filter((q) => a[q.id] !== undefined);
			};
			const planned = answered(pre);
			const reviewed = answered(post);
			if (!planned.length && !reviewed.length) body.createDiv({ cls: "tradoshi-muted tradoshi-small", text: rt("dayNotFilled") });
			if (planned.length) {
				body.createDiv({ cls: "tradoshi-rv-sub", text: rt("plan") });
				questionForm(body, planned, answersOf(fm, planned), () => undefined, { readOnly: true });
			}
			if (reviewed.length) {
				body.createDiv({ cls: "tradoshi-rv-sub", text: rt("postReview") });
				questionForm(body, reviewed, answersOf(fm, reviewed), () => undefined, { readOnly: true });
			}
			body.createEl("button", { text: rt("openDayCard") }).addEventListener("click", () => void openFile(this.app, file));
		}
	}

	// ── Best and worst ───────────────────────────────────────────────────────

	private drawBestWorst(root: HTMLElement, trades: DashTrade[], c: string): void {
		const grid = root.createDiv({ cls: "tradoshi-rv-pair" });
		const top = topTrades(trades, c, 3);
		const list = (parent: HTMLElement, title: string, ts: DashTrade[]): void => {
			const sec = section(parent, title);
			if (!ts.length) {
				sec.createDiv({ cls: "tradoshi-muted tradoshi-small", text: "–" });
				return;
			}
			for (const x of ts) {
				const row = sec.createEl("button", { cls: "tradoshi-review-row" });
				row.createSpan({ text: `${periodShort(periodOf("day", x.day))} · ${x.symbol} ${t(x.side)}` });
				row.createSpan({ cls: `tradoshi-num ${sign(x.pnl)}`, text: money(x.pnl, x.currency, 2) });
				row.disabled = !x.path;
				row.addEventListener("click", () => void openFile(this.app, x.path ? this.app.vault.getFileByPath(x.path) : null));
			}
		};
		list(grid, rt("bestTrades"), top.best);
		list(grid, rt("worstTrades"), top.worst);
		const { setups, mistakes } = setupsAndMistakes(trades, this.plugin.tagCategories(), c);
		const groups = (parent: HTMLElement, title: string, gs: Group[], empty: string): void => {
			const sec = section(parent, title);
			if (!gs.length) {
				sec.createDiv({ cls: "tradoshi-muted tradoshi-small", text: empty });
				return;
			}
			for (const g of gs.slice(0, 5)) {
				const row = sec.createDiv({ cls: "tradoshi-rv-group" });
				row.createSpan({ text: g.label });
				row.createSpan({ cls: "tradoshi-muted", text: `${tradesLabel(g.trades)}${g.winRate === null ? "" : ` · ${num(g.winRate, 0)}${pctSign()}`}` });
				row.createSpan({ cls: `tradoshi-num tradoshi-strong ${sign(g.net)}`, text: money(g.net, c) });
			}
		};
		groups(grid, rt("setupsRanked"), setups, rt("noSetups"));
		groups(grid, rt("mistakesRanked"), mistakes, rt("noMistakes"));
	}

	// ── Questions ────────────────────────────────────────────────────────────

	private drawQuestions(root: HTMLElement, p: Period, note: TFile | null, own: boolean): void {
		const id = p.kind as TemplateId;
		const questions = questionsFor(this.plugin, id);
		const fm = fmOf(this.app, note);
		const answers = answersOf(fm, questions);
		const pr = progress(questions, answers);
		const sec = section(root, rt("questions"), `${pr.answered}/${pr.total}`);
		// The review questions are part of the Essential plan; the figures above stay free.
		if (!showable(this.plugin, "essentiel")) return lockPanel(sec, this.plugin, "essentiel");
		this.drawCarried(sec, p, id);
		if (!own || !note) {
			questionForm(sec, questions, answers, () => undefined, { readOnly: true });
			sec.createEl("button", { text: rt("openReview") }).addEventListener("click", () => void openPeriod(this.plugin, p));
			return;
		}
		questionForm(sec, questions, answers, (q, v) => void this.answer(note, q, v));
		const foot = root.createDiv({ cls: "tradoshi-rv-foot" });
		foot.createSpan({ cls: "tradoshi-muted", text: rt("answeredOf", { n: pr.answered, total: pr.total }) });
		const done = fm?.review_done === true;
		const right = foot.createDiv({ cls: "tradoshi-rv-foot-actions" });
		if (done) right.createSpan({ cls: "pos", text: rt("reviewedOn", { d: str(fm?.review_date) ?? "" }) });
		right.createEl("button", { cls: done ? "" : "mod-cta", text: done ? rt("markUnreviewed") : rt("markPeriodReviewed") }).addEventListener("click", () => {
			void this.markDone(note, p, !done);
		});
	}

	/** What the review before asked to carry into this one. */
	private drawCarried(sec: HTMLElement, p: Period, id: TemplateId): void {
		const prev = reviewNotes(this.app).get(shiftPeriod(p, -1).id);
		if (!prev) return;
		const carried = questionsFor(this.plugin, id).filter((q) => q.carry);
		const answers = answersOf(fmOf(this.app, prev), carried);
		const lines = carried.filter((q) => answers[q.id] !== undefined);
		if (!lines.length) return;
		const box = sec.createDiv({ cls: "tradoshi-rv-carry" });
		box.createDiv({ cls: "tradoshi-rv-carry-title", text: rt("fromLastReview", { p: periodShort(shiftPeriod(p, -1)) }) });
		for (const q of lines) {
			const row = box.createDiv({ cls: "tradoshi-rv-carry-row" });
			row.createSpan({ cls: "tradoshi-muted", text: q.text });
			row.createDiv({ text: answerText(q, answers[q.id]) });
		}
	}

	private async answer(file: TFile, q: Question, value: Answer | null): Promise<void> {
		await setProps(this.app, file, { [propertyOf(q.id)]: value });
	}

	/** Marked reviewed, the review also keeps the figures of the period in its properties. */
	private async markDone(file: TFile, p: Period, done: boolean): Promise<void> {
		if (done) {
			const trades = tradesIn(p, tradesFromVault(this.app));
			const c = mainCurrency(trades);
			const f = periodFigures(trades, c);
			await setProps(this.app, file, {
				trades: f.trades,
				pnl: Math.round(f.net * 100) / 100,
				win_rate: f.winRate === null ? null : Math.round(f.winRate),
				currency: trades.length ? c : null,
			});
		}
		await markReviewed(this.app, file, done);
	}
}
