import { ItemView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import { CustomizeModal } from "./customize-modal";
import { FilterModal } from "./filter-modal";
import { activeFilterCount, applyFilters, periodStart, type TradeFilters } from "./filters";
import { language, t } from "./i18n";
import { loadDashData, type DashData } from "./journal-data";
import { openManualTrade } from "./manual";
import { mt } from "./manual/text";
import { LOGO_DATA_URI } from "./logo";
import { guideLink } from "./render";
import { mainCurrency } from "./stats";
import { resolveLayout } from "./widgets/registry";
import type { WidgetContext } from "./widgets/types";
import type TradoshiPlugin from "./main";

export const DASHBOARD_VIEW = "tradoshi-dashboard";

// Days back from the latest trade; -2 is the current month, -1 the current year, 0 all time.
const PERIODS: { days: number; label: () => string }[] = [
	{ days: 7, label: () => t("days7") },
	{ days: 30, label: () => t("days30") },
	{ days: 90, label: () => t("days90") },
	{ days: -2, label: () => t("monthToDate") },
	{ days: -1, label: () => t("yearToDate") },
	{ days: 0, label: () => t("allTime") },
];

export class DashboardView extends ItemView {
	private period = 30;
	private account = "all";
	private data: DashData | null = null;
	private tip: HTMLElement | null = null;
	/** State the widgets keep while the dashboard stays open. */
	private widgetState: Record<string, unknown> = {};

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TradoshiPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return DASHBOARD_VIEW;
	}

	getDisplayText(): string {
		return "Tradoshi";
	}

	getIcon(): string {
		return "tradoshi";
	}

	async onOpen(): Promise<void> {
		this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Reads the journal again and redraws everything. */
	refresh(): void {
		this.data = loadDashData(this.app, this.plugin.isConnected(), this.plugin.tagCategories());
		this.draw();
	}

	private get filters(): TradeFilters {
		return this.plugin.settings.filters;
	}

	private async setFilters(f: TradeFilters): Promise<void> {
		this.plugin.settings.filters = f;
		await this.plugin.saveSettings();
		this.draw();
	}

	// ── Drawing ──────────────────────────────────────────────────────────────

	private draw(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("tradoshi-dash");
		if (!this.data) return;
		const data = this.data;
		// Filters of a sample journal would be the trader's real ones: they do not apply to it.
		const filters = data.sample ? { ...this.filters, symbols: [], setups: [], tags: [], excludeTags: [] } : this.filters;
		const all = applyFilters(
			data.trades.filter((x) => this.account === "all" || x.account === this.account),
			filters,
		).sort((a, b) => a.at - b.at);
		const latest = all.reduce((m, x) => Math.max(m, x.at), 0);
		const now = data.sample ? Date.now() : Math.max(Date.now(), latest);
		const start = periodStart(this.period, now);
		const trades = start === null ? all : all.filter((x) => x.at > start);
		// Money figures use the currency most trades of the period are in.
		const currency = mainCurrency(trades.length ? trades : all.length ? all : data.trades);

		this.drawHeader(root);
		if (data.sample) this.drawSample(root);
		else if (!data.trades.length) {
			this.drawEmpty(root);
			return;
		}
		this.drawActiveFilters(root);

		const ctx: WidgetContext = {
			app: this.app,
			plugin: this.plugin,
			data,
			all,
			trades,
			currency,
			now,
			period: this.period,
			state: this.widgetState,
			redraw: () => this.draw(),
			tip: (e, lines) => this.showTip(e, lines),
			hideTip: () => this.hideTip(),
			openPath: (path) => this.openPath(path),
			openDay: (day) => this.openDay(day),
		};
		const grid = root.createDiv({ cls: "tradoshi-grid12" });
		for (const { widget, on } of resolveLayout(this.plugin.settings.layout)) {
			if (!on) continue;
			const card = grid.createDiv({ cls: `tradoshi-card tradoshi-w-${widget.size}`, attr: { "data-widget": widget.id } });
			try {
				widget.render(card, ctx);
			} catch (e) {
				// One widget that fails never takes the dashboard down with it.
				console.error(`Tradoshi widget ${widget.id}`, e);
				card.empty();
				card.createEl("p", { cls: "tradoshi-empty", text: `${widget.title()} : ${t("widgetError")}` });
			}
		}
		this.tip = root.createDiv({ cls: "tradoshi-tip" });
	}

	private drawHeader(root: HTMLElement): void {
		const head = root.createDiv({ cls: "tradoshi-head" });
		const brand = head.createDiv({ cls: "tradoshi-brand" });
		brand.createEl("img", { attr: { src: LOGO_DATA_URI, alt: "" }, cls: "tradoshi-logo" });
		const title = brand.createDiv();
		// The wordmark of the brand: "trad" then "oshi" in Tradoshi blue.
		const wordmark = title.createDiv({ cls: "tradoshi-wordmark", attr: { "aria-label": "Tradoshi" } });
		wordmark.appendText("trad");
		wordmark.createSpan({ cls: "tradoshi-oshi", text: "oshi" });
		title.createDiv({ cls: "tradoshi-sub", text: t("journal") });

		const controls = head.createDiv({ cls: "tradoshi-controls" });
		const periods = controls.createDiv({ cls: "tradoshi-periods" });
		for (const p of PERIODS) {
			const b = periods.createEl("button", { cls: "tradoshi-chip", text: p.label() });
			if (p.days === this.period) b.addClass("is-active");
			b.setAttr("aria-pressed", String(p.days === this.period));
			b.addEventListener("click", () => {
				this.period = p.days;
				this.draw();
			});
		}
		const select = controls.createEl("select", { cls: "dropdown tradoshi-select", attr: { "aria-label": t("account") } });
		select.createEl("option", { value: "all", text: t("allAccounts") });
		for (const a of this.data?.accounts ?? []) select.createEl("option", { value: a, text: a });
		select.value = this.account;
		select.addEventListener("change", () => {
			this.account = select.value;
			delete this.widgetState.calendar;
			this.draw();
		});
		const n = activeFilterCount(this.filters);
		const filterButton = controls.createEl("button", { cls: n ? "tradoshi-has-filters" : "", text: n ? t("filtersN", { n }) : t("filters") });
		filterButton.addEventListener("click", () => {
			if (!this.data) return;
			new FilterModal(this.app, this.data, this.filters, (f) => void this.setFilters(f)).open();
		});
		controls.createEl("button", { text: t("customize") }).addEventListener("click", () => {
			new CustomizeModal(this.app, this.plugin, () => this.draw()).open();
		});
		if (!this.data?.sample) {
			controls.createEl("button", { text: `+ ${mt("titleAdd")}` }).addEventListener("click", () => openManualTrade(this.plugin));
			controls.createEl("button", { text: t("importStatement") }).addEventListener("click", () => this.plugin.openImport());
			const sync = controls.createEl("button", { cls: "mod-cta tradoshi-sync", text: t("sync") });
			sync.addEventListener("click", () => {
				sync.setText(t("syncing"));
				sync.disabled = true;
				void this.plugin.sync(true).then(() => this.refresh());
			});
		}
	}

	/** One chip per active filter; a click removes it. */
	private drawActiveFilters(root: HTMLElement): void {
		const f = this.filters;
		if (!activeFilterCount(f)) return;
		const bar = root.createDiv({ cls: "tradoshi-active-filters" });
		const chip = (label: string, without: Partial<TradeFilters>): void => {
			const c = bar.createEl("button", { cls: "tradoshi-chip is-active", text: `${label} ×`, attr: { "aria-label": `${t("removeFilter")} ${label}` } });
			c.addEventListener("click", () => void this.setFilters({ ...f, ...without }));
		};
		for (const s of f.symbols) chip(s, { symbols: f.symbols.filter((x) => x !== s) });
		for (const s of f.setups) chip(s, { setups: f.setups.filter((x) => x !== s) });
		for (const s of f.tags) chip(`#${s}`, { tags: f.tags.filter((x) => x !== s) });
		for (const s of f.excludeTags) chip(`${t("without")} #${s}`, { excludeTags: f.excludeTags.filter((x) => x !== s) });
		if (f.side !== "all") chip(t(f.side), { side: "all" });
		if (f.outcome !== "all") chip(f.outcome === "win" ? t("fWins") : t("fLosses"), { outcome: "all" });
		bar.createEl("button", { cls: "tradoshi-link-button", text: t("clearFilters") }).addEventListener("click", () => {
			void this.setFilters({ ...f, symbols: [], setups: [], tags: [], excludeTags: [], side: "all", outcome: "all" });
		});
	}

	private drawSample(root: HTMLElement): void {
		const box = root.createDiv({ cls: "tradoshi-sample" });
		const left = box.createDiv({ cls: "tradoshi-sample-text" });
		left.createEl("strong", { text: t("sampleTitle") });
		left.createEl("p", { text: t("sampleText") });
		const buttons = left.createDiv({ cls: "tradoshi-sample-buttons" });
		buttons.createEl("button", { cls: "mod-cta", text: t("connect") }).addEventListener("click", () => window.open(this.plugin.signupLink("dashboard_sample")));
		buttons.createEl("button", { text: t("importStatement") }).addEventListener("click", () => this.plugin.openImport());

		const flow = box.createDiv({ cls: "tradoshi-flow" });
		flow.createDiv({ cls: "tradoshi-flow-title", text: t("dataTitle") });
		const path = (title: string, text: string, steps: string[]): void => {
			const p = flow.createDiv({ cls: "tradoshi-path" });
			const head = p.createDiv({ cls: "tradoshi-path-head" });
			head.createEl("strong", { text: title });
			const chain = head.createDiv({ cls: "tradoshi-path-steps" });
			steps.forEach((step, i) => {
				if (i) chain.createSpan({ cls: "tradoshi-flow-arrow", text: "→" });
				chain.createSpan({ cls: "tradoshi-path-step", text: step });
			});
			p.createDiv({ cls: "tradoshi-path-text", text });
		};
		path(t("pathSync"), t("pathSyncText"), [t("dataBroker"), t("dataServer"), t("dataVault")]);
		path(t("pathFile"), t("pathFileText"), [t("importStatement"), t("dataVault")]);
		flow.createDiv({ cls: "tradoshi-path-notes", text: t("pathNotes") });
		flow.createEl("a", { cls: "tradoshi-guide-link", text: t("howItWorks"), href: guideLink(language(), "dashboard_sample") });
	}

	/** Connected, but no trade yet: says what to do instead of showing empty cards. */
	private drawEmpty(root: HTMLElement): void {
		const box = root.createDiv({ cls: "tradoshi-sample" });
		const left = box.createDiv({ cls: "tradoshi-sample-text" });
		left.createEl("strong", { text: t("emptyTitle") });
		left.createEl("p", { text: t("emptyText") });
		const buttons = left.createDiv({ cls: "tradoshi-sample-buttons" });
		buttons.createEl("button", { cls: "mod-cta", text: t("connectBroker") }).addEventListener("click", () => window.open(this.plugin.brokerLink("dashboard_empty")));
		buttons.createEl("button", { text: t("importStatement") }).addEventListener("click", () => this.plugin.openImport());
		left.createEl("a", { cls: "tradoshi-guide-link", text: t("howItWorks"), href: guideLink(language(), "dashboard_empty") });
	}

	private showTip(e: MouseEvent, lines: string[]): void {
		if (!this.tip) return;
		this.tip.empty();
		for (const l of lines) this.tip.createDiv({ text: l });
		const box = this.contentEl.getBoundingClientRect();
		this.tip.setCssProps({ "--x": `${e.clientX - box.left + this.contentEl.scrollLeft + 14}px`, "--y": `${e.clientY - box.top + this.contentEl.scrollTop + 14}px` });
		this.tip.addClass("is-visible");
	}

	private hideTip(): void {
		this.tip?.removeClass("is-visible");
	}

	private async openPath(path: string | null): Promise<void> {
		const file = path ? this.app.vault.getFileByPath(path) : null;
		if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
	}

	private async openDay(day: string): Promise<void> {
		if (this.data?.sample) {
			new Notice(`${day} · ${t("sampleTitle")}`);
			return;
		}
		await this.openPath(this.plugin.pathForKey(`day:${day}`));
	}
}
