import { MarkdownRenderChild, MarkdownRenderer, setIcon, TFile, type App } from "obsidian";
import { colon, money, num, pctSign, sign } from "../format";
import { t, tradesLabel } from "../i18n";
import { tradesFromVault } from "../journal-data";
import type TradoshiPlugin from "../main";
import { lockPanel, offerEvents, showable } from "../offer";
import type { DashTrade } from "../stats";
import { multiLine } from "../widgets/analytics-charts";
import type { WidgetContext } from "../widgets/types";
import { logSection } from "../session/logic";
import { questionsFor, sectionShown } from "./data";
import { dayFigures, intraday } from "./figures";
import { answerText, questionForm, type Answer } from "./form";
import { parsePeriod, periodOf, shiftPeriod } from "./periods";
import { answersOf, progress, propertyOf, tradeTemplate, type Question, type TemplateId } from "./questions";
import { TemplatesModal } from "./templates-modal";
import { rt } from "./text";
import { cardTip, periodShort, section, timeOf, typingIn } from "./ui";
import { dayNotes, dayOfNote, fmOf, markReviewed, openFile, openPeriod, reviewNotes, sessionNotes, setProps, todayOf } from "./vault";

// The report card of a trading day, drawn at the top of its day note: the figures and
// the curve of the day, its trades with a quick review of each, the plan written
// before the session and the review written after it, the sessions of the day, and
// whether the day is reviewed. Everything is read from the vault when drawn; answers
// go to `review_*` properties, never to the block the sync rewrites.

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Opens session mode; set by the session module, so the two modules do not import each other. */
export const sessionHooks: { open: (() => void) | null } = { open: null };

export class DayCard extends MarkdownRenderChild {
	/** Trades whose quick review is open, by key. */
	private open = new Set<string>();
	/** Session notes whose log is shown, by path. */
	private logs = new Set<string>();
	private timer: number | null = null;
	private dirty = false;
	private day: string | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly plugin: TradoshiPlugin,
		private readonly sourcePath: string,
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
				const fm = cache.frontmatter;
				if (file.path === this.sourcePath || (this.day && (fm?.trading_day === this.day || fm?.session_day === this.day))) this.schedule();
			}),
		);
		// A redraw put off while the trader was typing happens once the field is left.
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
		}, 250);
	}

	private render(): void {
		const root = this.containerEl;
		root.empty();
		root.addClass("tradoshi-dc");
		const file = this.app.vault.getFileByPath(this.sourcePath);
		const fm = fmOf(this.app, file);
		const day = dayOfNote(fm);
		if (!file || !fm || !day || !parsePeriod(day)) {
			root.createEl("p", { cls: "tradoshi-empty", text: rt("notADay") });
			return;
		}
		this.day = day;
		const trades = tradesFromVault(this.app)
			.filter((x) => x.day === day)
			.sort((a, b) => a.at - b.at);
		const tipper = cardTip(root);
		this.drawHead(root, file, day);
		if (sectionShown(this.plugin, "figures") && trades.length) this.drawFigures(root, trades);

		const grid = root.createDiv({ cls: "tradoshi-dc-grid" });
		const showCurve = sectionShown(this.plugin, "curve") && trades.length > 0;
		const sessions = sessionNotes(this.app, day);
		const isToday = day === todayOf(this.plugin);
		const showSessions = sectionShown(this.plugin, "sessions") && (sessions.length > 0 || isToday);
		if (sectionShown(this.plugin, "plan")) this.drawPlan(grid, file, fm, day, !showCurve);
		if (showCurve) this.drawCurve(grid, trades, tipper);
		if (sectionShown(this.plugin, "trades")) this.drawTrades(grid, trades);
		if (sectionShown(this.plugin, "review")) this.drawReview(grid, file, fm, !showSessions);
		if (showSessions) this.drawSessions(grid, sessions, !sectionShown(this.plugin, "review"));
		this.drawFooter(root, file, fm, trades);
	}

	// ── Head ─────────────────────────────────────────────────────────────────

	private drawHead(root: HTMLElement, file: TFile, day: string): void {
		const head = root.createDiv({ cls: "tradoshi-rv-head" });
		const title = head.createDiv({ cls: "tradoshi-rv-title" });
		title.createSpan({ cls: "tradoshi-rv-name", text: rt("dayCard") });
		const done = fmOf(this.app, file)?.review_done === true;
		title.createSpan({ cls: `tradoshi-badge ${done ? "is-reviewed" : ""}`, text: done ? `✓ ${rt("reviewed")}` : rt("toReview") });
		const nav = head.createDiv({ cls: "tradoshi-rv-nav" });
		const days = [...dayNotes(this.app).entries()].sort(([a], [b]) => a.localeCompare(b));
		const before = [...days].reverse().find(([d]) => d < day);
		const after = days.find(([d]) => d > day);
		const go = (label: string, aria: string, target: TFile | null): void => {
			const b = nav.createEl("button", { text: label, attr: { "aria-label": aria } });
			b.disabled = !target;
			b.addEventListener("click", () => void openFile(this.app, target));
		};
		go("‹", rt("previousDay"), before?.[1] ?? null);
		const week = periodOf("week", day);
		const weekNote = reviewNotes(this.app).get(week.id);
		const wb = nav.createEl("button", { text: `${weekNote && fmOf(this.app, weekNote)?.review_done === true ? "✓ " : ""}${rt("weekReviewOf", { w: periodShort(week) })}` });
		wb.addEventListener("click", () => void openPeriod(this.plugin, week));
		go("›", rt("nextDay"), after?.[1] ?? null);
		this.questionsButton(nav, "post");
	}

	/** Opens the question sets from the card, on the set it shows. */
	private questionsButton(nav: HTMLElement, tab: TemplateId): void {
		if (!showable(this.plugin, "essentiel")) return;
		const b = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": rt("cmdQuestions") } });
		setIcon(b, "list-checks");
		b.addEventListener("click", () => new TemplatesModal(this.app, this.plugin, tab, () => this.render()).open());
	}

	// ── Figures and curve ────────────────────────────────────────────────────

	private drawFigures(root: HTMLElement, trades: DashTrade[]): void {
		const f = dayFigures(trades, this.plugin.tagCategories());
		const c = f.currency;
		const grid = root.createDiv({ cls: "tradoshi-rv-kpis" });
		const tile = (label: string, value: string, sub: string, tone = ""): void => {
			const k = grid.createDiv({ cls: "tradoshi-kpi" });
			k.createDiv({ cls: "tradoshi-kpi-label", text: label });
			k.createDiv({ cls: `tradoshi-kpi-value ${tone}`, text: value });
			k.createDiv({ cls: "tradoshi-kpi-sub", text: sub || " " });
		};
		tile(t("net"), money(f.net, c, 2), f.otherCurrency ? rt("otherCurrency", { n: f.otherCurrency }) : "", sign(f.net));
		tile(t("trades"), String(f.trades), rt("winsLosses", { w: f.wins, l: f.losses }));
		tile(t("winRate"), f.winRate === null ? "–" : `${num(f.winRate, 0)}${pctSign()}`, "");
		tile(rt("bestTrade"), f.best ? money(f.best.pnl, c, 2) : "–", f.best ? f.best.symbol : "", f.best ? "pos" : "");
		tile(rt("worstTrade"), f.worst ? money(f.worst.pnl, c, 2) : "–", f.worst ? f.worst.symbol : "", f.worst ? "neg" : "");
		tile("R", f.rTotal === null ? "–" : `${f.rTotal > 0 ? "+" : ""}${num(f.rTotal)} R`, f.rTotal === null ? "" : rt("rKnown", { n: f.rKnown, total: f.trades }), sign(f.rTotal ?? 0));
		tile(
			t("discipline"),
			f.planKnown ? `${f.planFollowed}/${f.planKnown}` : "–",
			f.planKnown ? rt("planFollowed") : f.mistakes ? rt("mistakesN", { n: f.mistakes }) : "",
			f.planKnown ? (f.planFollowed === f.planKnown ? "pos" : "neg") : "",
		);
	}

	private drawCurve(grid: HTMLElement, trades: DashTrade[], tipper: ReturnType<typeof cardTip>): void {
		const f = dayFigures(trades, {});
		const pts = intraday(trades, f.currency);
		const sec = section(grid, rt("intraday"), tradesLabel(pts.length - 1));
		const ctx = tipper as unknown as WidgetContext;
		multiLine(
			sec,
			ctx,
			pts.map((p) => p.at),
			[{ name: rt("cumulative"), tone: (pts[pts.length - 1]?.value ?? 0) >= 0 ? "gain" : "loss", values: pts.map((p) => p.value) }],
			{
				label: rt("intraday"),
				axis: (v) => money(v, f.currency),
				time: true,
				ratio: 0.38,
				firstLast: pts.length ? [timeOf(this.plugin, pts[0].at), timeOf(this.plugin, pts[pts.length - 1].at)] : undefined,
				tip: (i) => {
					const p = pts[i];
					if (!p.trade) return [timeOf(this.plugin, p.at), rt("dayStart")];
					return [timeOf(this.plugin, p.at), `${p.trade.symbol} ${t(p.trade.side)}${colon()}${money(p.trade.pnl, f.currency, 2)}`, `Σ ${money(p.value, f.currency, 2)}`];
				},
			},
		);
	}

	// ── Trades and their quick review ───────────────────────────────────────

	private drawTrades(grid: HTMLElement, trades: DashTrade[]): void {
		const reviewed = trades.filter((x) => x.reviewed).length;
		const sec = section(grid, t("trades"), trades.length ? rt("reviewedOf", { n: reviewed, total: trades.length }) : undefined, "tradoshi-dc-wide");
		if (!trades.length) {
			sec.createDiv({ cls: "tradoshi-muted tradoshi-small", text: rt("noTradeDay") });
			return;
		}
		const accounts = new Set(trades.map((x) => x.account)).size > 1;
		const list = sec.createDiv({ cls: "tradoshi-dc-trades" });
		for (const x of trades) {
			const row = list.createDiv({ cls: `tradoshi-dc-trade${this.open.has(x.key) ? " is-open" : ""}` });
			const line = row.createDiv({ cls: "tradoshi-dc-trade-line" });
			line.createSpan({ cls: "tradoshi-muted tradoshi-num", text: timeOf(this.plugin, x.at) });
			const name = line.createEl("a", { cls: "tradoshi-dc-symbol", text: x.symbol, href: "#" });
			name.addEventListener("click", (e) => {
				e.preventDefault();
				void openFile(this.app, x.path ? this.app.vault.getFileByPath(x.path) : null);
			});
			line.createSpan({ cls: `tradoshi-badge is-${x.side}`, text: t(x.side) });
			if (accounts) line.createSpan({ cls: "tradoshi-muted tradoshi-dc-account", text: x.account });
			line.createSpan({ cls: `tradoshi-num tradoshi-dc-r ${sign(x.r ?? 0)}`, text: x.r === null ? "" : `${x.r > 0 ? "+" : ""}${num(x.r)} R` });
			line.createSpan({ cls: `tradoshi-num tradoshi-strong ${sign(x.pnl)}`, text: money(x.pnl, x.currency, 2) });
			const toggle = line.createEl("button", {
				cls: x.reviewed ? "tradoshi-dc-state is-reviewed" : "tradoshi-dc-state",
				text: x.reviewed ? `✓ ${rt("reviewed")}` : rt("review"),
				attr: { "aria-expanded": String(this.open.has(x.key)) },
			});
			toggle.disabled = !x.path;
			toggle.addEventListener("click", () => {
				if (this.open.has(x.key)) this.open.delete(x.key);
				else this.open.add(x.key);
				this.render();
			});
			if (this.open.has(x.key) && x.path) this.drawQuickReview(row, x);
		}
	}

	private drawQuickReview(row: HTMLElement, x: DashTrade): void {
		const file = x.path ? this.app.vault.getFileByPath(x.path) : null;
		if (!file) return;
		const fm = fmOf(this.app, file);
		const panel = row.createDiv({ cls: "tradoshi-dc-quick" });
		const which = tradeTemplate(x.pnl);
		panel.createDiv({ cls: "tradoshi-muted tradoshi-small", text: rt(which === "win" ? "quickWin" : which === "loss" ? "quickLoss" : "quickEven") });
		const tags = x.tags;
		if (tags.length) {
			const cats = this.plugin.tagCategories();
			const chips = panel.createDiv({ cls: "tradoshi-tc-tags" });
			for (const tag of tags) {
				const cat = (cats[tag] ?? "").toLowerCase();
				chips.createSpan({ cls: `tradoshi-tag${cat === "setups" ? " is-setup" : cat === "mistakes" ? " is-mistake" : ""}`, text: tag });
			}
		}
		const questions = questionsFor(this.plugin, which);
		questionForm(panel, questions, answersOf(fm, questions), (q, v) => void this.answer(file, q, v));
		const foot = panel.createDiv({ cls: "tradoshi-dc-quick-foot" });
		const done = fm?.review_done === true;
		foot.createSpan({ cls: done ? "pos" : "tradoshi-muted", text: done ? rt("reviewedOn", { d: str(fm?.review_date) ?? "" }) : rt("notReviewed") });
		const b = foot.createEl("button", { cls: done ? "" : "mod-cta", text: done ? rt("markUnreviewed") : rt("markTradeReviewed") });
		b.addEventListener("click", () => {
			if (!done) this.open.delete(x.key);
			void markReviewed(this.app, file, !done);
		});
	}

	private async answer(file: TFile, q: Question, value: Answer | null): Promise<void> {
		await setProps(this.app, file, { [propertyOf(q.id)]: value });
	}

	// ── Plan, review, sessions ───────────────────────────────────────────────

	private drawPlan(grid: HTMLElement, file: TFile, fm: Record<string, unknown>, day: string, wide: boolean): void {
		const questions = questionsFor(this.plugin, "pre");
		const answers = answersOf(fm, questions);
		const pr = progress(questions, answers);
		const sec = section(grid, rt("plan"), `${pr.answered}/${pr.total}`, wide ? "tradoshi-dc-wide" : "");
		// The written check-in is part of the Essential plan, as on the pricing page.
		if (!showable(this.plugin, "essentiel")) return lockPanel(sec, this.plugin, "essentiel");
		this.drawCarried(sec, day);
		questionForm(sec, questions, answers, (q, v) => void this.answer(file, q, v));
	}

	/** What the last reviews asked to keep in mind: the day before, and the week before. */
	private drawCarried(sec: HTMLElement, day: string): void {
		const lines: { from: string; q: Question; value: Answer }[] = [];
		const before = [...dayNotes(this.app).entries()].filter(([d]) => d < day).sort(([a], [b]) => b.localeCompare(a))[0];
		if (before) {
			const post = questionsFor(this.plugin, "post").filter((q) => q.carry);
			const answers = answersOf(fmOf(this.app, before[1]), post);
			for (const q of post) if (answers[q.id] !== undefined) lines.push({ from: periodShort(periodOf("day", before[0])), q, value: answers[q.id] });
		}
		const lastWeek = shiftPeriod(periodOf("week", day), -1);
		const weekNote = reviewNotes(this.app).get(lastWeek.id);
		if (weekNote) {
			const week = questionsFor(this.plugin, "week").filter((q) => q.carry);
			const answers = answersOf(fmOf(this.app, weekNote), week);
			for (const q of week) if (answers[q.id] !== undefined) lines.push({ from: periodShort(lastWeek), q, value: answers[q.id] });
		}
		if (!lines.length) return;
		const box = sec.createDiv({ cls: "tradoshi-rv-carry" });
		box.createDiv({ cls: "tradoshi-rv-carry-title", text: rt("keepInMind") });
		for (const l of lines) {
			const row = box.createDiv({ cls: "tradoshi-rv-carry-row" });
			row.createSpan({ cls: "tradoshi-muted", text: `${l.from} · ${l.q.text}` });
			row.createDiv({ text: answerText(l.q, l.value) });
		}
	}

	private drawReview(grid: HTMLElement, file: TFile, fm: Record<string, unknown>, wide: boolean): void {
		const questions = questionsFor(this.plugin, "post");
		const answers = answersOf(fm, questions);
		const pr = progress(questions, answers);
		const sec = section(grid, rt("postReview"), `${pr.answered}/${pr.total}`, wide ? "tradoshi-dc-wide" : "");
		if (!showable(this.plugin, "essentiel")) return lockPanel(sec, this.plugin, "essentiel");
		questionForm(sec, questions, answers, (q, v) => void this.answer(file, q, v));
	}

	private drawSessions(grid: HTMLElement, sessions: TFile[], wide: boolean): void {
		const sec = section(grid, rt("sessions"), sessions.length ? String(sessions.length) : undefined, wide ? "tradoshi-dc-wide" : "");
		if (!sessions.length) {
			sec.createDiv({ cls: "tradoshi-muted tradoshi-small", text: rt("noSession") });
			if (sessionHooks.open) sec.createEl("button", { text: rt("openSessionMode") }).addEventListener("click", () => sessionHooks.open?.());
			return;
		}
		for (const file of sessions) {
			const fm = fmOf(this.app, file) ?? {};
			const card = sec.createDiv({ cls: "tradoshi-dc-session" });
			const top = card.createDiv({ cls: "tradoshi-dc-session-top" });
			top.createSpan({ cls: "tradoshi-strong", text: str(fm.session) ?? rt("unplanned") });
			if (fm.unplanned === true) top.createSpan({ cls: "tradoshi-badge is-unplanned", text: rt("unplanned") });
			const span = [str(fm.started)?.slice(11, 16), str(fm.ended)?.slice(11, 16)].filter(Boolean).join(" → ");
			if (span) top.createSpan({ cls: "tradoshi-muted", text: span });
			const facts: string[] = [];
			const n = typeof fm.trades === "number" ? fm.trades : 0;
			facts.push(tradesLabel(n));
			if (typeof fm.pnl === "number" && typeof fm.currency === "string") facts.push(money(fm.pnl, fm.currency, 2));
			const go = Number(fm.gate_go) || 0, wait = Number(fm.gate_wait) || 0, nogo = Number(fm.gate_nogo) || 0;
			if (go + wait + nogo) facts.push(rt("gateCounts", { go, wait, nogo }));
			if (typeof fm.notes === "number" && fm.notes) facts.push(rt("notesN", { n: fm.notes }));
			card.createDiv({ cls: "tradoshi-muted tradoshi-small", text: facts.join(" · ") });
			if (fm.unplanned === true && str(fm.reason)) card.createDiv({ cls: "tradoshi-small", text: `${rt("reason")}${colon()}${str(fm.reason) ?? ""}` });
			const actions = card.createDiv({ cls: "tradoshi-dc-session-actions" });
			actions.createEl("button", { text: rt("openNote") }).addEventListener("click", () => void openFile(this.app, file));
			const shown = this.logs.has(file.path);
			actions.createEl("button", { text: shown ? rt("hideLog") : rt("showLog") }).addEventListener("click", () => {
				if (shown) this.logs.delete(file.path);
				else this.logs.add(file.path);
				this.render();
			});
			if (shown) {
				const box = card.createDiv({ cls: "tradoshi-dc-log" });
				void this.app.vault.cachedRead(file).then((text) => {
					const log = logSection(text);
					if (!log) box.createDiv({ cls: "tradoshi-muted", text: rt("noLog") });
					else void MarkdownRenderer.render(this.app, log, box, file.path, this);
				});
			}
		}
	}

	// ── Reviewed ─────────────────────────────────────────────────────────────

	private drawFooter(root: HTMLElement, file: TFile, fm: Record<string, unknown>, trades: DashTrade[]): void {
		const foot = root.createDiv({ cls: "tradoshi-rv-foot" });
		const parts: string[] = [];
		const pre = progress(questionsFor(this.plugin, "pre"), answersOf(fm, questionsFor(this.plugin, "pre")));
		const post = progress(questionsFor(this.plugin, "post"), answersOf(fm, questionsFor(this.plugin, "post")));
		if (sectionShown(this.plugin, "plan")) parts.push(`${rt("plan")} ${pre.answered}/${pre.total}`);
		if (trades.length) parts.push(`${t("trades")} ${trades.filter((x) => x.reviewed).length}/${trades.length}`);
		if (sectionShown(this.plugin, "review")) parts.push(`${rt("postReview")} ${post.answered}/${post.total}`);
		foot.createSpan({ cls: "tradoshi-muted", text: parts.join(" · ") });
		const done = fm.review_done === true;
		const right = foot.createDiv({ cls: "tradoshi-rv-foot-actions" });
		if (done) right.createSpan({ cls: "pos", text: rt("reviewedOn", { d: str(fm.review_date) ?? "" }) });
		right.createEl("button", { cls: done ? "" : "mod-cta", text: done ? rt("markUnreviewed") : rt("markDayReviewed") }).addEventListener("click", () => {
			void markReviewed(this.app, file, !done);
		});
	}
}
