import { ItemView, debounce, type WorkspaceLeaf } from "obsidian";
import type TradoshiPlugin from "../main";
import { amount, money, num, sign } from "../format";
import { tiles } from "../widgets/charts";
import { balanceChart } from "./chart";
import { AdvanceModal, ChallengeModal, ConfirmModal, PayoutModal } from "./modals";
import { newId } from "./profiles";
import { economics, evaluateChallenge, markFailed, reopen, restart, topAlerts, type Alert, type ChallengeEval, type Economics } from "./rules";
import { journalData, onChallengesChanged, PROPFIRM_VIEW, removeChallenge, saveChallenges, savedChallenges, shownChallenges, upsertChallenge, type Shown } from "./store";
import { tr } from "./texts";
import { alertRow, badge, dayLabel, dayLong, economicsLine, phaseSummary, roiText, ruleRow, statusChip, type Tipper } from "./ui";

// The prop firm view: one card per challenge, with the gauge of each rule, the balance
// against its limits, the phases, the payout and what the evaluation cost. Read from the
// trade notes of the vault and redrawn when they change.

export class PropFirmView extends ItemView {
	private showArchived = false;
	/** Phase shown on each card, when the trader picked another one than the current. */
	private readonly phaseShown = new Map<string, number>();
	private tipEl: HTMLElement | null = null;
	private readonly tipper: Tipper = {
		tip: (e, lines) => this.showTip(e, lines),
		hideTip: () => this.tipEl?.removeClass("is-visible"),
	};

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TradoshiPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return PROPFIRM_VIEW;
	}

	getDisplayText(): string {
		return tr("viewTitle");
	}

	getIcon(): string {
		return "trophy";
	}

	async onOpen(): Promise<void> {
		this.register(onChallengesChanged(() => this.refresh()));
		// Trade notes written by a sync arrive in bursts: one redraw once they settle.
		const later = debounce(() => this.refresh(), 1500, true);
		this.registerEvent(
			this.app.metadataCache.on("changed", (_file, _data, cache) => {
				if (cache.frontmatter?.tradoshi_id) later();
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on("deleted", (_file, prev) => {
				if (prev?.frontmatter?.tradoshi_id) later();
			}),
		);
		this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	refresh(): void {
		const top = this.contentEl.scrollTop;
		this.draw();
		this.contentEl.scrollTop = top;
	}

	private draw(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("tradoshi-dash", "tradoshi-pf-view");
		const data = journalData(this.plugin);
		const shown = shownChallenges(this.plugin, data);
		const evals = shown.challenges.map((c) => evaluateChallenge(c, data.trades, { today: shown.today }));
		const active = evals.filter((ev) => !ev.challenge.archived);
		const archived = evals.filter((ev) => ev.challenge.archived);

		this.drawHead(root, shown, archived.length, evals.length > 0 || shown.sample);
		if (shown.sample) this.drawSample(root);
		if (!evals.length) this.drawEmpty(root);
		else {
			const alerts = topAlerts(active);
			if (alerts.length) {
				const box = root.createDiv({ cls: "tradoshi-pf-alerts" });
				for (const { ev, alert } of alerts) alertRow(box, ev, alert, () => this.reveal(ev.challenge.id), true);
			}
			const eco = economics(shown.challenges).filter((e) => e.cost > 0 || e.received > 0);
			for (const e of eco) this.drawEconomics(root, e);
			const grid = root.createDiv({ cls: "tradoshi-pf-cards" });
			for (const ev of active) this.drawCard(grid, ev, shown);
			if (!active.length) root.createEl("p", { cls: "tradoshi-empty", text: tr("allArchived") });
			if (this.showArchived && archived.length) {
				root.createDiv({ cls: "tradoshi-card-title", text: tr("archived") });
				const old = root.createDiv({ cls: "tradoshi-pf-cards" });
				for (const ev of archived) this.drawCard(old, ev, shown);
			}
		}
		root.createEl("p", { cls: "tradoshi-note tradoshi-pf-footnote", text: tr("footnote") });
		this.tipEl = root.createDiv({ cls: "tradoshi-tip" });
	}

	private drawHead(root: HTMLElement, shown: Shown, archived: number, withCreate: boolean): void {
		const head = root.createDiv({ cls: "tradoshi-head" });
		const title = head.createDiv();
		title.createDiv({ cls: "tradoshi-pf-title", text: tr("viewTitle") });
		title.createDiv({ cls: "tradoshi-sub", text: tr("viewSub") });
		const controls = head.createDiv({ cls: "tradoshi-controls" });
		if (archived) {
			const b = controls.createEl("button", { cls: `tradoshi-chip${this.showArchived ? " is-active" : ""}`, text: tr("showArchived", { n: archived }) });
			b.setAttr("aria-pressed", String(this.showArchived));
			b.addEventListener("click", () => {
				this.showArchived = !this.showArchived;
				this.refresh();
			});
		}
		if (withCreate) {
			const create = controls.createEl("button", { cls: shown.sample ? "" : "mod-cta", text: tr("create") });
			create.addEventListener("click", () => new ChallengeModal(this.app, this.plugin, null).open());
		}
	}

	private drawSample(root: HTMLElement): void {
		const box = root.createDiv({ cls: "tradoshi-pf-banner" });
		box.createEl("strong", { text: tr("sampleTitle") });
		box.createEl("p", { text: tr("sampleText") });
	}

	private drawEmpty(root: HTMLElement): void {
		const box = root.createDiv({ cls: "tradoshi-pf-banner" });
		box.createEl("strong", { text: tr("emptyTitle") });
		box.createEl("p", { text: tr("emptyText") });
		const list = box.createEl("ul", { cls: "tradoshi-pf-list" });
		for (const key of ["emptyRules", "emptyPhases", "emptyPayouts", "emptyCost"] as const) list.createEl("li", { text: tr(key) });
		box.createEl("button", { cls: "mod-cta", text: tr("create") }).addEventListener("click", () => new ChallengeModal(this.app, this.plugin, null).open());
	}

	private drawEconomics(root: HTMLElement, e: Economics): void {
		const box = root.createDiv({ cls: "tradoshi-pf-eco-box" });
		box.createDiv({ cls: "tradoshi-card-title", text: tr("ecoTitle") });
		tiles(
			box,
			[
				{ label: tr("ecoChallenges"), value: String(e.challenges), sub: tr("ecoFunded", { n: e.funded }) },
				{ label: tr("ecoCost"), value: amount(e.cost, e.currency) },
				{ label: tr("ecoReceived"), value: amount(e.received, e.currency) },
				{ label: tr("ecoNet"), value: money(e.net, e.currency), tone: sign(e.net) },
				{ label: tr("ecoRoi"), value: roiText(e), sub: e.roi === null ? tr("ecoNoCost") : " ", tone: e.roi === null ? "" : sign(e.net) },
			],
			"tradoshi-kpis tradoshi-pf-kpis",
		);
	}

	/** Scrolls to a challenge's card. */
	private reveal(id: string): void {
		const card = this.contentEl.querySelector(`[data-challenge="${CSS.escape(id)}"]`);
		if (card instanceof HTMLElement) card.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	private drawCard(parent: HTMLElement, ev: ChallengeEval, shown: Shown): void {
		const c = ev.challenge;
		const cur = c.currency;
		const card = parent.createDiv({ cls: "tradoshi-card tradoshi-pf-card", attr: { "data-challenge": c.id } });
		const head = card.createDiv({ cls: "tradoshi-pf-card-head" });
		const title = head.createDiv({ cls: "tradoshi-pf-card-title" });
		title.createDiv({ cls: "tradoshi-pf-name", text: c.name });
		title.createDiv({ cls: "tradoshi-pf-meta", text: [c.firm, c.account, amount(c.size, cur)].filter(Boolean).join(" · ") });
		badge(head, ev);

		// The phases, oldest first: a click shows the figures of that phase.
		const reached = ev.phases.filter((p) => p.status !== "upcoming").length;
		const index = Math.min(this.phaseShown.get(c.id) ?? c.current, Math.max(0, reached - 1));
		const steps = card.createDiv({ cls: "tradoshi-pf-steps" });
		ev.phases.forEach((pe, i) => {
			const step = steps.createEl("button", { cls: `tradoshi-pf-step is-${pe.status}${i === index ? " is-shown" : ""}` });
			step.createDiv({ cls: "tradoshi-pf-step-name", text: `${i + 1}. ${pe.phase.name}` });
			const when = pe.phase.start ? (pe.phase.end && i < c.current ? `${dayLabel(pe.phase.start)} → ${dayLabel(pe.phase.end)}` : tr("since", { d: dayLabel(pe.phase.start) })) : "";
			step.createDiv({ cls: "tradoshi-pf-step-sub", text: [stepStatus(pe.status, pe.phase.outcome), when].filter(Boolean).join(" · ") });
			step.setAttr("aria-pressed", String(i === index));
			if (pe.status === "upcoming") step.disabled = true;
			else
				step.addEventListener("click", () => {
					this.phaseShown.set(c.id, i);
					this.refresh();
				});
		});

		const pe = ev.phases[index];
		if (index === c.current) for (const a of ev.alerts) alertRow(card, ev, a, shown.sample ? null : this.actionFor(ev, a, shown.today), false);

		const facts = card.createDiv({ cls: "tradoshi-pf-facts" });
		const fact = (label: string, value: string, tone = ""): void => {
			const f = facts.createDiv({ cls: "tradoshi-pf-fact" });
			f.createDiv({ cls: "tradoshi-pf-fact-label", text: label });
			f.createDiv({ cls: `tradoshi-pf-fact-value ${tone}`, text: value });
		};
		fact(tr("balance"), amount(pe.balance, cur));
		fact(tr("profit"), money(pe.profit, cur), sign(pe.profit));
		fact(tr("tradesLabel"), String(pe.trades.length));
		fact(tr("tradingDays"), String(pe.tradingDays));

		const rules = card.createDiv({ cls: "tradoshi-pf-rules" });
		if (!pe.rules.length) rules.createEl("p", { cls: "tradoshi-empty", text: tr("noRulesHint") });
		for (const r of pe.rules) ruleRow(rules, r, cur, { mode: pe.phase.rules.maxLossMode });
		if (pe.curve.length) balanceChart(card, this.tipper, c, pe);
		if (pe.otherCurrency) card.createEl("p", { cls: "tradoshi-note", text: tr("otherCurrency", { n: pe.otherCurrency, c: cur }) });
		if (!pe.trades.length && pe.status !== "upcoming") card.createEl("p", { cls: "tradoshi-note", text: tr("noTradeYet", { a: pe.phase.account || c.account }) });

		if (pe.phase.funded) this.drawPayout(card, ev, index === c.current ? ev : null, shown);

		if (c.cost !== null || c.payouts.length) {
			const [e] = economics([c]);
			economicsLine(card, e);
		}
		details(card, tr("rulesOfPhase"), phaseSummary(pe.phase, c.size, cur));

		if (shown.sample) card.createEl("p", { cls: "tradoshi-note", text: tr("sampleCard") });
		else this.drawActions(card, ev, shown.today);
	}

	private drawPayout(card: HTMLElement, ev: ChallengeEval, current: ChallengeEval | null, shown: Shown): void {
		const c = ev.challenge;
		const cur = c.currency;
		const policy = c.phases[c.current].payout;
		const box = card.createDiv({ cls: "tradoshi-pf-payout-box" });
		box.createDiv({ cls: "tradoshi-pf-sub-title", text: tr("payouts") });
		const p = current?.payout ?? null;
		if (p) {
			if (p.ready) {
				box.addClass("is-ready");
				statusChip(box, "met", tr("payoutReady", { v: amount(p.available, cur) }));
				if (p.share !== null) box.createDiv({ text: tr("payoutShare", { n: num(policy?.split ?? 0, 0), v: amount(p.share, cur) }) });
			} else {
				const missing: string[] = [];
				if (shown.today < p.from) missing.push(tr("payoutFrom", { d: dayLong(p.from) }));
				if (p.daysMissing) missing.push(tr("payoutDays", { n: p.daysMissing }));
				if (p.profitMissing > 0) missing.push(tr("payoutProfit", { v: amount(p.profitMissing, cur) }));
				else if (p.available <= 0) missing.push(tr("payoutNoProfit"));
				const onlyDate = missing.length === 1 && shown.today < p.from;
				statusChip(box, "pending", onlyDate ? tr("payoutPossibleOn", { d: dayLong(p.from) }) : tr("payoutNotYet"));
				if (!onlyDate) {
					const list = box.createEl("ul", { cls: "tradoshi-pf-list" });
					for (const m of missing) list.createEl("li", { text: m });
				}
				if (p.available > 0) box.createDiv({ cls: "tradoshi-pf-sub", text: tr("payoutAvailableNow", { v: amount(p.available, cur) }) });
			}
			if (p.roomAfter !== null && p.available > 0) box.createDiv({ cls: "tradoshi-pf-sub", text: tr("payoutRoomAfter", { v: amount(Math.max(0, p.roomAfter), cur) }) });
		} else if (!policy) {
			box.createDiv({ cls: "tradoshi-pf-sub", text: tr("noPolicy") });
		}
		if (c.payouts.length) {
			const table = box.createEl("table", { cls: "tradoshi-table" });
			const head = table.createEl("tr");
			head.createEl("th", { text: tr("date") });
			head.createEl("th", { cls: "tradoshi-num", text: tr("withdrawn") });
			head.createEl("th", { cls: "tradoshi-num", text: tr("received") });
			for (const x of c.payouts) {
				const row = table.createEl("tr");
				row.createEl("td", { text: dayLabel(x.day) });
				row.createEl("td", { cls: "tradoshi-num", text: amount(x.amount, cur) });
				row.createEl("td", { cls: "tradoshi-num tradoshi-strong pos", text: amount(x.received, cur) });
			}
		}
	}

	/** What an alert's line does when clicked. */
	private actionFor(ev: ChallengeEval, a: Alert, today: string): (() => void) | null {
		const c = ev.challenge;
		switch (a.kind) {
			case "passed":
				return () => new AdvanceModal(this.app, this.plugin, ev, today).open();
			case "payout":
				return () => new PayoutModal(this.app, this.plugin, c, ev.payout, today).open();
			case "failed":
				return () =>
					new ConfirmModal(this.app, tr("failTitle"), tr("failText"), tr("markFailed"), () => {
						void upsertChallenge(this.plugin, markFailed(c, a.day ?? today));
					}).open();
			default:
				return null;
		}
	}

	private drawActions(card: HTMLElement, ev: ChallengeEval, today: string): void {
		const c = ev.challenge;
		const bar = card.createDiv({ cls: "tradoshi-pf-actions" });
		const button = (text: string, onClick: () => void, cls = ""): void => {
			bar.createEl("button", { cls, text }).addEventListener("click", onClick);
		};
		const status = ev.current.status;
		const outcome = ev.current.phase.outcome;
		const next = c.phases[c.current + 1];
		if (!c.archived) {
			if ((status === "active" || status === "passed") && !outcome) {
				button(next ? tr("advanceCta", { next: next.name }) : tr("passCta"), () => new AdvanceModal(this.app, this.plugin, ev, today).open(), status === "passed" ? "mod-cta" : "");
			}
			if (status === "funded") button(tr("recordPayout"), () => new PayoutModal(this.app, this.plugin, c, ev.payout, today).open(), ev.payout?.ready ? "mod-cta" : "");
			if (status !== "failed" && !outcome) {
				button(tr("markFailed"), () =>
					new ConfirmModal(this.app, tr("failTitle"), tr("failText"), tr("markFailed"), () => {
						void upsertChallenge(this.plugin, markFailed(c, ev.current.failedOn ?? today));
					}).open(),
				);
			}
			if (outcome) button(tr("reopen"), () => void upsertChallenge(this.plugin, reopen(c)));
			if (status === "failed") {
				button(tr("newAttempt"), () => {
					// The failed attempt is archived; it still counts in the cost of the evaluations.
					const list = savedChallenges(this.plugin).map((x) => (x.id === c.id ? { ...x, archived: true } : x));
					list.push(restart(c, newId(), today));
					void saveChallenges(this.plugin, list);
				}, "mod-cta");
			}
		}
		button(tr("edit"), () => new ChallengeModal(this.app, this.plugin, c).open());
		button(c.archived ? tr("unarchive") : tr("archive"), () => void upsertChallenge(this.plugin, { ...c, archived: !c.archived }));
		button(
			tr("delete"),
			() => new ConfirmModal(this.app, tr("deleteTitle"), tr("deleteText", { name: c.name }), tr("delete"), () => void removeChallenge(this.plugin, c.id)).open(),
			"mod-warning",
		);
	}

	private showTip(e: MouseEvent, lines: string[]): void {
		if (!this.tipEl) return;
		this.tipEl.empty();
		for (const l of lines) this.tipEl.createDiv({ text: l });
		const box = this.contentEl.getBoundingClientRect();
		this.tipEl.setCssProps({ "--x": `${e.clientX - box.left + this.contentEl.scrollLeft + 14}px`, "--y": `${e.clientY - box.top + this.contentEl.scrollTop + 14}px` });
		this.tipEl.addClass("is-visible");
	}
}

function stepStatus(status: ChallengeEval["current"]["status"], outcome: "passed" | "failed" | null): string {
	if (status === "passed" && !outcome) return tr("stReached");
	return { upcoming: tr("stUpcoming"), active: tr("stActive"), passed: tr("stPassed"), failed: tr("stFailed"), funded: tr("stFunded") }[status];
}

/** A folded line: its title, and the text once unfolded. */
function details(parent: HTMLElement, title: string, text: string): void {
	const d = parent.createEl("details", { cls: "tradoshi-pf-details" });
	d.createEl("summary", { text: title });
	d.createDiv({ cls: "tradoshi-pf-sub", text });
}
