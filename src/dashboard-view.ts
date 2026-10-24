import { ItemView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import { emotionLabel, locale, t, tradesLabel } from "./i18n";
import { loadDashData, type DashData } from "./journal-data";
import { LOGO_DATA_URI } from "./logo";
import { appLink } from "./render";
import {
	byCategory,
	byEmotion,
	byWeekday,
	dayTotals,
	equity,
	inPeriod,
	kpis,
	mainCurrency,
	planSplit,
	type DashTrade,
	type Group,
} from "./stats";
import type TradoshiPlugin from "./main";

export const DASHBOARD_VIEW = "tradoshi-dashboard";

const PERIODS: { days: number; label: () => string }[] = [
	{ days: 7, label: () => t("days7") },
	{ days: 30, label: () => t("days30") },
	{ days: 90, label: () => t("days90") },
	{ days: 0, label: () => t("allTime") },
];

const sign = (v: number): string => (v > 0 ? "pos" : v < 0 ? "neg" : "");

export class DashboardView extends ItemView {
	private period = 30;
	private account = "all";
	private month: { y: number; m: number } | null = null;
	private data: DashData | null = null;
	private tip: HTMLElement | null = null;

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
		this.data = loadDashData(this.app, this.plugin.isConnected(), this.plugin.settings.tagCategories);
		this.draw();
	}

	// ── Formatting ───────────────────────────────────────────────────────────

	private money(v: number, currency: string, digits = 0): string {
		try {
			return new Intl.NumberFormat(locale(), { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits, signDisplay: "exceptZero" }).format(v);
		} catch {
			return `${v > 0 ? "+" : ""}${v.toFixed(digits)} ${currency}`;
		}
	}

	private compact(v: number, currency: string): string {
		try {
			return new Intl.NumberFormat(locale(), { style: "currency", currency, notation: "compact", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(v);
		} catch {
			return this.money(v, currency);
		}
	}

	/** A short signed amount without currency, for the calendar cells: "+1,5 k". */
	private compactNumber(v: number): string {
		return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: Math.abs(v) >= 1000 ? 1 : 0, signDisplay: "exceptZero" }).format(v);
	}

	private num(v: number, digits = 2): string {
		return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
	}

	private dateLabel(ms: number, opts: Intl.DateTimeFormatOptions): string {
		return new Date(ms).toLocaleDateString(locale(), opts);
	}

	// ── Drawing ──────────────────────────────────────────────────────────────

	private draw(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("tradoshi-dash");
		if (!this.data) return;
		const all = this.data.trades.filter((x) => this.account === "all" || x.account === this.account);
		const latest = all.reduce((m, x) => Math.max(m, x.at), 0);
		const now = this.data.sample ? Date.now() : Math.max(Date.now(), latest);
		const trades = inPeriod(all, this.period, now);
		// Money figures use the currency most trades of the period are in.
		const currency = mainCurrency(trades.length ? trades : all.length ? all : this.data.trades);

		this.drawHeader(root);
		if (this.data.sample) this.drawSample(root);

		const k = kpis(trades, currency);
		this.drawKpis(root, k);
		if (k.otherCurrency) root.createEl("p", { cls: "tradoshi-note", text: t("mixedCurrency", { c: currency, n: k.otherCurrency }) });

		const row1 = root.createDiv({ cls: "tradoshi-row tradoshi-row-wide" });
		this.drawEquity(row1.createDiv({ cls: "tradoshi-card" }), trades, currency);
		this.drawCalendar(row1.createDiv({ cls: "tradoshi-card" }), all, currency, latest || now);

		const row2 = root.createDiv({ cls: "tradoshi-row tradoshi-row-3" });
		this.drawDiscipline(row2.createDiv({ cls: "tradoshi-card" }), trades, currency);
		this.drawGroups(row2.createDiv({ cls: "tradoshi-card" }), t("setups"), byCategory(trades, this.data.categories, "Setups", currency), currency, t("noSetup"));
		this.drawGroups(
			row2.createDiv({ cls: "tradoshi-card" }),
			t("emotions"),
			byEmotion(trades, currency).map((g) => ({ ...g, label: emotionLabel(g.label) })),
			currency,
			t("noEmotion"),
		);

		const row3 = root.createDiv({ cls: "tradoshi-row tradoshi-row-wide" });
		this.drawRecent(row3.createDiv({ cls: "tradoshi-card" }), trades, currency);
		this.drawWeekdays(row3.createDiv({ cls: "tradoshi-card" }), trades, currency);

		this.tip = root.createDiv({ cls: "tradoshi-tip" });
	}

	private drawHeader(root: HTMLElement): void {
		const head = root.createDiv({ cls: "tradoshi-head" });
		const brand = head.createDiv({ cls: "tradoshi-brand" });
		brand.createEl("img", { attr: { src: LOGO_DATA_URI, alt: "" }, cls: "tradoshi-logo" });
		const title = brand.createDiv();
		title.createDiv({ cls: "tradoshi-wordmark", text: "Tradoshi" });
		title.createDiv({ cls: "tradoshi-sub", text: t("journal") });

		const controls = head.createDiv({ cls: "tradoshi-controls" });
		for (const p of PERIODS) {
			const b = controls.createEl("button", { cls: "tradoshi-chip", text: p.label() });
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
			this.month = null;
			this.draw();
		});
		if (!this.data?.sample) {
			const sync = controls.createEl("button", { cls: "mod-cta tradoshi-sync", text: t("sync") });
			sync.addEventListener("click", () => {
				sync.setText(t("syncing"));
				sync.disabled = true;
				void this.plugin.sync(true).then(() => this.refresh());
			});
		}
	}

	private drawSample(root: HTMLElement): void {
		const box = root.createDiv({ cls: "tradoshi-sample" });
		const left = box.createDiv({ cls: "tradoshi-sample-text" });
		left.createEl("strong", { text: t("sampleTitle") });
		left.createEl("p", { text: t("sampleText") });
		const connect = left.createEl("button", { cls: "mod-cta", text: t("connect") });
		connect.addEventListener("click", () => window.open(appLink({ appUrl: this.plugin.appUrl }, "dashboard_sample", "params", "section=obsidian")));

		const flow = box.createDiv({ cls: "tradoshi-flow", attr: { "aria-label": t("dataTitle") } });
		flow.createDiv({ cls: "tradoshi-flow-title", text: t("dataTitle") });
		const steps = flow.createDiv({ cls: "tradoshi-flow-steps" });
		const step = (title: string, text: string): void => {
			const s = steps.createDiv({ cls: "tradoshi-flow-step" });
			s.createEl("strong", { text: title });
			s.createSpan({ text });
		};
		step(t("dataBroker"), t("dataBrokerText"));
		steps.createDiv({ cls: "tradoshi-flow-arrow", text: "→" });
		step(t("dataServer"), t("dataServerText"));
		steps.createDiv({ cls: "tradoshi-flow-arrow", text: "→" });
		step(t("dataVault"), t("dataVaultText"));
	}

	private drawKpis(root: HTMLElement, k: ReturnType<typeof kpis>): void {
		const grid = root.createDiv({ cls: "tradoshi-kpis" });
		const card = (label: string, value: string, sub: string, cls = ""): void => {
			const c = grid.createDiv({ cls: "tradoshi-kpi" });
			c.createDiv({ cls: "tradoshi-kpi-label", text: label });
			c.createDiv({ cls: `tradoshi-kpi-value ${cls}`, text: value });
			c.createDiv({ cls: "tradoshi-kpi-sub", text: sub });
		};
		card(t("net"), this.money(k.net, k.currency), " ", sign(k.net));
		card(t("winRate"), k.winRate === null ? "–" : `${this.num(k.winRate, 1)} %`, " ");
		card(t("profitFactor"), k.profitFactor === null ? "–" : this.num(k.profitFactor), t("winsOverLosses"));
		card(t("expectancy"), k.expectancy === null ? "–" : this.money(k.expectancy, k.currency), t("perTrade"), sign(k.expectancy ?? 0));
		card(t("avgR"), k.avgR === null ? "–" : `${k.avgR > 0 ? "+" : ""}${this.num(k.avgR)} R`, k.avgR === null ? " " : t("rCoverage", { n: k.rCoverage, total: k.trades }), sign(k.avgR ?? 0));
		card(t("trades"), String(k.trades), " ");
		card(t("maxDrawdown"), k.maxDrawdown ? this.money(-k.maxDrawdown, k.currency) : "–", t("fromPeak"), k.maxDrawdown ? "neg" : "");
		card(
			t("bestDay"),
			k.bestDay ? this.money(k.bestDay.pnl, k.currency) : "–",
			k.bestDay ? this.dateLabel(new Date(`${k.bestDay.day}T12:00:00`).getTime(), { day: "numeric", month: "short" }) : " ",
			k.bestDay ? "pos" : "",
		);
	}

	private cardTitle(card: HTMLElement, text: string, extra?: string): void {
		const h = card.createDiv({ cls: "tradoshi-card-title" });
		h.createSpan({ text });
		if (extra) h.createSpan({ cls: "tradoshi-card-extra", text: extra });
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

	private drawEquity(card: HTMLElement, trades: DashTrade[], currency: string): void {
		const pts = equity(trades, currency);
		this.cardTitle(card, t("equity"), pts.length ? t("tradesCount", { n: pts.length }) : undefined);
		if (!pts.length) {
			card.createEl("p", { cls: "tradoshi-empty", text: t("noTrade") });
			return;
		}
		const W = 800, H = 450, pl = 70, pr = 12, pt = 12, pb = 26;
		const values = [0, ...pts.map((p) => p.value)];
		const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
		const x = (i: number): number => pl + (i / Math.max(pts.length - 1, 1)) * (W - pl - pr);
		const y = (v: number): number => pt + (1 - (v - min) / span) * (H - pt - pb);
		const svg = card.createSvg("svg", { cls: "tradoshi-chart", attr: { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": t("equity") } });
		for (let i = 0; i <= 4; i++) {
			const v = min + (span * i) / 4;
			svg.createSvg("line", { cls: "tradoshi-grid", attr: { x1: pl, x2: W - pr, y1: y(v), y2: y(v) } });
			svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: pl - 8, y: y(v) + 4, "text-anchor": "end" } }).textContent = this.compact(v, currency);
		}
		svg.createSvg("line", { cls: "tradoshi-zero", attr: { x1: pl, x2: W - pr, y1: y(0), y2: y(0) } });
		const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
		svg.createSvg("path", { cls: "tradoshi-area", attr: { d: `${line}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z` } });
		svg.createSvg("path", { cls: "tradoshi-line", attr: { d: line } });
		const fmt = { day: "numeric", month: "short" } as const;
		svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: pl, y: H - 6 } }).textContent = this.dateLabel(pts[0].at, fmt);
		svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: W - pr, y: H - 6, "text-anchor": "end" } }).textContent = this.dateLabel(pts[pts.length - 1].at, fmt);
		const cross = svg.createSvg("line", { cls: "tradoshi-cross", attr: { y1: pt, y2: H - pb } });
		const dot = svg.createSvg("circle", { cls: "tradoshi-dot", attr: { r: 5 } });
		const hit = svg.createSvg("rect", { cls: "tradoshi-hit", attr: { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb } });
		hit.addEventListener("mousemove", (e) => {
			const r = svg.getBoundingClientRect();
			const sx = ((e.clientX - r.left) / r.width) * W;
			const i = Math.max(0, Math.min(pts.length - 1, Math.round(((sx - pl) / (W - pl - pr)) * (pts.length - 1))));
			const p = pts[i];
			cross.setAttr("x1", x(i));
			cross.setAttr("x2", x(i));
			dot.setAttr("cx", x(i));
			dot.setAttr("cy", y(p.value));
			svg.addClass("is-hover");
			this.showTip(e, [
				this.dateLabel(p.at, { weekday: "short", day: "numeric", month: "short" }),
				`${p.trade.symbol} ${t(p.trade.side)} : ${this.money(p.trade.pnl, currency, 2)}`,
				`Σ ${this.money(p.value, currency, 2)}`,
			]);
		});
		hit.addEventListener("mouseleave", () => {
			svg.removeClass("is-hover");
			this.hideTip();
		});
	}

	private drawCalendar(card: HTMLElement, trades: DashTrade[], currency: string, anchor: number): void {
		if (!this.month) {
			const d = new Date(anchor);
			this.month = { y: d.getFullYear(), m: d.getMonth() };
		}
		const { y, m } = this.month;
		const head = card.createDiv({ cls: "tradoshi-card-title" });
		head.createSpan({ text: new Date(y, m, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" }) });
		const nav = head.createSpan({ cls: "tradoshi-cal-nav" });
		const go = (delta: number): void => {
			const d = new Date(y, m + delta, 1);
			this.month = { y: d.getFullYear(), m: d.getMonth() };
			this.draw();
		};
		nav.createEl("button", { cls: "clickable-icon", text: "‹", attr: { "aria-label": "Previous month" } }).addEventListener("click", () => go(-1));
		nav.createEl("button", { cls: "clickable-icon", text: "›", attr: { "aria-label": "Next month" } }).addEventListener("click", () => go(1));

		// The calendar uses the currency most trades of the month are in.
		const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;
		const ofMonth = trades.filter((x) => x.day.startsWith(prefix));
		const calCurrency = ofMonth.length ? mainCurrency(ofMonth) : currency;
		const days = dayTotals(trades.filter((x) => x.currency === calCurrency));
		const pad = (n: number): string => String(n).padStart(2, "0");
		const key = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		const first = new Date(y, m, 1);
		const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
		const weekend = [...days.keys()].some((k) => {
			const d = new Date(`${k}T12:00:00`);
			return d.getMonth() === m && d.getFullYear() === y && (d.getDay() === 0 || d.getDay() === 6);
		});
		const cols = weekend ? 7 : 5;
		const grid = card.createDiv({ cls: `tradoshi-cal tradoshi-cal-${cols}` });
		for (let c = 0; c < cols; c++) {
			grid.createDiv({ cls: "tradoshi-cal-head", text: new Date(2024, 0, 1 + c).toLocaleDateString(locale(), { weekday: "short" }) });
		}
		grid.createDiv({ cls: "tradoshi-cal-head", text: t("week") });
		for (let w = 0; w < 6; w++) {
			const weekStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7);
			if (w > 3 && weekStart.getMonth() !== m) break;
			let wp = 0;
			let wn = 0;
			for (let c = 0; c < cols; c++) {
				const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + c);
				const v = days.get(key(d));
				const out = d.getMonth() !== m;
				const cell = grid.createEl("button", { cls: "tradoshi-cell" });
				cell.createSpan({ cls: "tradoshi-cell-day", text: String(d.getDate()) });
				if (out) {
					cell.addClass("is-out");
					cell.disabled = true;
					continue;
				}
				if (v) {
					wp += v.pnl;
					wn += v.trades;
					cell.addClass(v.pnl >= 0 ? "is-gain" : "is-loss");
					cell.createSpan({ cls: "tradoshi-cell-pnl", text: this.compactNumber(v.pnl) });
					cell.createSpan({ cls: "tradoshi-cell-n", text: tradesLabel(v.trades) });
					cell.setAttr("aria-label", `${key(d)} ${this.money(v.pnl, calCurrency)}`);
					cell.addEventListener("click", () => void this.openDay(key(d)));
				} else {
					cell.disabled = true;
				}
			}
			const total = grid.createDiv({ cls: "tradoshi-cell tradoshi-cell-week" });
			total.createSpan({ cls: "tradoshi-cell-day", text: `${t("week").charAt(0)}${w + 1}` });
			if (wn) {
				total.createSpan({ cls: `tradoshi-cell-pnl ${sign(wp)}`, text: this.compactNumber(wp) });
				total.createSpan({ cls: "tradoshi-cell-n", text: tradesLabel(wn) });
			}
		}
	}

	private bars(card: HTMLElement, groups: Group[], currency: string): void {
		const max = Math.max(...groups.map((g) => Math.abs(g.net)), 1);
		for (const g of groups) {
			const row = card.createDiv({ cls: "tradoshi-bar-row" });
			const label = row.createDiv({ cls: "tradoshi-bar-label" });
			label.createDiv({ text: g.label });
			label.createDiv({
				cls: "tradoshi-bar-sub",
				text: `${tradesLabel(g.trades)}${g.winRate === null ? "" : ` · ${Math.round(g.winRate)} %`} · ${this.money(g.expectancy, currency)}/${t("perTrade").split(" ").pop() ?? ""}`,
			});
			const track = row.createDiv({ cls: "tradoshi-bar-track" });
			const bar = track.createDiv({ cls: `tradoshi-bar ${g.net >= 0 ? "is-gain" : "is-loss"}` });
			bar.setCssProps({ "--w": `${Math.max(2, (Math.abs(g.net) / max) * 50)}%` });
			row.createDiv({ cls: `tradoshi-bar-value ${sign(g.net)}`, text: this.money(g.net, currency) });
		}
	}

	private drawGroups(card: HTMLElement, title: string, groups: Group[], currency: string, empty: string): void {
		this.cardTitle(card, title);
		if (!groups.length) card.createEl("p", { cls: "tradoshi-empty", text: empty });
		else this.bars(card, groups, currency);
	}

	private drawDiscipline(card: HTMLElement, trades: DashTrade[], currency: string): void {
		this.cardTitle(card, t("discipline"));
		const { followed, broken } = planSplit(trades, currency);
		if (followed || broken) {
			const box = card.createDiv({ cls: "tradoshi-insight" });
			const line = (label: string, g: Group | null): void => {
				if (!g) return;
				const l = box.createDiv();
				l.createSpan({ text: `${label} : ` });
				l.createSpan({ cls: `tradoshi-strong ${sign(g.expectancy)}`, text: this.money(g.expectancy, currency) });
				l.createSpan({ cls: "tradoshi-muted", text: ` ${t("perTrade")} (${g.trades})` });
			};
			line(t("planFollowed"), followed);
			line(t("planBroken"), broken);
		}
		card.createDiv({ cls: "tradoshi-muted tradoshi-small", text: t("mistakes") });
		const mistakes = byCategory(trades, this.data?.categories ?? {}, "Mistakes", currency);
		if (!mistakes.length) card.createEl("p", { cls: "tradoshi-empty", text: t("noMistake") });
		else this.bars(card, mistakes, currency);
	}

	private drawWeekdays(card: HTMLElement, trades: DashTrade[], currency: string): void {
		this.cardTitle(card, t("weekdays"));
		const data = byWeekday(trades, currency);
		const max = Math.max(...data.map((d) => Math.abs(d.pnl)), 1);
		const chart = card.createDiv({ cls: `tradoshi-weekdays tradoshi-weekdays-${data.length}` });
		for (const d of data) {
			const col = chart.createDiv({ cls: "tradoshi-weekday" });
			const up = col.createDiv({ cls: "tradoshi-weekday-half is-up" });
			const down = col.createDiv({ cls: "tradoshi-weekday-half is-down" });
			const bar = (d.pnl >= 0 ? up : down).createDiv({ cls: `tradoshi-weekday-bar ${d.pnl >= 0 ? "is-gain" : "is-loss"}` });
			bar.setCssProps({ "--h": `${Math.max(d.trades ? 3 : 0, (Math.abs(d.pnl) / max) * 100)}%` });
			col.createDiv({ cls: "tradoshi-weekday-label", text: new Date(2024, 0, 1 + d.day).toLocaleDateString(locale(), { weekday: "short" }) });
			col.addEventListener("mousemove", (e) => this.showTip(e, [`${this.money(d.pnl, currency, 2)}`, t("tradesCount", { n: d.trades })]));
			col.addEventListener("mouseleave", () => this.hideTip());
		}
	}

	private drawRecent(card: HTMLElement, trades: DashTrade[], currency: string): void {
		this.cardTitle(card, t("recent"));
		const rows = [...trades].sort((a, b) => b.at - a.at).slice(0, 8);
		if (!rows.length) {
			card.createEl("p", { cls: "tradoshi-empty", text: t("noTrade") });
			return;
		}
		const table = card.createEl("table", { cls: "tradoshi-table" });
		const head = table.createEl("tr");
		for (const h of [t("date"), t("symbol"), t("side"), t("account"), "R", t("result")]) head.createEl("th", { text: h });
		for (const x of rows) {
			const tr = table.createEl("tr");
			tr.createEl("td", { text: this.dateLabel(x.at, { day: "2-digit", month: "2-digit" }) });
			tr.createEl("td", { cls: "tradoshi-strong", text: x.symbol });
			tr.createEl("td", { text: t(x.side) });
			tr.createEl("td", { cls: "tradoshi-muted", text: x.account });
			tr.createEl("td", { cls: "tradoshi-num", text: x.r === null ? "–" : this.num(x.r) });
			tr.createEl("td", { cls: `tradoshi-num tradoshi-strong ${sign(x.pnl)}`, text: x.currency === currency ? this.money(x.pnl, currency, 2) : this.money(x.pnl, x.currency, 2) });
			if (x.path) {
				tr.addClass("is-link");
				tr.setAttr("tabindex", "0");
				tr.setAttr("aria-label", t("openNote"));
				const open = (): void => void this.openPath(x.path);
				tr.addEventListener("click", open);
				tr.addEventListener("keydown", (e) => {
					if (e.key === "Enter") open();
				});
			}
		}
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
