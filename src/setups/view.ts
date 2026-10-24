import { Component, ItemView, MarkdownRenderer, Notice, TFile, debounce, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { sparkline } from "../accounts/view";
import { periodStart } from "../filters";
import { amount, colon, compact, money, num, pctSign, sign } from "../format";
import { locale, t, tradesLabel } from "../i18n";
import { loadDashData, type DashData } from "../journal-data";
import type TradoshiPlugin from "../main";
import { byWeekday, mainCurrency, type DashTrade } from "../stats";
import { byHour, topGroups, type Summary } from "../stats-advanced";
import { MediaModal, mediaOf, type Media } from "../tradecard/card";
import { logTrades, type LogTrade } from "../tradelog/data";
import { chips } from "../widgets/analytics-charts";
import { dateShort, dateTime } from "../widgets/analytics-util";
import { columns, groupBars, lineChart, tiles } from "../widgets/charts";
import { cardTitle, emptyCard } from "../widgets/types";
import { applyHue, hueDot, overlayChart, type Tipper } from "./chart";
import {
	bestIndex,
	crossBy,
	cumulative,
	EDGE_MIN_TRADES,
	edgeConfidence,
	executionGap,
	extremes,
	healthOf,
	huesByKey,
	indexMetas,
	kindGap,
	norm,
	overlayByCount,
	overlayByTime,
	paletteIndex,
	parseRules,
	playbookMarkdown,
	playbookSize,
	recentCount,
	resetRules,
	setRule,
	setupPairs,
	setupRows,
	setupsOfTrade,
	setupStats,
	SORTS,
	sortRows,
	type HealthIssue,
	type Hue,
	type Rule,
	type SetupMeta,
	type SetupRow,
	type SetupSort,
	type Side,
	type Unit,
} from "./logic";
import { ComparePicker, EditSetupModal, NewSetupModal } from "./modals";
import { createSheet, readSheets, type Sheet } from "./sheets";
import { edgeLabel, healthLabel, sortLabel, st, statusLabel } from "./text";

// The Setups view: a card per setup with its figures and curve, the detail of a setup
// (curve, figures, execution gap, when and where it works, best and worst trades, rules,
// playbook, screenshots, notes and trades), and two to four setups side by side. Read
// from the notes of the vault, redrawn when they change. With the sample journal it
// shows the sample setups and writes nothing.

export const SETUPS_VIEW = "tradoshi-setups";
const MODULE_ID = "setups";

interface Prefs {
	period: number;
	account: string;
	side: "all" | "long" | "short";
	sort: SetupSort;
	unit: Unit;
	overlay: "time" | "count";
}

const PREFS: Prefs = { period: 0, account: "all", side: "all", sort: "net", unit: "money", overlay: "time" };

export type Screen = { kind: "list" } | { kind: "detail"; key: string } | { kind: "compare"; keys: string[] };

// Days back from the latest trade; -2 is the current month, -1 the current year, 0 all time.
const PERIODS: { days: number; label: () => string }[] = [
	{ days: 0, label: () => t("allTime") },
	{ days: -1, label: () => t("yearToDate") },
	{ days: 90, label: () => t("days90") },
	{ days: 30, label: () => t("days30") },
	{ days: -2, label: () => t("monthToDate") },
	{ days: 7, label: () => t("days7") },
];

interface Model {
	sample: boolean;
	now: number;
	/** Start of the period, null for all time. */
	start: number | null;
	/** Account shown, "all" for every account. */
	account: string;
	currency: string;
	/** Trades of the period, account and side, in the currency. */
	trades: DashTrade[];
	/** Trades of the period left out because they are in another currency. */
	other: number;
	rows: SetupRow[];
	/** Every setup over all its history, in the currency: last trade, still traded. */
	history: Map<string, SetupRow>;
	sheets: Map<string, Sheet>;
	index: Map<string, SetupMeta>;
	categories: Record<string, string>;
	/** The colour of each setup, the same on every screen. */
	hues: Map<string, Hue>;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (v: number | null): string => (v === null ? "–" : `${num(v, 1)}${pctSign()}`);
const rText = (v: number | null): string => (v === null ? "–" : `${v > 0 ? "+" : ""}${num(v)} R`);
const shortDate = (ms: number): string => dateShort(ms);
const weekdayName = (d: number): string => new Date(2024, 0, 1 + d).toLocaleDateString(locale(), { weekday: "short" });
const statusOfRow = (r: SetupRow): SetupMeta["status"] => r.meta?.status ?? "active";
const hueOf = (m: Model, r: { key: string; name: string; meta: SetupMeta | null }): Hue => m.hues.get(r.key) ?? { color: r.meta?.color ?? null, index: paletteIndex(r.name) };
const perTrade = (): string => t("perTrade").split(" ").pop() ?? "";

function profitFactor(s: Summary): string {
	if (s.profitFactor !== null) return num(s.profitFactor);
	return s.wins && !s.losses ? "∞" : "–";
}

export class SetupsView extends ItemView {
	private screen: Screen = { kind: "list" };
	private prefs: Prefs;
	private data: DashData | null = null;
	private sheetList: Sheet[] = [];
	/** Missed and backtest trades, kept out of the figures, for the execution gap. */
	private others: LogTrade[] = [];
	private generation = 0;
	private shownTrades = 50;
	private showPaused = false;
	private tipEl: HTMLElement | null = null;
	/** Owner of what is rendered with Obsidian in one drawing (the playbook), released at the next. */
	private drawing: Component | null = null;
	private readonly tipper: Tipper = {
		tip: (e, lines) => this.showTip(e, lines),
		hideTip: () => this.tipEl?.removeClass("is-visible"),
	};

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TradoshiPlugin,
	) {
		super(leaf);
		this.prefs = { ...PREFS, ...plugin.moduleData<Partial<Prefs>>(MODULE_ID, {}) };
		if (!SORTS.includes(this.prefs.sort)) this.prefs.sort = "net";
	}

	getViewType(): string {
		return SETUPS_VIEW;
	}

	getDisplayText(): string {
		return st("title");
	}

	getIcon(): string {
		return "layers";
	}

	async onOpen(): Promise<void> {
		// Notes written by a sync arrive in bursts: one redraw once they settle.
		const later = debounce(() => void this.refresh(), 1200, true);
		const relevant = (fm: Record<string, unknown> | undefined): boolean => typeof fm?.tradoshi_id === "string" || fm?.tradoshi_setup === true || fm?.tradoshi_setup === "true";
		this.registerEvent(
			this.app.metadataCache.on("changed", (_file, _data, cache) => {
				if (relevant(cache.frontmatter)) later();
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on("deleted", (_file, prev) => {
				if (relevant(prev?.frontmatter)) later();
			}),
		);
		this.registerEvent(this.app.vault.on("rename", () => later()));
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	getState(): Record<string, unknown> {
		return { screen: this.screen };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state as { screen?: Screen } | null)?.screen;
		if (s && (s.kind === "list" || (s.kind === "detail" && typeof s.key === "string") || (s.kind === "compare" && Array.isArray(s.keys)))) this.screen = s;
		await super.setState(state, result);
		this.draw();
	}

	/** Shows the list, a setup or a comparison. */
	show(screen: Screen): void {
		this.screen = screen;
		this.shownTrades = 50;
		this.draw();
		this.contentEl.scrollTop = 0;
		this.app.workspace.requestSaveLayout();
	}

	async refresh(): Promise<void> {
		const generation = ++this.generation;
		const data = loadDashData(this.app, this.plugin.isConnected(), this.plugin.tagCategories());
		const sheets = await readSheets(this.app, data.sample);
		if (generation !== this.generation) return;
		this.data = data;
		this.sheetList = sheets;
		this.others = data.sample ? [] : logTrades(this.app).filter((x) => x.kind !== "executed");
		const top = this.contentEl.scrollTop;
		this.draw();
		this.contentEl.scrollTop = top;
	}

	private setPrefs(patch: Partial<Prefs>): void {
		this.prefs = { ...this.prefs, ...patch };
		void this.plugin.saveModuleData(MODULE_ID, this.prefs);
		this.draw();
	}

	// ── The figures ─────────────────────────────────────────────────────────

	private model(): Model | null {
		const data = this.data;
		if (!data) return null;
		const p = this.prefs;
		const metas = this.sheetList.map((s) => s.meta);
		const account = data.accounts.includes(p.account) ? p.account : "all";
		const scoped = data.trades.filter((x) => (account === "all" || x.account === account) && (p.side === "all" || x.side === p.side));
		const latest = scoped.reduce((m, x) => Math.max(m, x.at), 0);
		const now = data.sample ? Date.now() : Math.max(Date.now(), latest);
		const start = periodStart(p.period, now);
		const inPeriod = start === null ? scoped : scoped.filter((x) => x.at > start);
		const currency = mainCurrency(inPeriod.length ? inPeriod : scoped.length ? scoped : data.trades);
		const trades = inPeriod.filter((x) => x.currency === currency);
		const sheets = new Map<string, Sheet>();
		for (const s of this.sheetList) if (!sheets.has(norm(s.meta.name))) sheets.set(norm(s.meta.name), s);
		const rows = setupRows(trades, data.categories, metas);
		const history = setupRows(
			data.trades.filter((x) => x.currency === currency),
			data.categories,
			metas,
		);
		return {
			sample: data.sample,
			now,
			start,
			account,
			currency,
			trades,
			other: inPeriod.length - trades.length,
			rows,
			history: new Map(history.map((r) => [r.key, r])),
			sheets,
			index: indexMetas(metas),
			categories: data.categories,
			hues: huesByKey([...history, ...rows]),
		};
	}

	/** The row of a setup, or an empty one when it has no trade in the period. */
	private rowOf(m: Model, key: string): SetupRow | null {
		const row = m.rows.find((r) => r.key === key);
		if (row) return row;
		const known = m.history.get(key) ?? null;
		const sheet = m.sheets.get(key) ?? null;
		if (!known && !sheet) return null;
		return { key, name: known?.name ?? sheet?.meta.name ?? key, meta: known?.meta ?? sheet?.meta ?? null, trades: [], stats: setupStats([]) };
	}

	private playbookNote(meta: SetupMeta | null): TFile | null {
		return meta?.playbook ? this.app.metadataCache.getFirstLinkpathDest(meta.playbook, meta.path ?? "") : null;
	}

	private health(m: Model, row: SetupRow): HealthIssue[] {
		const sheet = m.sheets.get(row.key) ?? null;
		return healthOf({
			sheet: !!sheet,
			description: sheet?.meta.description ?? "",
			playbook: sheet ? (this.playbookNote(sheet.meta) ? 100 : playbookSize(sheet.content)) : 0,
			rules: sheet ? parseRules(sheet.content).length : 0,
			examples: sheet?.file ? mediaOf(this.app, sheet.file).length : 0,
			trades: row.stats.trades,
			status: statusOfRow(row),
			recent: recentCount(m.history.get(row.key)?.trades ?? [], m.now),
		});
	}

	/** Missed and backtest trades of a setup, with the same filters as the figures. */
	private othersOf(m: Model, key: string): LogTrade[] {
		const p = this.prefs;
		return this.others.filter(
			(x) =>
				(m.account === "all" || x.account === m.account) &&
				(p.side === "all" || x.side === p.side) &&
				(m.start === null || x.at > m.start) &&
				x.currency === m.currency &&
				setupsOfTrade(x.tags, m.categories, m.index).some((s) => s.key === key),
		);
	}

	private fmt(v: number | null, m: Model, unit: Unit = this.prefs.unit): string {
		if (v === null) return "–";
		return unit === "r" ? rText(v) : money(v, m.currency);
	}

	// ── Drawing ─────────────────────────────────────────────────────────────

	private draw(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("tradoshi-dash", "tradoshi-su");
		if (this.drawing) this.removeChild(this.drawing);
		this.drawing = this.addChild(new Component());
		const m = this.model();
		if (!m) return;
		const s = this.screen;
		const row = s.kind === "detail" ? this.rowOf(m, s.key) : null;
		if (row) this.drawDetail(root, m, row);
		else if (s.kind === "compare") this.drawCompare(root, m, s.keys);
		else this.drawList(root, m);
		this.tipEl = root.createDiv({ cls: "tradoshi-tip" });
	}

	private showTip(e: MouseEvent, lines: string[]): void {
		if (!this.tipEl) return;
		this.tipEl.empty();
		for (const l of lines) this.tipEl.createDiv({ text: l });
		const box = this.contentEl.getBoundingClientRect();
		this.tipEl.setCssProps({ "--x": `${e.clientX - box.left + this.contentEl.scrollLeft + 14}px`, "--y": `${e.clientY - box.top + this.contentEl.scrollTop + 14}px` });
		this.tipEl.addClass("is-visible");
	}

	/** Period, account, side and unit, shared by the three screens; the sort on the list. */
	private drawControls(root: HTMLElement, m: Model, withSort: boolean): void {
		const bar = root.createDiv({ cls: "tradoshi-su-controls" });
		const periods = bar.createDiv({ cls: "tradoshi-periods" });
		for (const p of PERIODS) {
			const b = periods.createEl("button", { cls: "tradoshi-chip", text: p.label() });
			if (p.days === this.prefs.period) b.addClass("is-active");
			b.setAttr("aria-pressed", String(p.days === this.prefs.period));
			b.addEventListener("click", () => this.setPrefs({ period: p.days }));
		}
		const line = bar.createDiv({ cls: "tradoshi-su-controls-line" });
		const accounts = this.data?.accounts ?? [];
		if (accounts.length > 1) {
			const select = line.createEl("select", { cls: "dropdown tradoshi-select", attr: { "aria-label": t("account") } });
			select.createEl("option", { value: "all", text: t("allAccounts") });
			for (const a of accounts) select.createEl("option", { value: a, text: a });
			select.value = accounts.includes(this.prefs.account) ? this.prefs.account : "all";
			select.addEventListener("change", () => this.setPrefs({ account: select.value }));
		}
		chips(
			line,
			[
				{ value: "all", label: st("bothSides") },
				{ value: "long", label: cap(t("long")) },
				{ value: "short", label: cap(t("short")) },
			],
			this.prefs.side,
			(v) => this.setPrefs({ side: v }),
			t("side"),
		);
		chips(
			line,
			[
				{ value: "money", label: m.currency },
				{ value: "r", label: "R" },
			],
			this.prefs.unit,
			(v) => this.setPrefs({ unit: v }),
			st("unit"),
		);
		if (withSort) {
			const sort = line.createEl("select", { cls: "dropdown tradoshi-select", attr: { "aria-label": st("sortBy") } });
			for (const id of SORTS) sort.createEl("option", { value: id, text: `${st("sortBy")}${colon()}${sortLabel(id)}` });
			sort.value = this.prefs.sort;
			sort.addEventListener("change", () => this.setPrefs({ sort: sort.value as SetupSort }));
		}
	}

	private notes(root: HTMLElement, m: Model): void {
		if (m.sample) root.createEl("p", { cls: "tradoshi-note", text: st("sampleNote") });
		if (m.other) root.createEl("p", { cls: "tradoshi-note", text: t("mixedCurrency", { c: m.currency, n: m.other }) });
	}

	private statusBadge(parent: HTMLElement, row: SetupRow): void {
		if (!row.meta) {
			parent.createSpan({ cls: "tradoshi-badge tradoshi-su-status is-nosheet", text: st("noSheetBadge") });
			return;
		}
		parent.createSpan({ cls: `tradoshi-badge tradoshi-su-status is-${row.meta.status}`, text: statusLabel(row.meta.status) });
	}

	private openable(el: HTMLElement, label: string, open: () => void): void {
		el.addClass("is-clickable");
		el.setAttr("tabindex", "0");
		el.setAttr("role", "button");
		el.setAttr("aria-label", label);
		el.addEventListener("click", open);
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				open();
			}
		});
	}

	private async openFile(path: string | null): Promise<void> {
		const file = path ? this.app.vault.getFileByPath(path) : null;
		if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
	}

	private async newSheet(name: string, open: boolean): Promise<void> {
		try {
			const file = await createSheet(this.plugin, name);
			new Notice(st("sheetCreated", { name }));
			if (open) await this.app.workspace.getLeaf("tab").openFile(file);
		} catch (e) {
			console.error("Tradoshi: setup sheet", e);
			new Notice(st("sheetFailed"));
		}
	}

	private defaultCompare(m: Model, first?: string): string[] {
		const ranked = sortRows(
			m.rows.filter((r) => r.stats.trades),
			"trades",
		).map((r) => r.key);
		const keys = first ? [first, ...ranked.filter((k) => k !== first)] : ranked;
		return keys.slice(0, 2);
	}

	// ── List ────────────────────────────────────────────────────────────────

	private drawList(root: HTMLElement, m: Model): void {
		const head = root.createDiv({ cls: "tradoshi-head" });
		const title = head.createDiv();
		title.createEl("h2", { cls: "tradoshi-su-h", text: st("title") });
		title.createDiv({ cls: "tradoshi-sub", text: st("subtitle") });
		const actions = head.createDiv({ cls: "tradoshi-controls" });
		const rows = sortRows(m.rows, this.prefs.sort);
		if (rows.filter((r) => r.stats.trades).length > 1) actions.createEl("button", { text: st("compare") }).addEventListener("click", () => this.show({ kind: "compare", keys: this.defaultCompare(m) }));
		actions.createEl("button", { cls: "mod-cta", text: `+ ${st("newSetup")}` }).addEventListener("click", () => this.askNewSetup(m));
		this.drawControls(root, m, true);
		this.notes(root, m);

		if (!rows.length) {
			const box = root.createDiv({ cls: "tradoshi-card tradoshi-su-empty" });
			box.createEl("strong", { text: st("emptyTitle") });
			box.createEl("p", { text: st("emptyText") });
			box.createEl("button", { cls: "mod-cta", text: `+ ${st("newSetup")}` }).addEventListener("click", () => this.askNewSetup(m));
			return;
		}

		// Setups used on trades but without a sheet: one click writes their sheets.
		const missing = rows.filter((r) => !m.sheets.has(r.key));
		if (missing.length && !m.sample) {
			const box = root.createDiv({ cls: "tradoshi-su-banner" });
			const names = missing.map((r) => r.name).join(", ");
			box.createSpan({ text: missing.length === 1 ? st("missingSheet1", { names }) : st("missingSheets", { n: missing.length, names }) });
			const b = box.createEl("button", { text: missing.length === 1 ? st("createSheet") : st("createSheets", { n: missing.length }) });
			b.addEventListener("click", () => {
				b.disabled = true;
				void (async () => {
					for (const r of missing) await this.newSheet(r.name, false);
				})();
			});
		}

		const traded = rows.filter((r) => r.stats.trades && statusOfRow(r) !== "paused");
		if (traded.length) this.drawOverview(root, m, traded);

		const live = rows.filter((r) => statusOfRow(r) !== "paused");
		const paused = rows.filter((r) => statusOfRow(r) === "paused");
		if (live.length) {
			const grid = root.createDiv({ cls: "tradoshi-su-grid" });
			for (const r of live) this.drawCard(grid, m, r, hueOf(m, r));
		}
		if (paused.length) {
			const toggle = root.createEl("button", { cls: "tradoshi-link-button tradoshi-su-paused-toggle", text: `${this.showPaused ? "▾" : "▸"} ${st("pausedSetups", { n: paused.length })}` });
			toggle.setAttr("aria-expanded", String(this.showPaused));
			toggle.addEventListener("click", () => {
				this.showPaused = !this.showPaused;
				this.draw();
			});
			if (this.showPaused) {
				const grid = root.createDiv({ cls: "tradoshi-su-grid is-paused" });
				for (const r of paused) this.drawCard(grid, m, r, hueOf(m, r));
			}
		}
		this.drawPairs(root, m);
	}

	private askNewSetup(m: Model): void {
		const without = m.rows.filter((r) => !m.sheets.has(r.key) && !m.sample).map((r) => r.name);
		new NewSetupModal(this.app, without, (name, description) => {
			const existing = m.index.get(norm(name));
			if (existing?.path) {
				new Notice(st("sheetExists", { name: existing.name }));
				void this.openFile(existing.path);
				return;
			}
			void (async () => {
				try {
					const file = await createSheet(this.plugin, name, description);
					new Notice(st("sheetCreated", { name }));
					await this.app.workspace.getLeaf("tab").openFile(file);
				} catch (e) {
					console.error("Tradoshi: setup sheet", e);
					new Notice(st("sheetFailed"));
				}
			})();
		}).open();
	}

	/** Cumulative result of the setups traded in the period, the six that weigh most. */
	private drawOverview(root: HTMLElement, m: Model, rows: SetupRow[]): void {
		const unit = this.prefs.unit;
		const shown = [...rows].sort((a, b) => Math.abs(b.stats.net) - Math.abs(a.stats.net)).slice(0, 6);
		const lists = shown.map((r) => r.trades);
		const { xs, values } = overlayByTime(lists, unit);
		const card = root.createDiv({ cls: "tradoshi-card tradoshi-su-overview" });
		cardTitle(card, st("overviewTitle"), rows.length > shown.length ? st("overviewTop", { n: shown.length, total: rows.length }) : undefined);
		if (xs.length < 2) {
			emptyCard(card, unit === "r" ? st("noR") : t("noTrade"));
			return;
		}
		overlayChart(
			card,
			this.tipper,
			xs,
			shown.map((r, k) => ({ name: r.name, hue: hueOf(m, r), values: values[k] })),
			{
				label: st("overviewTitle"),
				time: true,
				ratio: 0.32,
				axis: (v) => (unit === "r" ? `${num(v, 1)} R` : compact(v, m.currency)),
				firstLast: [shortDate(xs[0]), shortDate(xs[xs.length - 1])],
				tip: (i) => [dateTime(xs[i]), ...shown.map((r, k) => `${r.name}${colon()}${this.fmt(values[k][i], m, unit)}`)],
				open: (k) => this.show({ kind: "detail", key: shown[k].key }),
			},
		);
	}

	private drawCard(grid: HTMLElement, m: Model, row: SetupRow, hue: Hue): void {
		const s = row.stats;
		const unit = this.prefs.unit;
		const card = grid.createDiv({ cls: "tradoshi-card tradoshi-su-card" });
		applyHue(card, hue);
		this.openable(card, row.name, () => this.show({ kind: "detail", key: row.key }));
		const top = card.createDiv({ cls: "tradoshi-su-card-top" });
		const name = top.createDiv({ cls: "tradoshi-su-name" });
		hueDot(name, hue);
		name.createSpan({ cls: "tradoshi-strong", text: row.name });
		this.statusBadge(top, row);
		if (row.meta?.description) card.createDiv({ cls: "tradoshi-su-desc", text: row.meta.description });
		const value = card.createDiv({ cls: "tradoshi-su-value" });
		if (!s.trades) value.createSpan({ cls: "tradoshi-muted", text: st("noTradePeriod") });
		else if (unit === "r") value.createSpan({ cls: `tradoshi-strong ${sign(s.totalR)}`, text: s.rCount ? rText(s.totalR) : "–" });
		else value.createSpan({ cls: `tradoshi-strong ${sign(s.net)}`, text: money(s.net, m.currency) });
		const curve = unit === "r" ? cumulative(row.trades, "r").map((p) => p.value) : s.curve;
		if (curve.length > 1) sparkline(card, [0, ...curve], row.name);
		else card.createDiv({ cls: "tradoshi-su-spark-empty" });
		const facts = card.createDiv({ cls: "tradoshi-su-facts" });
		const fact = (label: string, text: string, cls = ""): void => {
			const d = facts.createDiv();
			d.createDiv({ cls: "tradoshi-muted tradoshi-su-fact-label", text: label });
			d.createDiv({ cls, text });
		};
		fact(t("trades"), String(s.trades));
		fact(t("winRate"), pct(s.winRate));
		fact(t("expectancy"), unit === "r" ? rText(s.avgR) : s.expectancy === null ? "–" : money(s.expectancy, m.currency), sign(unit === "r" ? (s.avgR ?? 0) : (s.expectancy ?? 0)));
		fact(t("profitFactor"), profitFactor(s));
		fact(t("avgR"), rText(s.avgR), sign(s.avgR ?? 0));
		const last = m.history.get(row.key)?.stats.last ?? null;
		fact(st("lastTrade"), last ? shortDate(last) : "–");
		const issues = this.health(m, row).filter((x) => x !== "fewTrades" || s.trades > 0);
		if (issues.length) {
			const box = card.createDiv({ cls: "tradoshi-su-issues" });
			for (const x of issues.slice(0, 2)) box.createSpan({ cls: "tradoshi-su-issue", text: healthLabel(x) });
			if (issues.length > 2) box.createSpan({ cls: "tradoshi-su-issue", text: `+${issues.length - 2}` });
			box.addEventListener("mousemove", (e) => this.tipper.tip(e, [st("toComplete"), ...issues.map((x) => `· ${healthLabel(x)}`)]));
			box.addEventListener("mouseleave", () => this.tipper.hideTip());
		}
	}

	/** Two setups on the same trades, against each of them alone. */
	private drawPairs(root: HTMLElement, m: Model): void {
		const pairs = setupPairs(m.trades, (x) => setupsOfTrade(x.tags, m.categories, m.index).map((s) => s.name));
		if (!pairs.length) return;
		const card = root.createDiv({ cls: "tradoshi-card tradoshi-su-pairs" });
		cardTitle(card, st("pairsTitle"), st("pairsHint"));
		const wrap = card.createDiv({ cls: "tradoshi-su-scroll" });
		const table = wrap.createEl("table", { cls: "tradoshi-table" });
		const head = table.createEl("tr");
		for (const h of [st("pair"), t("trades"), st("together"), st("alone"), st("pairEdge")]) head.createEl("th", { text: h });
		for (const p of pairs.slice(0, 12)) {
			const tr = table.createEl("tr");
			tr.createEl("td", { cls: "tradoshi-strong", text: `${p.a} + ${p.b}` });
			tr.createEl("td", { cls: "tradoshi-num", text: String(p.together.trades) });
			tr.createEl("td", { cls: `tradoshi-num ${sign(p.together.expectancy ?? 0)}`, text: `${this.fmt(p.together.expectancy, m, "money")}/${perTrade()}` });
			tr.createEl("td", { cls: "tradoshi-num tradoshi-muted", text: `${p.a} ${this.fmt(p.aSolo.expectancy, m, "money")} · ${p.b} ${this.fmt(p.bSolo.expectancy, m, "money")}` });
			tr.createEl("td", { cls: `tradoshi-num tradoshi-strong ${sign(p.edge ?? 0)}`, text: this.fmt(p.edge, m, "money") });
		}
	}

	// ── One setup ───────────────────────────────────────────────────────────

	private drawDetail(root: HTMLElement, m: Model, row: SetupRow): void {
		const sheet = m.sheets.get(row.key) ?? null;
		const meta = row.meta ?? sheet?.meta ?? null;
		const hue = hueOf(m, { key: row.key, name: row.name, meta });
		const s = row.stats;
		const unit = this.prefs.unit;
		const c = m.currency;

		const head = root.createDiv({ cls: "tradoshi-head" });
		head.createEl("button", { text: `‹ ${st("back")}` }).addEventListener("click", () => this.show({ kind: "list" }));
		const title = head.createDiv({ cls: "tradoshi-su-title" });
		const line = title.createDiv({ cls: "tradoshi-su-name" });
		hueDot(line, hue);
		line.createEl("h2", { cls: "tradoshi-su-h", text: row.name });
		this.statusBadge(line, { ...row, meta });
		if (meta?.description) title.createDiv({ cls: "tradoshi-muted", text: meta.description });
		const context = title.createDiv({ cls: "tradoshi-su-context" });
		const ctxChip = (label: string, value: string): void => {
			if (!value) return;
			const chip = context.createSpan({ cls: "tradoshi-su-ctx" });
			chip.createSpan({ cls: "tradoshi-muted", text: `${label} ` });
			chip.createSpan({ text: value });
		};
		ctxChip(st("markets"), meta?.markets.join(", ") ?? "");
		ctxChip(st("sessions"), meta?.sessions.join(", ") ?? "");
		ctxChip(st("timeframe"), meta?.timeframe ?? "");
		const actions = head.createDiv({ cls: "tradoshi-controls" });
		if (sheet?.file) {
			const file = sheet.file;
			actions.createEl("button", { text: st("openSheet") }).addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(file));
			actions.createEl("button", { text: st("edit") }).addEventListener("click", () => new EditSetupModal(this.app, file, sheet.meta).open());
		} else if (!m.sample) {
			actions.createEl("button", { cls: "mod-cta", text: st("createSheet") }).addEventListener("click", () => void this.newSheet(row.name, true));
		}
		if (m.rows.filter((r) => r.stats.trades).length > 1) actions.createEl("button", { text: st("compare") }).addEventListener("click", () => this.show({ kind: "compare", keys: this.defaultCompare(m, row.key) }));

		this.drawControls(root, m, false);
		this.notes(root, m);
		const issues = this.health(m, row);
		if (issues.length) {
			const box = root.createDiv({ cls: "tradoshi-su-health" });
			box.createSpan({ cls: "tradoshi-strong", text: `${st("toComplete")} ` });
			for (const x of issues) box.createSpan({ cls: "tradoshi-su-issue", text: healthLabel(x) });
		}

		const grid = root.createDiv({ cls: "tradoshi-grid12" });
		const values = row.trades.map((x) => (unit === "r" ? x.r : x.pnl)).filter((v): v is number => v !== null && Number.isFinite(v));
		const edge = edgeConfidence(values);
		const kpis = grid.createDiv({ cls: "tradoshi-card tradoshi-w-full is-bare" });
		tiles(kpis, [
			unit === "r"
				? { label: st("totalR"), value: s.rCount ? rText(s.totalR) : "–", tone: sign(s.totalR), sub: s.trades ? money(s.net, c) : " " }
				: { label: t("net"), value: s.trades ? money(s.net, c) : "–", tone: sign(s.net), sub: s.rCount ? rText(s.totalR) : " " },
			{ label: t("trades"), value: String(s.trades), sub: s.first && s.last ? `${shortDate(s.first)} → ${shortDate(s.last)}` : " " },
			{ label: t("winRate"), value: pct(s.winRate), sub: s.trades ? st("winsLosses", { w: s.wins, l: s.losses }) : " " },
			unit === "r"
				? { label: t("expectancy"), value: rText(s.avgR), tone: sign(s.avgR ?? 0), sub: s.expectancy === null ? " " : `${money(s.expectancy, c)} ${t("perTrade")}` }
				: { label: t("expectancy"), value: s.expectancy === null ? "–" : money(s.expectancy, c), tone: sign(s.expectancy ?? 0), sub: t("perTrade") },
			{ label: t("profitFactor"), value: profitFactor(s), sub: t("winsOverLosses") },
			{ label: st("payoff"), value: s.payoff === null ? "–" : num(s.payoff), sub: s.avgWin !== null && s.avgLoss !== null ? `${money(s.avgWin, c)} / ${money(s.avgLoss, c)}` : " " },
			{ label: t("maxDrawdown"), value: s.maxDrawdown ? money(-s.maxDrawdown, c) : "–", tone: s.maxDrawdown ? "neg" : "", sub: t("fromPeak") },
			{
				label: st("edge"),
				value: edgeLabel(edge.level, edge.positive),
				tone: edge.level === "solid" || edge.level === "emerging" ? (edge.positive ? "pos" : "neg") : "",
				sub: edge.level === "early" ? st("edgeEarly", { n: EDGE_MIN_TRADES }) : edge.t === null ? " " : st("edgeT", { t: num(edge.t, 1) }),
			},
		]);

		this.drawCurve(grid, m, row);
		this.drawGap(grid, m, row);
		this.drawBreakdowns(grid, m, row);
		this.drawExtremes(grid, m, row);
		this.drawRules(grid, m, row, sheet);
		this.drawPlaybook(grid, meta, sheet);
		this.drawMedia(grid, row);
		this.drawLinked(grid, m, sheet);
		this.drawTrades(grid, m, row);
	}

	private drawCurve(grid: HTMLElement, m: Model, row: SetupRow): void {
		const unit = this.prefs.unit;
		const card = grid.createDiv({ cls: "tradoshi-card tradoshi-w-wide" });
		const pts = cumulative(row.trades, unit);
		cardTitle(card, st("curve"), pts.length ? tradesLabel(pts.length) : undefined);
		if (!pts.length) return emptyCard(card, unit === "r" && row.trades.length ? st("noR") : st("noTradePeriod"));
		lineChart(
			card,
			this.tipper,
			pts.map((p) => ({
				at: p.at,
				value: p.value,
				tip: [dateTime(p.at), `${p.trade.symbol} ${t(p.trade.side)}${colon()}${unit === "r" ? rText(p.trade.r) : money(p.trade.pnl, m.currency, 2)}`, `Σ ${this.fmt(p.value, m)}`],
			})),
			{
				label: `${st("curve")} ${row.name}`,
				currency: m.currency,
				height: 320,
				tone: pts[pts.length - 1].value < 0 ? "loss" : "accent",
				formatAxis: unit === "r" ? (v) => `${num(v, 1)} R` : undefined,
				firstLast: (ms) => shortDate(ms),
			},
		);
	}

	/** What bad execution costs on this setup: off the plan, with a mistake, missed. */
	private drawGap(grid: HTMLElement, m: Model, row: SetupRow): void {
		const c = m.currency;
		const card = grid.createDiv({ cls: "tradoshi-card tradoshi-w-narrow tradoshi-su-gap" });
		cardTitle(card, st("gapTitle"));
		if (!row.trades.length) return emptyCard(card, st("noTradePeriod"));
		const gap = executionGap(row.trades, m.categories);
		const table = card.createDiv({ cls: "tradoshi-su-scroll" }).createEl("table", { cls: "tradoshi-table tradoshi-su-gap-table" });
		const head = table.createEl("tr");
		for (const h of ["", t("trades"), t("winRate"), t("expectancy"), t("net")]) head.createEl("th", { cls: h ? "tradoshi-num" : "", text: h });
		const line = (label: string, x: Side): void => {
			const tr = table.createEl("tr");
			tr.createEl("td", { text: label });
			tr.createEl("td", { cls: "tradoshi-num", text: String(x.trades) });
			tr.createEl("td", { cls: "tradoshi-num", text: x.trades ? pct(x.winRate) : "–" });
			tr.createEl("td", { cls: `tradoshi-num tradoshi-strong ${sign(x.expectancy ?? 0)}`, text: x.expectancy === null ? "–" : money(x.expectancy, c) });
			tr.createEl("td", { cls: `tradoshi-num ${sign(x.net)}`, text: x.trades ? money(x.net, c) : "–" });
		};
		line(t("planFollowed"), gap.followed);
		line(t("planBroken"), gap.broken);
		line(st("clean"), gap.clean);
		line(st("withMistake"), gap.withMistakes);

		const box = card.createDiv({ cls: "tradoshi-insight tradoshi-su-verdicts" });
		const say = (text: string, cls = ""): void => void box.createDiv({ cls, text });
		if (gap.planCost !== null && gap.planCost > 0) {
			say(st("planCost", { v: amount(gap.planCost, c) }), "tradoshi-strong neg");
			say(st("planPotential", { v: money(row.stats.net + gap.planCost, c) }), "tradoshi-muted");
		} else if (gap.planCost !== null && gap.planCost < 0) say(st("planBetter", { v: amount(-gap.planCost, c) }));
		else if (gap.followed.trades && !gap.broken.trades) say(st("planAlways"), "pos");
		else if (!gap.followed.trades && !gap.broken.trades) say(st("planUnknown"), "tradoshi-muted");
		if (gap.unknown && (gap.followed.trades || gap.broken.trades)) say(st("planUnknownN", { n: gap.unknown }), "tradoshi-muted");
		if (gap.mistakeCost !== null && gap.mistakeCost > 0) say(st("mistakeCost", { v: amount(gap.mistakeCost, c) }), "tradoshi-strong neg");
		if (!gap.withMistakes.trades) say(st("noMistakeHere"), "tradoshi-muted");
		for (const x of gap.mistakes.slice(0, 3)) say(`${x.tag}${colon()}${money(x.net, c)} (${tradesLabel(x.trades)}, ${money(x.expectancy, c)}/${perTrade()})`, sign(x.net));

		// Live trading against the trades missed and the backtest of the same setup.
		const others = this.othersOf(m, row.key);
		if (!others.length) {
			if (!m.sample) card.createEl("p", { cls: "tradoshi-note tradoshi-su-hint", text: st("missedHint") });
			return;
		}
		const k = kindGap([...row.trades.map((x) => ({ pnl: x.pnl, r: x.r, kind: "executed" as const })), ...others.map((x) => ({ pnl: x.pnl, r: x.r, kind: x.kind }))]);
		card.createDiv({ cls: "tradoshi-xsubtitle", text: st("missedTitle") });
		const t2 = card.createDiv({ cls: "tradoshi-su-scroll" }).createEl("table", { cls: "tradoshi-table tradoshi-su-gap-table" });
		const h2 = t2.createEl("tr");
		for (const h of ["", t("trades"), t("winRate"), t("expectancy"), t("avgR")]) h2.createEl("th", { cls: h ? "tradoshi-num" : "", text: h });
		const kline = (label: string, x: Side): void => {
			if (!x.trades) return;
			const tr = t2.createEl("tr");
			tr.createEl("td", { text: label });
			tr.createEl("td", { cls: "tradoshi-num", text: String(x.trades) });
			tr.createEl("td", { cls: "tradoshi-num", text: pct(x.winRate) });
			tr.createEl("td", { cls: `tradoshi-num ${sign(x.expectancy ?? 0)}`, text: x.expectancy === null ? "–" : money(x.expectancy, c) });
			tr.createEl("td", { cls: `tradoshi-num ${sign(x.avgR ?? 0)}`, text: rText(x.avgR) });
		};
		kline(st("live"), k.live);
		kline(st("missed"), k.missed);
		kline(st("backtest"), k.backtest);
		const box2 = card.createDiv({ cls: "tradoshi-insight tradoshi-su-verdicts" });
		if (k.missed.trades) {
			box2.createDiv({ text: st("taken", { v: pct(k.taken), n: k.live.trades, total: k.live.trades + k.missed.trades }) });
			box2.createDiv({ cls: sign(k.missed.net), text: st("missedEdge", { v: money(k.missed.net, c) }) });
			box2.createDiv({ text: st("livePlusMissed", { v: money(k.livePlusMissed, c) }) });
			if (k.capture !== null) box2.createDiv({ cls: "tradoshi-strong", text: st("capture", { v: pct(k.capture) }) });
		}
		if (k.backtest.trades && k.live.trades) {
			const useR = k.backtest.avgR !== null && k.live.avgR !== null;
			const live = useR ? rText(k.live.avgR) : this.fmt(k.live.expectancy, m, "money");
			const test = useR ? rText(k.backtest.avgR) : this.fmt(k.backtest.expectancy, m, "money");
			const behind = useR ? (k.live.avgR ?? 0) < (k.backtest.avgR ?? 0) : (k.live.expectancy ?? 0) < (k.backtest.expectancy ?? 0);
			box2.createDiv({ cls: behind ? "neg" : "pos", text: st(behind ? "backtestBehind" : "backtestAhead", { live, test }) });
		}
	}

	private drawBreakdowns(grid: HTMLElement, m: Model, row: SetupRow): void {
		const c = m.currency;
		const days = grid.createDiv({ cls: "tradoshi-card tradoshi-w-third" });
		cardTitle(days, t("weekdays"));
		if (!row.trades.length) emptyCard(days, st("noTradePeriod"));
		else
			columns(
				days,
				this.tipper,
				byWeekday(row.trades, c).map((d) => ({
					label: weekdayName(d.day),
					value: d.pnl,
					empty: !d.trades,
					tip: [money(d.pnl, c, 2), tradesLabel(d.trades), d.trades ? `${money(d.pnl / d.trades, c)}/${perTrade()}` : ""].filter(Boolean),
				})),
				{ label: t("weekdays") },
			);

		const hours = grid.createDiv({ cls: "tradoshi-card tradoshi-w-third" });
		cardTitle(hours, st("byHour"));
		const { buckets, unknown } = byHour(row.trades);
		const traded = buckets.filter((b) => b.trades);
		if (!traded.length) emptyCard(hours, row.trades.length ? st("noHour") : st("noTradePeriod"));
		else {
			const shown = buckets.slice(traded[0].hour, traded[traded.length - 1].hour + 1);
			columns(
				hours,
				this.tipper,
				shown.map((b) => ({
					label: String(b.hour).padStart(2, "0"),
					value: b.net,
					empty: !b.trades,
					tip: [`${String(b.hour).padStart(2, "0")}:00 – ${String((b.hour + 1) % 24).padStart(2, "0")}:00`, money(b.net, c, 2), tradesLabel(b.trades), b.wins + b.losses ? `${t("winRate")} ${pct((b.wins / (b.wins + b.losses)) * 100)}` : ""].filter(Boolean),
				})),
				{ label: st("byHour"), dense: shown.length > 8 },
			);
			if (unknown) hours.createEl("p", { cls: "tradoshi-note", text: st("hourUnknown", { n: unknown }) });
		}

		const symbols = grid.createDiv({ cls: "tradoshi-card tradoshi-w-third" });
		cardTitle(symbols, st("bySymbol"));
		const { groups, others } = topGroups(row.trades, (x) => (x.symbol ? [x.symbol] : []), 6);
		if (!groups.length) emptyCard(symbols, st("noTradePeriod"));
		else groupBars(symbols, others ? [...groups, { ...others, label: st("otherSymbols", { n: others.count }) }] : groups, c, perTrade());
	}

	private tradeTable(parent: HTMLElement, m: Model, trades: DashTrade[], cols: ("date" | "symbol" | "side" | "account" | "r" | "plan" | "result")[]): void {
		const table = parent.createDiv({ cls: "tradoshi-su-scroll" }).createEl("table", { cls: "tradoshi-table" });
		const head = table.createEl("tr");
		const label: Record<string, string> = { date: t("date"), symbol: t("symbol"), side: t("side"), account: t("account"), r: "R", plan: st("plan"), result: t("result") };
		for (const col of cols) head.createEl("th", { cls: col === "r" || col === "result" ? "tradoshi-num" : "", text: label[col] });
		for (const x of trades) {
			const tr = table.createEl("tr");
			for (const col of cols) {
				if (col === "date") tr.createEl("td", { text: shortDate(x.at) });
				if (col === "symbol") tr.createEl("td", { cls: "tradoshi-strong", text: x.symbol });
				if (col === "side") tr.createEl("td", { text: t(x.side) });
				if (col === "account") tr.createEl("td", { cls: "tradoshi-muted", text: x.account });
				if (col === "r") tr.createEl("td", { cls: "tradoshi-num", text: x.r === null ? "–" : num(x.r) });
				if (col === "plan") tr.createEl("td", { cls: x.followedPlan === true ? "pos" : x.followedPlan === false ? "neg" : "tradoshi-muted", text: x.followedPlan === true ? "✓" : x.followedPlan === false ? "✗" : "–" });
				if (col === "result") tr.createEl("td", { cls: `tradoshi-num tradoshi-strong ${sign(x.pnl)}`, text: money(x.pnl, m.currency, 2) });
			}
			const path = x.path;
			if (path) {
				tr.addClass("is-link");
				this.openable(tr, t("openNote"), () => void this.openFile(path));
			}
		}
	}

	private drawExtremes(grid: HTMLElement, m: Model, row: SetupRow): void {
		const { best, worst } = extremes(row.trades, 5);
		for (const [title, list, empty] of [
			[st("bestTrades"), best, st("noWin")],
			[st("worstTrades"), worst, st("noLoss")],
		] as const) {
			const card = grid.createDiv({ cls: "tradoshi-card tradoshi-w-half" });
			cardTitle(card, title);
			if (!list.length) emptyCard(card, row.trades.length ? empty : st("noTradePeriod"));
			else this.tradeTable(card, m, list, ["date", "symbol", "side", "r", "result"]);
		}
	}

	private drawRules(grid: HTMLElement, m: Model, row: SetupRow, sheet: Sheet | null): void {
		const card = grid.createDiv({ cls: "tradoshi-card tradoshi-w-narrow tradoshi-su-rules" });
		const rules: Rule[] = sheet ? parseRules(sheet.content) : [];
		cardTitle(card, st("rules"), rules.length ? `${rules.filter((r) => r.done).length}/${rules.length}` : undefined);
		if (!sheet) return emptyCard(card, m.sample ? st("noSheetSample") : st("noSheetYet"));
		if (!rules.length) emptyCard(card, st("noRules"));
		const file = sheet.file;
		const groups = new Set(rules.map((r) => r.group ?? ""));
		let current: string | null = null;
		const list = card.createDiv({ cls: "tradoshi-su-rule-list" });
		for (const rule of rules) {
			if (groups.size > 1 && rule.group !== current) {
				current = rule.group;
				list.createDiv({ cls: "tradoshi-xsubtitle", text: rule.group ?? "" });
			}
			const item = list.createEl("label", { cls: "tradoshi-su-rule" });
			const box = item.createEl("input", { attr: { type: "checkbox" } });
			box.checked = rule.done;
			item.createSpan({ text: rule.text });
			if (!file) {
				box.disabled = true;
				continue;
			}
			box.addEventListener("change", () => {
				void this.app.vault.process(file, (md) => setRule(md, rule, box.checked) ?? md);
			});
		}
		if (file) {
			const buttons = card.createDiv({ cls: "tradoshi-su-buttons" });
			if (rules.some((r) => r.done)) buttons.createEl("button", { text: st("untickAll") }).addEventListener("click", () => void this.app.vault.process(file, (md) => resetRules(md)));
			buttons.createEl("button", { text: st("editRules") }).addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(file));
		} else card.createEl("p", { cls: "tradoshi-note", text: st("sampleRules") });
	}

	private drawPlaybook(grid: HTMLElement, meta: SetupMeta | null, sheet: Sheet | null): void {
		const card = grid.createDiv({ cls: "tradoshi-card tradoshi-w-wide tradoshi-su-playbook-card" });
		const head = cardTitle(card, st("playbook"));
		const linked = this.playbookNote(meta);
		const source = linked ?? sheet?.file ?? null;
		if (source) {
			const open = head.createEl("button", { cls: "tradoshi-link-button", text: linked ? st("openPlaybook") : st("openSheet") });
			open.addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(source));
		}
		const scope = this.drawing ?? this;
		const render = (md: string, path: string): void => {
			if (!md.trim()) {
				emptyCard(card, sheet ? st("noPlaybook") : st("noSheetYet"));
				return;
			}
			const body = card.createDiv({ cls: "tradoshi-su-playbook markdown-rendered" });
			void MarkdownRenderer.render(this.app, md, body, path, scope);
		};
		if (linked) void this.app.vault.cachedRead(linked).then((text) => render(playbookMarkdown(text), linked.path));
		else render(sheet ? playbookMarkdown(sheet.content) : "", sheet?.file?.path ?? "");
	}

	/** Screenshots of the trades of the setup, the latest first. */
	private drawMedia(grid: HTMLElement, row: SetupRow): void {
		const items: Media[] = [];
		for (let i = row.trades.length - 1; i >= 0 && items.length < 16; i--) {
			const path = row.trades[i].path;
			const file = path ? this.app.vault.getFileByPath(path) : null;
			if (file) items.push(...mediaOf(this.app, file));
		}
		if (!items.length) return;
		const card = grid.createDiv({ cls: "tradoshi-card tradoshi-w-full" });
		cardTitle(card, st("screenshots"), String(items.length));
		const strip = card.createDiv({ cls: "tradoshi-tc-thumbs" });
		items.slice(0, 16).forEach((it, i) => {
			const b = strip.createEl("button", { cls: "tradoshi-tc-thumb", attr: { "aria-label": it.name } });
			if (it.video) b.createEl("video", { attr: { src: it.src, muted: "", preload: "metadata" } });
			else b.createEl("img", { attr: { src: it.src, alt: it.name, loading: "lazy" } });
			b.addEventListener("click", () => new MediaModal(this.app, items, i).open());
		});
	}

	/** The notes of the vault that link to the sheet, trade notes left out. */
	private drawLinked(grid: HTMLElement, m: Model, sheet: Sheet | null): void {
		const path = sheet?.file?.path;
		if (!path || m.sample) return;
		const sources = Object.entries(this.app.metadataCache.resolvedLinks)
			.filter(([src, links]) => src !== path && (links[path] ?? 0) > 0)
			.map(([src]) => src)
			.filter((src) => {
				const f = this.app.vault.getFileByPath(src);
				return !(f && typeof this.app.metadataCache.getFileCache(f)?.frontmatter?.tradoshi_id === "string");
			})
			.sort((a, b) => a.localeCompare(b));
		const card = grid.createDiv({ cls: "tradoshi-card tradoshi-w-full" });
		cardTitle(card, st("linkedNotes"), sources.length ? String(sources.length) : undefined);
		if (!sources.length) return emptyCard(card, st("noLinked", { name: sheet.meta.name }));
		const box = card.createDiv({ cls: "tradoshi-su-linked" });
		for (const src of sources.slice(0, 30)) {
			const a = box.createEl("button", { cls: "tradoshi-su-linked-note", text: src.replace(/\.md$/, "").split("/").pop() ?? src, attr: { "aria-label": src } });
			a.addEventListener("click", () => void this.openFile(src));
		}
	}

	private drawTrades(grid: HTMLElement, m: Model, row: SetupRow): void {
		const card = grid.createDiv({ cls: "tradoshi-card tradoshi-w-full" });
		cardTitle(card, st("tradesOf"), row.trades.length ? tradesLabel(row.trades.length) : undefined);
		if (!row.trades.length) return emptyCard(card, st("noTradePeriod"));
		const newest = [...row.trades].reverse();
		this.tradeTable(card, m, newest.slice(0, this.shownTrades), ["date", "symbol", "side", "account", "r", "plan", "result"]);
		if (newest.length > this.shownTrades) {
			card.createEl("button", { cls: "tradoshi-link-button", text: st("showMore", { n: newest.length - this.shownTrades }) }).addEventListener("click", () => {
				this.shownTrades += 100;
				const top = this.contentEl.scrollTop;
				this.draw();
				this.contentEl.scrollTop = top;
			});
		}
	}

	// ── Comparison ──────────────────────────────────────────────────────────

	private drawCompare(root: HTMLElement, m: Model, chosen: string[]): void {
		const keys = chosen.length ? chosen : this.defaultCompare(m);
		const rows = keys.map((k) => this.rowOf(m, k)).filter((r): r is SetupRow => r !== null);
		const head = root.createDiv({ cls: "tradoshi-head" });
		head.createEl("button", { text: `‹ ${st("back")}` }).addEventListener("click", () => this.show({ kind: "list" }));
		const title = head.createDiv({ cls: "tradoshi-su-title" });
		title.createEl("h2", { cls: "tradoshi-su-h", text: st("compareTitle") });
		const actions = head.createDiv({ cls: "tradoshi-controls" });
		const pick = (): void => {
			const choices = sortRows(m.rows, "trades").map((r) => ({ key: r.key, name: r.name, trades: r.stats.trades }));
			new ComparePicker(this.app, choices, rows.map((r) => r.key), (chosen) => this.show({ kind: "compare", keys: chosen })).open();
		};
		actions.createEl("button", { cls: "mod-cta", text: st("chooseSetups") }).addEventListener("click", pick);
		this.drawControls(root, m, false);
		this.notes(root, m);
		if (rows.length < 2) {
			root.createEl("p", { cls: "tradoshi-empty", text: st("compareNeed") });
			return;
		}
		const c = m.currency;
		const hues = rows.map((r) => hueOf(m, r));
		const gaps = rows.map((r) => executionGap(r.trades, m.categories));
		const edges = rows.map((r) => edgeConfidence(r.trades.map((x) => x.pnl)));

		const card = root.createDiv({ cls: "tradoshi-card tradoshi-su-compare" });
		cardTitle(card, st("figures"));
		const table = card.createDiv({ cls: "tradoshi-su-scroll" }).createEl("table", { cls: "tradoshi-table tradoshi-su-compare-table" });
		const headRow = table.createEl("tr");
		headRow.createEl("th");
		rows.forEach((r, i) => {
			const th = headRow.createEl("th", { cls: "tradoshi-num" });
			const name = th.createSpan({ cls: "tradoshi-su-name" });
			hueDot(name, hues[i]);
			name.createSpan({ text: r.name });
			this.openable(th, r.name, () => this.show({ kind: "detail", key: r.key }));
		});
		const metric = (label: string, values: (number | null)[], format: (v: number) => string, better: "high" | "low" | null, tone = false): void => {
			const tr = table.createEl("tr");
			tr.createEl("td", { cls: "tradoshi-muted", text: label });
			const best = better ? bestIndex(values, better) : null;
			values.forEach((v, i) => {
				const cls = ["tradoshi-num"];
				if (tone && v !== null) cls.push(sign(v));
				if (i === best) cls.push("is-best");
				tr.createEl("td", { cls: cls.join(" "), text: v === null ? "–" : format(v) });
			});
		};
		const stats = rows.map((r) => r.stats);
		const mo = (v: number): string => money(v, c);
		metric(t("trades"), stats.map((s) => s.trades), (v) => String(v), null);
		metric(t("net"), stats.map((s) => (s.trades ? s.net : null)), mo, "high", true);
		metric(t("winRate"), stats.map((s) => s.winRate), (v) => pct(v), "high");
		metric(t("expectancy"), stats.map((s) => s.expectancy), mo, "high", true);
		metric(t("profitFactor"), stats.map((s) => s.profitFactor), (v) => num(v), "high");
		metric(st("avgWin"), stats.map((s) => s.avgWin), mo, "high", true);
		metric(st("avgLoss"), stats.map((s) => s.avgLoss), mo, "high", true);
		metric(st("payoff"), stats.map((s) => s.payoff), (v) => num(v), "high");
		metric(t("avgR"), stats.map((s) => s.avgR), (v) => rText(v), "high", true);
		metric(st("totalR"), stats.map((s) => (s.rCount ? s.totalR : null)), (v) => rText(v), "high", true);
		metric(t("maxDrawdown"), stats.map((s) => (s.trades ? s.maxDrawdown : null)), (v) => (v ? money(-v, c) : "–"), "low");
		metric(st("bestTrade"), stats.map((s) => s.best?.pnl ?? null), mo, "high", true);
		metric(st("worstTrade"), stats.map((s) => s.worst?.pnl ?? null), mo, "high", true);
		metric(st("planRate"), gaps.map((g) => (g.followed.trades + g.broken.trades ? (g.followed.trades / (g.followed.trades + g.broken.trades)) * 100 : null)), (v) => pct(v), "high");
		metric(st("planCostShort"), gaps.map((g) => g.planCost), mo, "low");
		metric(st("mistakeCostShort"), gaps.map((g) => g.mistakeCost), mo, "low");
		const edgeRow = table.createEl("tr");
		edgeRow.createEl("td", { cls: "tradoshi-muted", text: st("edge") });
		edges.forEach((e) => edgeRow.createEl("td", { cls: `tradoshi-num ${e.level === "solid" || e.level === "emerging" ? (e.positive ? "pos" : "neg") : ""}`, text: `${edgeLabel(e.level, e.positive)}${e.t === null || e.level === "early" ? "" : ` (t ${num(e.t, 1)})`}` }));

		// What the figures say, with the warning a small sample deserves.
		const say = card.createDiv({ cls: "tradoshi-insight tradoshi-su-verdicts" });
		const best = bestIndex(
			stats.map((s) => s.expectancy),
			"high",
		);
		if (best !== null) {
			const others = rows
				.map((r, i) => (i === best ? null : `${r.name} ${this.fmt(stats[i].expectancy, m, "money")}`))
				.filter((x): x is string => x !== null)
				.join(", ");
			say.createDiv({ cls: "tradoshi-strong", text: st("compareBest", { name: rows[best].name, v: this.fmt(stats[best].expectancy, m, "money"), others }) });
		}
		const few = rows.filter((r) => r.stats.trades < EDGE_MIN_TRADES);
		if (few.length) say.createDiv({ cls: "tradoshi-muted", text: st("compareFew", { names: few.map((r) => r.name).join(", "), n: EDGE_MIN_TRADES }) });
		else if (edges.every((e) => e.level === "noise")) say.createDiv({ cls: "tradoshi-muted", text: st("compareNoise") });

		// The curves over one another.
		const unit = this.prefs.unit;
		const curves = root.createDiv({ cls: "tradoshi-card tradoshi-su-compare-curves" });
		const ch = cardTitle(curves, st("curves"));
		chips(
			ch,
			[
				{ value: "time", label: st("byDate") },
				{ value: "count", label: st("byTradeNumber") },
			],
			this.prefs.overlay,
			(v) => this.setPrefs({ overlay: v }),
			st("xAxis"),
		);
		const byTime = this.prefs.overlay === "time";
		const { xs, values } = (byTime ? overlayByTime : overlayByCount)(
			rows.map((r) => r.trades),
			unit,
		);
		if (!xs.length) emptyCard(curves, unit === "r" ? st("noR") : t("noTrade"));
		else
			overlayChart(
				curves,
				this.tipper,
				xs,
				rows.map((r, k) => ({ name: r.name, hue: hues[k], values: values[k] })),
				{
					label: st("curves"),
					time: byTime,
					ratio: 0.36,
					axis: (v) => (unit === "r" ? `${num(v, 1)} R` : compact(v, c)),
					firstLast: byTime ? [shortDate(xs[0]), shortDate(xs[xs.length - 1])] : ["1", String(xs[xs.length - 1])],
					tip: (i) => [byTime ? dateTime(xs[i]) : st("tradeN", { n: xs[i] }), ...rows.map((r, k) => `${r.name}${colon()}${this.fmt(values[k][i], m, unit)}`)],
					open: (k) => this.show({ kind: "detail", key: rows[k].key }),
				},
			);

		// The same breakdowns side by side: direction, day of the week, symbol.
		const grid = root.createDiv({ cls: "tradoshi-grid12" });
		const lists = rows.map((r) => r.trades);
		const cross = (titleText: string, keysAndCells: { keys: string[]; cells: Side[][] }, labelOf: (k: string) => string): void => {
			const box = grid.createDiv({ cls: "tradoshi-card tradoshi-w-third" });
			cardTitle(box, titleText);
			if (!keysAndCells.keys.length) return emptyCard(box, t("noTrade"));
			const tb = box.createDiv({ cls: "tradoshi-su-scroll" }).createEl("table", { cls: "tradoshi-table tradoshi-su-cross" });
			const hr = tb.createEl("tr");
			hr.createEl("th");
			rows.forEach((r, i) => {
				const th = hr.createEl("th", { cls: "tradoshi-num" });
				hueDot(th, hues[i]);
				th.setAttr("aria-label", r.name);
				th.setAttr("title", r.name);
			});
			keysAndCells.keys.forEach((k, ki) => {
				const tr = tb.createEl("tr");
				tr.createEl("td", { text: labelOf(k) });
				const best = bestIndex(
					keysAndCells.cells[ki].map((x) => (x.trades ? x.net : null)),
					"high",
				);
				keysAndCells.cells[ki].forEach((x, i) => {
					const td = tr.createEl("td", { cls: `tradoshi-num ${x.trades ? sign(x.net) : "tradoshi-muted"}${i === best ? " is-best" : ""}`, text: x.trades ? compact(x.net, c) : "–" });
					if (x.trades) {
						td.addEventListener("mousemove", (e) => this.tipper.tip(e, [`${rows[i].name} · ${labelOf(k)}`, money(x.net, c, 2), tradesLabel(x.trades), `${t("winRate")} ${pct(x.winRate)}`, `${t("expectancy")} ${this.fmt(x.expectancy, m, "money")}`]));
						td.addEventListener("mouseleave", () => this.tipper.hideTip());
					}
				});
			});
		};
		cross(st("byDirection"), crossBy(lists, (x) => x.side, 2, (a, b) => (a === "long" ? -1 : b === "long" ? 1 : 0)), (k) => cap(t(k === "short" ? "short" : "long")));
		cross(t("weekdays"), crossBy(lists, (x) => String((new Date(`${x.day}T12:00:00Z`).getUTCDay() + 6) % 7), 7, (a, b) => Number(a) - Number(b)), (k) => weekdayName(Number(k)));
		cross(st("bySymbol"), crossBy(lists, (x) => x.symbol || null, 8), (k) => k);
	}
}

/** Opens the Setups view, on a setup or a comparison when one is given. */
export async function openSetups(plugin: TradoshiPlugin, screen: Screen = { kind: "list" }): Promise<void> {
	const existing = plugin.app.workspace.getLeavesOfType(SETUPS_VIEW)[0];
	const leaf = existing ?? plugin.app.workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: SETUPS_VIEW, active: true, state: { screen } });
	await plugin.app.workspace.revealLeaf(leaf);
	if (leaf.view instanceof SetupsView) leaf.view.show(screen);
}
