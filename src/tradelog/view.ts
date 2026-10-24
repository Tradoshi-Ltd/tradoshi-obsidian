import { ItemView, Modal, Notice, Setting, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { FilterModal } from "../filter-modal";
import { activeFilterCount, applyFilters, NO_FILTERS, type TradeFilters } from "../filters";
import { dateLabel, money, percent, sign } from "../format";
import type TradoshiPlugin from "../main";
import { MediaModal, mediaNotes, mediaOf } from "../tradecard/card";
import { addOwnTag, ConfirmModal, deleteNotes, NamePrompt, setReviewed } from "./batch";
import { COLUMNS, DEFAULT_COLUMNS, type Column } from "./columns";
import { logTrades, type LogTrade, type TradeKind } from "./data";
import { groupKey, inRange, rangeBetween, rangeOf, sortBy, totals, type GroupMode, type RangeMode } from "./logic";
import { openManualTrade } from "../manual";
import { lt } from "./text";

export const TRADE_LOG_VIEW = "tradoshi-trade-log";
const PAGE = 300;

interface LogSettings {
	mode: "trades" | "gallery";
	columns: string[];
	group: GroupMode;
	range: RangeMode;
	custom: { from: string; to: string };
	kind: "all" | TradeKind;
	review: "all" | "yes" | "no";
	account: string;
	filters: TradeFilters;
	sort: { col: string; dir: "asc" | "desc" };
	gallerySort: "newest" | "oldest" | "best" | "worst";
	gallerySize: "small" | "medium" | "large";
	/** Only the media carrying this tag of their own; empty for all. */
	mediaTag: string;
}

const DEFAULTS: LogSettings = {
	mode: "trades",
	columns: DEFAULT_COLUMNS,
	group: "day",
	range: "all",
	custom: { from: "", to: "" },
	kind: "all",
	review: "all",
	account: "all",
	filters: { ...NO_FILTERS },
	sort: { col: "date", dir: "desc" },
	gallerySort: "newest",
	gallerySize: "medium",
	mediaTag: "",
};

const todayKey = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

class ColumnsModal extends Modal {
	constructor(
		app: App,
		private columns: string[],
		private readonly onChange: (cols: string[]) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(lt("columnsTitle"));
		this.draw();
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		el.createEl("p", { cls: "setting-item-description", text: lt("columnsHint") });
		// Shown columns first, in their order, then the others.
		const order = [...this.columns, ...COLUMNS.map((c) => c.id).filter((id) => !this.columns.includes(id))];
		order.forEach((id) => {
			const col = COLUMNS.find((c) => c.id === id);
			if (!col) return;
			const on = this.columns.includes(id);
			const i = this.columns.indexOf(id);
			const s = new Setting(el).setName(col.label());
			if (on) {
				s.addExtraButton((b) => b.setIcon("arrow-up").setDisabled(i === 0).onClick(() => this.move(i, -1)));
				s.addExtraButton((b) => b.setIcon("arrow-down").setDisabled(i === this.columns.length - 1).onClick(() => this.move(i, 1)));
			}
			s.addToggle((tg) =>
				tg.setValue(on).onChange((v) => {
					this.columns = v ? [...this.columns, id] : this.columns.filter((x) => x !== id);
					this.onChange(this.columns);
					this.draw();
				}),
			);
		});
	}

	private move(i: number, d: number): void {
		const j = i + d;
		[this.columns[i], this.columns[j]] = [this.columns[j], this.columns[i]];
		this.onChange(this.columns);
		this.draw();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class TradeLogView extends ItemView {
	private all: LogTrade[] = [];
	private selecting = false;
	private selected = new Set<string>();
	private lastClicked: number | null = null;
	private collapsed = new Set<string>();
	private shown = PAGE;
	private timer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TradoshiPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TRADE_LOG_VIEW;
	}

	getDisplayText(): string {
		return lt("title");
	}

	getIcon(): string {
		return "table";
	}

	async onOpen(): Promise<void> {
		this.refresh();
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				if (this.timer !== null) window.clearTimeout(this.timer);
				this.timer = window.setTimeout(() => this.refresh(), 700);
			}),
		);
		this.registerEvent(this.app.vault.on("delete", () => this.refresh()));
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private get s(): LogSettings {
		const saved = this.plugin.moduleData<Partial<LogSettings>>("trade-log", {});
		return { ...DEFAULTS, ...saved, filters: { ...NO_FILTERS, ...(saved.filters ?? {}) }, custom: { ...DEFAULTS.custom, ...(saved.custom ?? {}) } };
	}

	private async set(patch: Partial<LogSettings>): Promise<void> {
		await this.plugin.saveModuleData("trade-log", { ...this.s, ...patch });
		this.shown = PAGE;
		this.draw();
	}

	refresh(): void {
		this.all = logTrades(this.app);
		this.draw();
	}

	/** The trades the current choices let through, in the chosen order. */
	private visible(): LogTrade[] {
		const s = this.s;
		const range = rangeOf(s.range, todayKey(), s.custom);
		let rows = this.all.filter(
			(t) =>
				inRange(t.day, range) &&
				(s.kind === "all" || t.kind === s.kind) &&
				(s.review === "all" || (s.review === "yes") === t.reviewed) &&
				(s.account === "all" || t.account === s.account),
		);
		rows = applyFilters(rows, s.filters);
		const col = COLUMNS.find((c) => c.id === s.sort.col) ?? COLUMNS[0];
		const cats = this.plugin.tagCategories();
		return sortBy(rows, (t) => col.value(t, cats), s.sort.dir);
	}

	private draw(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("tradoshi-dash", "tradoshi-log");
		const s = this.s;
		if (!this.all.length) {
			this.drawFirstRun(root);
			return;
		}
		const rows = this.visible();
		this.drawToolbar(root, s);
		const t = totals(rows.filter((r) => r.kind === "executed"));
		const currency = rows[0]?.currency ?? "USD";
		const same = rows.every((r) => r.currency === currency);
		root.createDiv({
			cls: "tradoshi-muted tradoshi-log-summary",
			text: lt("count", {
				n: rows.length,
				net: same ? money(t.net, currency) : "–",
				wr: t.wins + t.losses ? percent((t.wins / (t.wins + t.losses)) * 100, 0) : "–",
			}),
		});
		if (s.mode === "gallery") this.drawGallery(root, rows, s);
		else {
			if (this.selecting) this.drawBatchBar(root, rows);
			this.drawTable(root, rows, s);
		}
	}

	/** No trade note in the vault yet: what to do, rather than an empty table. */
	private drawFirstRun(root: HTMLElement): void {
		const box = root.createDiv({ cls: "tradoshi-sample" });
		const left = box.createDiv({ cls: "tradoshi-sample-text" });
		left.createEl("strong", { text: lt("emptyTitle") });
		left.createEl("p", { text: lt("emptyText") });
		const buttons = left.createDiv({ cls: "tradoshi-sample-buttons" });
		if (!this.plugin.isConnected()) buttons.createEl("button", { cls: "mod-cta", text: lt("connect") }).addEventListener("click", () => this.plugin.connect("trade_log"));
		else buttons.createEl("button", { cls: "mod-cta", text: lt("connectBroker") }).addEventListener("click", () => window.open(this.plugin.brokerLink("trade_log")));
		buttons.createEl("button", { text: lt("importStatement") }).addEventListener("click", () => this.plugin.openImport());
		buttons.createEl("button", { text: lt("addTrade") }).addEventListener("click", () => openManualTrade(this.plugin));
	}

	private drawToolbar(root: HTMLElement, s: LogSettings): void {
		const bar = root.createDiv({ cls: "tradoshi-log-toolbar" });
		const tabs = bar.createDiv({ cls: "tradoshi-periods" });
		for (const m of ["trades", "gallery"] as const) {
			const b = tabs.createEl("button", { cls: `tradoshi-chip${s.mode === m ? " is-active" : ""}`, text: lt(m) });
			b.addEventListener("click", () => void this.set({ mode: m }));
		}
		const ranges = bar.createDiv({ cls: "tradoshi-periods" });
		const labels: Record<RangeMode, string> = { all: lt("rangeAll"), week: lt("rangeWeek"), month: lt("rangeMonth"), quarter: lt("rangeQuarter"), year: lt("rangeYear"), custom: lt("rangeCustom") };
		for (const r of Object.keys(labels) as RangeMode[]) {
			const b = ranges.createEl("button", { cls: `tradoshi-chip${s.range === r ? " is-active" : ""}`, text: labels[r] });
			b.addEventListener("click", () => void this.set({ range: r }));
		}
		if (s.range === "custom") {
			const dates = bar.createDiv({ cls: "tradoshi-log-dates" });
			for (const k of ["from", "to"] as const) {
				dates.createSpan({ text: lt(k) });
				const input = dates.createEl("input", { attr: { type: "date", "aria-label": lt(k) } });
				input.value = s.custom[k];
				input.addEventListener("change", () => void this.set({ custom: { ...s.custom, [k]: input.value } }));
			}
		}
		const selects = bar.createDiv({ cls: "tradoshi-log-selects" });
		const select = (label: string, options: Record<string, string>, value: string, onChange: (v: string) => void): void => {
			const el = selects.createEl("select", { cls: "dropdown", attr: { "aria-label": label } });
			for (const [k, v] of Object.entries(options)) el.createEl("option", { value: k, text: v });
			el.value = value;
			el.addEventListener("change", () => onChange(el.value));
		};
		const accounts = [...new Set(this.all.map((t) => t.account))].sort();
		select(lt("account"), { all: lt("allAccounts"), ...Object.fromEntries(accounts.map((a) => [a, a])) }, s.account, (v) => void this.set({ account: v }));
		select(lt("type"), { all: lt("typeAll"), executed: lt("executed"), missed: lt("missed"), backtest: lt("backtest") }, s.kind, (v) => void this.set({ kind: v as LogSettings["kind"] }));
		select(lt("review"), { all: lt("reviewAll"), yes: lt("reviewYes"), no: lt("reviewNo") }, s.review, (v) => void this.set({ review: v as LogSettings["review"] }));
		const n = activeFilterCount(s.filters);
		selects.createEl("button", { cls: n ? "tradoshi-has-filters" : "", text: n ? lt("filtersN", { n }) : lt("filters") }).addEventListener("click", () => {
			new FilterModal(this.app, { trades: this.all, categories: this.plugin.tagCategories() }, s.filters, (f) => void this.set({ filters: f })).open();
		});
		if (s.mode === "trades") {
			select(lt("groupBy"), { none: lt("gNone"), day: lt("gDay"), week: lt("gWeek"), month: lt("gMonth"), quarter: lt("gQuarter"), year: lt("gYear") }, s.group, (v) => void this.set({ group: v as GroupMode }));
			selects.createEl("button", { text: lt("columns") }).addEventListener("click", () => {
				new ColumnsModal(this.app, [...s.columns], (cols) => void this.set({ columns: cols })).open();
			});
			selects.createEl("button", { cls: this.selecting ? "mod-cta" : "", text: this.selecting ? lt("selectDone") : lt("select") }).addEventListener("click", () => {
				this.selecting = !this.selecting;
				this.selected.clear();
				this.lastClicked = null;
				this.draw();
			});
		} else {
			select("", { newest: lt("sortNewest"), oldest: lt("sortOldest"), best: lt("sortBest"), worst: lt("sortWorst") }, s.gallerySort, (v) => void this.set({ gallerySort: v as LogSettings["gallerySort"] }));
			select("", { small: lt("small"), medium: lt("medium"), large: lt("large") }, s.gallerySize, (v) => void this.set({ gallerySize: v as LogSettings["gallerySize"] }));
			const mediaTags = [...new Set(Object.values(mediaNotes(this.plugin)).flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b));
			if (mediaTags.length) select(lt("mediaTag"), { "": lt("allMedia"), ...Object.fromEntries(mediaTags.map((x) => [x, `#${x}`])) }, s.mediaTag, (v) => void this.set({ mediaTag: v }));
		}
	}

	private drawBatchBar(root: HTMLElement, rows: LogTrade[]): void {
		const bar = root.createDiv({ cls: "tradoshi-log-batch" });
		bar.createSpan({ cls: "tradoshi-strong", text: lt("selected", { n: this.selected.size }) });
		bar.createEl("button", { text: lt("selectAll") }).addEventListener("click", () => {
			for (const r of rows) this.selected.add(r.path);
			this.draw();
		});
		bar.createEl("button", { text: lt("clearSelection") }).addEventListener("click", () => {
			this.selected.clear();
			this.draw();
		});
		const paths = (): string[] => [...this.selected];
		const done = (n: number): void => {
			new Notice(lt("done", { n }));
			this.refresh();
		};
		const disabled = this.selected.size === 0;
		const action = (label: string, run: () => void, cls = ""): void => {
			const b = bar.createEl("button", { cls, text: label });
			b.disabled = disabled;
			b.addEventListener("click", run);
		};
		action(lt("markReviewed"), () => void setReviewed(this.app, paths(), true).then(done));
		action(lt("markUnreviewed"), () => void setReviewed(this.app, paths(), false).then(done));
		const cats = this.plugin.tagCategories();
		const named = (cat: string): string[] => Object.keys(cats).filter((k) => (cats[k] ?? "").toLowerCase() === cat);
		action(lt("addSetup"), () => new NamePrompt(this.app, lt("addSetup"), named("setups"), (n) => void addOwnTag(this.plugin, paths(), n, "Setups").then(done)).open());
		action(lt("addMistake"), () => new NamePrompt(this.app, lt("addMistake"), named("mistakes"), (n) => void addOwnTag(this.plugin, paths(), n, "Mistakes").then(done)).open());
		action(lt("addTag"), () => new NamePrompt(this.app, lt("addTag"), [], (n) => void addOwnTag(this.plugin, paths(), n, null).then(done)).open());
		action(
			lt("delete"),
			() =>
				new ConfirmModal(this.app, lt("deleteConfirm", { n: this.selected.size }), () => {
					void deleteNotes(this.app, paths()).then((n) => {
						new Notice(lt("deleteDone", { n }));
						this.selected.clear();
						this.refresh();
					});
				}).open(),
			"mod-warning",
		);
	}

	private drawTable(root: HTMLElement, rows: LogTrade[], s: LogSettings): void {
		if (!rows.length) {
			root.createEl("p", { cls: "tradoshi-empty", text: lt("noTrade") });
			return;
		}
		const cols: Column[] = s.columns.map((id) => COLUMNS.find((c) => c.id === id)).filter((c): c is Column => !!c);
		const cats = this.plugin.tagCategories();
		const wrap = root.createDiv({ cls: "tradoshi-log-wrap" });
		const table = wrap.createEl("table", { cls: "tradoshi-table tradoshi-log-table" });
		const head = table.createEl("thead").createEl("tr");
		if (this.selecting) head.createEl("th");
		for (const c of cols) {
			const th = head.createEl("th", { cls: c.numeric ? "tradoshi-num" : "", text: c.label() });
			if (s.sort.col === c.id) th.setText(`${c.label()} ${s.sort.dir === "asc" ? "▲" : "▼"}`);
			th.addClass("is-sortable");
			th.addEventListener("click", () => void this.set({ sort: { col: c.id, dir: s.sort.col === c.id && s.sort.dir === "desc" ? "asc" : "desc" } }));
		}
		const body = table.createEl("tbody");
		const page = rows.slice(0, this.shown);
		let group = "";
		page.forEach((t, i) => {
			const g = groupKey(t.day, s.group);
			if (s.group !== "none" && g !== group) {
				group = g;
				this.groupRow(body, g, s.group, rows.filter((r) => groupKey(r.day, s.group) === g), cols.length + (this.selecting ? 1 : 0));
			}
			if (s.group !== "none" && this.collapsed.has(g)) return;
			const tr = body.createEl("tr", { cls: `is-link${t.kind === "executed" ? "" : " is-muted-row"}${this.selected.has(t.path) ? " is-selected" : ""}` });
			if (this.selecting) {
				const box = tr.createEl("td").createEl("input", { attr: { type: "checkbox", "aria-label": t.symbol } });
				box.checked = this.selected.has(t.path);
			}
			for (const c of cols) c.render(tr.createEl("td", { cls: c.numeric ? "tradoshi-num" : "" }), t, cats);
			tr.addEventListener("click", (e) => {
				if (!this.selecting) {
					const file = this.app.vault.getFileByPath(t.path);
					if (file instanceof TFile) void this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? "tab" : false).openFile(file);
					return;
				}
				if (e.shiftKey && this.lastClicked !== null) for (const k of rangeBetween(this.lastClicked, i)) this.selected.add(page[k].path);
				else if (this.selected.has(t.path)) this.selected.delete(t.path);
				else this.selected.add(t.path);
				this.lastClicked = i;
				this.draw();
			});
		});
		if (rows.length > this.shown) {
			root.createEl("button", { text: `+ ${rows.length - this.shown}` }).addEventListener("click", () => {
				this.shown += PAGE;
				this.draw();
			});
		}
	}

	private groupRow(body: HTMLElement, key: string, mode: GroupMode, rows: LogTrade[], span: number): void {
		const t = totals(rows.filter((r) => r.kind === "executed"));
		const currency = rows[0]?.currency ?? "USD";
		const label =
			mode === "day"
				? dateLabel(Date.parse(`${key}T12:00:00`), { weekday: "long", day: "numeric", month: "long", year: "numeric" })
				: mode === "week"
					? lt("weekOf", { d: dateLabel(Date.parse(`${key}T12:00:00`), { day: "numeric", month: "long", year: "numeric" }) })
					: mode === "month"
						? dateLabel(Date.parse(`${key}-15T12:00:00`), { month: "long", year: "numeric" })
						: key;
		const tr = body.createEl("tr", { cls: "tradoshi-log-group" });
		const td = tr.createEl("td", { attr: { colspan: span } });
		const open = !this.collapsed.has(key);
		td.createSpan({ cls: "tradoshi-strong", text: `${open ? "▾" : "▸"} ${label}` });
		td.createSpan({ cls: "tradoshi-muted", text: ` · ${t.trades} · ` });
		td.createSpan({ cls: sign(t.net), text: money(t.net, currency) });
		if (t.wins + t.losses) td.createSpan({ cls: "tradoshi-muted", text: ` · ${percent((t.wins / (t.wins + t.losses)) * 100, 0)}` });
		tr.addEventListener("click", () => {
			if (open) this.collapsed.add(key);
			else this.collapsed.delete(key);
			this.draw();
		});
		// A day opens its day note on a double click.
		if (mode === "day") {
			tr.addEventListener("dblclick", () => {
				const path = this.plugin.pathForKey(`day:${key}`);
				const file = path ? this.app.vault.getFileByPath(path) : null;
				if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
			});
		}
	}

	private drawGallery(root: HTMLElement, rows: LogTrade[], s: LogSettings): void {
		const withMedia = rows.filter((r) => r.media > 0);
		const order = s.gallerySort === "oldest" ? sortBy(withMedia, (r) => r.at, "asc") : s.gallerySort === "best" ? sortBy(withMedia, (r) => r.pnl, "desc") : s.gallerySort === "worst" ? sortBy(withMedia, (r) => r.pnl, "asc") : sortBy(withMedia, (r) => r.at, "desc");
		if (!order.length) {
			root.createEl("p", { cls: "tradoshi-empty", text: lt("noMedia") });
			return;
		}
		const grid = root.createDiv({ cls: `tradoshi-gallery is-${s.gallerySize}` });
		for (const t of order) {
			const file = this.app.vault.getFileByPath(t.path);
			if (!(file instanceof TFile)) continue;
			const notes = mediaNotes(this.plugin);
			const media = mediaOf(this.app, file).filter((m) => !s.mediaTag || (notes[m.key]?.tags ?? []).includes(s.mediaTag));
			if (!media.length) continue;
			const card = grid.createDiv({ cls: "tradoshi-gallery-card" });
			const shot = card.createEl("button", { cls: "tradoshi-gallery-shot", attr: { "aria-label": t.symbol } });
			if (media[0].video) shot.createEl("video", { attr: { src: media[0].src, muted: "", preload: "metadata" } });
			else shot.createEl("img", { attr: { src: media[0].src, alt: media[0].name, loading: "lazy" } });
			if (media.length > 1) shot.createSpan({ cls: "tradoshi-gallery-count", text: `+${media.length - 1}` });
			shot.addEventListener("click", () => new MediaModal(this.app, media, 0, this.plugin, () => this.draw()).open());
			const firstTags = notes[media[0].key]?.tags ?? [];
			if (firstTags.length) {
				const chips = card.createDiv({ cls: "tradoshi-gallery-tags" });
				for (const x of firstTags) chips.createSpan({ cls: "tradoshi-tag", text: x });
			}
			const meta = card.createDiv({ cls: "tradoshi-gallery-meta" });
			const left = meta.createDiv();
			left.createDiv({ cls: "tradoshi-strong", text: `${t.symbol} ${lt(t.side)}` });
			left.createDiv({ cls: "tradoshi-muted tradoshi-small", text: `${dateLabel(t.at, { day: "numeric", month: "short", year: "2-digit" })} · ${t.account}` });
			meta.createDiv({ cls: `tradoshi-strong ${sign(t.pnl)}`, text: money(t.pnl, t.currency) });
			meta.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(file));
		}
	}
}

export async function openTradeLog(plugin: TradoshiPlugin): Promise<void> {
	const existing = plugin.app.workspace.getLeavesOfType(TRADE_LOG_VIEW)[0];
	const leaf = existing ?? plugin.app.workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: TRADE_LOG_VIEW, active: true });
	await plugin.app.workspace.revealLeaf(leaf);
}
