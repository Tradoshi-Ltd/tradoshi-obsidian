import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { amount, colon, compactAmount, dateLabel, money, num, pctSign, percent, sign } from "../format";
import { loadDashData, type DashData } from "../journal-data";
import type TradoshiPlugin from "../main";
import { lineChart, tiles } from "../widgets/charts";
import { accountSettings, AccountSettingsModal } from "./settings";
import { accountFigures, aumCurve, type AccountFigures, type AccountSettings } from "./stats";
import { at } from "./text";

export const ACCOUNTS_VIEW = "tradoshi-accounts";

interface Row {
	figures: AccountFigures;
	settings: AccountSettings;
}

/** A small line of the balance, without axes, for an account card. */
export function sparkline(parent: HTMLElement, values: number[], label: string): void {
	if (values.length < 2) return;
	const W = 240, H = 48;
	const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
	const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`).join(" ");
	const up = values[values.length - 1] >= values[0];
	const svg = parent.createSvg("svg", { cls: ["tradoshi-spark", up ? "is-gain" : "is-loss"], attr: { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": label } });
	svg.createSvg("polyline", { attr: { points: pts } });
}

export class AccountsView extends ItemView {
	private selected: string | null = null;
	private showHidden = false;
	private data: DashData | null = null;
	private tipEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TradoshiPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return ACCOUNTS_VIEW;
	}

	getDisplayText(): string {
		return at("title");
	}

	getIcon(): string {
		return "wallet";
	}

	async onOpen(): Promise<void> {
		this.refresh();
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.refresh()));
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	refresh(): void {
		this.data = loadDashData(this.app, this.plugin.isConnected(), this.plugin.tagCategories());
		this.draw();
	}

	private rows(): Row[] {
		const data = this.data;
		if (!data) return [];
		return data.accounts.map((name) => {
			const settings = accountSettings(this.plugin, name, data.sample);
			return { settings, figures: accountFigures(name, data.trades, settings) };
		});
	}

	private tip = {
		tip: (e: MouseEvent, lines: string[]): void => {
			if (!this.tipEl) return;
			this.tipEl.empty();
			for (const l of lines) this.tipEl.createDiv({ text: l });
			const box = this.contentEl.getBoundingClientRect();
			this.tipEl.setCssProps({ "--x": `${e.clientX - box.left + this.contentEl.scrollLeft + 14}px`, "--y": `${e.clientY - box.top + this.contentEl.scrollTop + 14}px` });
			this.tipEl.addClass("is-visible");
		},
		hideTip: (): void => this.tipEl?.removeClass("is-visible"),
	};

	private draw(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("tradoshi-dash", "tradoshi-accounts");
		const rows = this.rows();
		const row = this.selected ? rows.find((r) => r.figures.name === this.selected) : undefined;
		if (row) this.drawDetail(root, row);
		else this.drawList(root, rows);
		this.tipEl = root.createDiv({ cls: "tradoshi-tip" });
	}

	private drawList(root: HTMLElement, rows: Row[]): void {
		const head = root.createDiv({ cls: "tradoshi-head" });
		head.createEl("h2", { text: at("title") });
		if (this.data?.sample) root.createEl("p", { cls: "tradoshi-note", text: at("sampleNote") });
		if (!rows.length) {
			root.createEl("p", { cls: "tradoshi-empty", text: at("noAccounts") });
			return;
		}
		const visible = rows.filter((r) => this.showHidden || !r.settings.hidden);

		// Assets under management: the accounts with a starting balance, in their main currency.
		const known = visible.filter((r) => r.settings.initial !== null && r.settings.type !== "demo" && r.settings.type !== "backtest");
		if (known.length) {
			const count = new Map<string, number>();
			for (const r of known) count.set(r.figures.currency, (count.get(r.figures.currency) ?? 0) + 1);
			const currency = [...count].sort((a, b) => b[1] - a[1])[0][0];
			const same = known.filter((r) => r.figures.currency === currency);
			const total = same.reduce((s, r) => s + (r.figures.balance ?? 0), 0);
			const start = same.reduce((s, r) => s + (r.settings.initial ?? 0), 0);
			const card = root.createDiv({ cls: "tradoshi-card tradoshi-aum" });
			const h = card.createDiv({ cls: "tradoshi-card-title" });
			h.createSpan({ text: at("aum") });
			h.createSpan({ cls: "tradoshi-card-extra", text: at("aumHint", { c: currency }) });
			const big = card.createDiv({ cls: "tradoshi-aum-total" });
			big.createSpan({ text: amount(total, currency) });
			big.createSpan({ cls: `tradoshi-aum-change ${sign(total - start)}`, text: ` ${money(total - start, currency)}${start ? ` (${num(((total - start) / start) * 100, 1)}${pctSign()})` : ""}` });
			const curve = aumCurve(
				same.map((r) => ({ figures: r.figures, initial: r.settings.initial ?? 0 })),
				currency,
			);
			if (curve.length > 1) {
				lineChart(
					card,
					this.tip,
					curve.map((p) => ({ at: p.at, value: p.value, tip: [dateLabel(p.at, { day: "numeric", month: "short", year: "numeric" }), amount(p.value, currency, 2)] })),
					{ label: at("aum"), currency, height: 260, base: start, formatAxis: (x) => compactAmount(x, currency), refs: [{ value: start, label: at("start") }], firstLast: (ms) => dateLabel(ms, { day: "numeric", month: "short" }) },
				);
			}
		}

		const grid = root.createDiv({ cls: "tradoshi-account-grid" });
		for (const r of visible) this.drawCard(grid, r);
		const hidden = rows.filter((r) => r.settings.hidden).length;
		if (hidden && !this.showHidden) {
			root.createEl("button", { cls: "tradoshi-link-button", text: at("showHidden", { n: hidden }) }).addEventListener("click", () => {
				this.showHidden = true;
				this.draw();
			});
		}
	}

	private drawCard(grid: HTMLElement, r: Row): void {
		const f = r.figures;
		const card = grid.createDiv({ cls: "tradoshi-card tradoshi-account-card", attr: { tabindex: "0", role: "button", "aria-label": f.name } });
		const top = card.createDiv({ cls: "tradoshi-account-top" });
		const id = top.createDiv();
		id.createDiv({ cls: "tradoshi-strong", text: f.name });
		id.createDiv({ cls: "tradoshi-muted tradoshi-small", text: [at(r.settings.type), f.broker].filter(Boolean).join(" · ") });
		const gear = top.createEl("button", { cls: "clickable-icon", attr: { "aria-label": at("settings") } });
		setIcon(gear, "settings");
		gear.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openSettings(f);
		});
		const value = card.createDiv({ cls: "tradoshi-account-value" });
		if (f.balance !== null) {
			value.createSpan({ cls: "tradoshi-strong", text: amount(f.balance, f.currency) });
			if (f.returnPct !== null) value.createSpan({ cls: `tradoshi-small ${sign(f.returnPct)}`, text: ` ${f.returnPct > 0 ? "+" : ""}${num(f.returnPct, 1)}${pctSign()}` });
		} else {
			value.createSpan({ cls: `tradoshi-strong ${sign(f.net)}`, text: money(f.net, f.currency) });
		}
		sparkline(card, f.curve.map((p) => p.value), f.name);
		const facts = card.createDiv({ cls: "tradoshi-account-facts" });
		const fact = (label: string, text: string, cls = ""): void => {
			const d = facts.createDiv();
			d.createDiv({ cls: "tradoshi-muted tradoshi-small", text: label });
			d.createDiv({ cls, text });
		};
		fact(at("winRate"), f.winRate === null ? "–" : percent(f.winRate));
		fact(at("profitFactor"), f.profitFactor === null ? "–" : num(f.profitFactor));
		fact(at("maxDd"), f.maxDrawdownPct !== null ? `-${num(f.maxDrawdownPct, 1)}${pctSign()}` : f.maxDrawdown ? money(-f.maxDrawdown, f.currency) : "–", f.maxDrawdown ? "neg" : "");
		fact(at("trades"), String(f.trades));
		if (r.settings.target !== null) this.targetBar(card, f, r.settings.target);
		if (f.last) card.createDiv({ cls: "tradoshi-muted tradoshi-small", text: `${at("lastTrade")}${colon()}${dateLabel(f.last, { day: "numeric", month: "short", year: "numeric" })}` });
		const open = (): void => {
			this.selected = f.name;
			this.draw();
		};
		card.addEventListener("click", open);
		card.addEventListener("keydown", (e) => {
			if (e.key === "Enter") open();
		});
	}

	private targetBar(parent: HTMLElement, f: AccountFigures, target: number): void {
		const pct = target > 0 ? Math.max(0, Math.min(100, (f.net / target) * 100)) : 0;
		const wrap = parent.createDiv({ cls: "tradoshi-target" });
		const bar = wrap.createDiv({ cls: "tradoshi-target-track" }).createDiv({ cls: `tradoshi-target-fill${f.net >= target ? " is-done" : ""}` });
		bar.setCssProps({ "--w": `${pct}%` });
		wrap.createDiv({ cls: "tradoshi-small tradoshi-muted", text: f.net >= target ? at("targetReached") : at("targetLeft", { v: amount(target - f.net, f.currency) }) });
	}

	private openSettings(f: AccountFigures): void {
		if (this.data?.sample) return;
		new AccountSettingsModal(this.app, this.plugin, f.name, f.currency, () => this.refresh()).open();
	}

	private drawDetail(root: HTMLElement, r: Row): void {
		const f = r.figures;
		const nav = root.createDiv({ cls: "tradoshi-head" });
		nav.createEl("button", { text: `‹ ${at("back")}` }).addEventListener("click", () => {
			this.selected = null;
			this.draw();
		});
		const title = nav.createDiv({ cls: "tradoshi-account-title" });
		title.createEl("h2", { text: f.name });
		title.createDiv({ cls: "tradoshi-muted", text: [at(r.settings.type), f.broker, f.currency].filter(Boolean).join(" · ") });
		if (!this.data?.sample) nav.createEl("button", { text: at("settings") }).addEventListener("click", () => this.openSettings(f));
		if (r.settings.initial === null) root.createEl("p", { cls: "tradoshi-note", text: at("noInitial") });

		tiles(root, [
			{ label: at("balance"), value: f.balance === null ? "–" : amount(f.balance, f.currency) },
			{ label: at("net"), value: money(f.net, f.currency), tone: sign(f.net) },
			{ label: at("returnPct"), value: f.returnPct === null ? "–" : `${f.returnPct > 0 ? "+" : ""}${num(f.returnPct, 1)}${pctSign()}`, tone: sign(f.returnPct ?? 0) },
			{ label: at("winRate"), value: f.winRate === null ? "–" : percent(f.winRate) },
			{ label: at("profitFactor"), value: f.profitFactor === null ? "–" : num(f.profitFactor) },
			{ label: at("maxDd"), value: f.maxDrawdown ? money(-f.maxDrawdown, f.currency) : "–", sub: f.maxDrawdownPct === null ? undefined : `-${num(f.maxDrawdownPct, 1)}${pctSign()}`, tone: f.maxDrawdown ? "neg" : "" },
			{ label: at("currentDd"), value: f.currentDrawdown ? money(-f.currentDrawdown, f.currency) : "–", tone: f.currentDrawdown ? "neg" : "" },
			{ label: at("trades"), value: String(f.trades), sub: f.last ? dateLabel(f.last, { day: "numeric", month: "short" }) : undefined },
		]);
		if (r.settings.target !== null) this.targetBar(root, f, r.settings.target);

		const card = root.createDiv({ cls: "tradoshi-card" });
		card.createDiv({ cls: "tradoshi-card-title", text: r.settings.initial === null ? at("net") : at("balance") });
		const refs: { value: number; label: string; tone?: "gain" | "loss" | "muted" }[] = [];
		if (r.settings.initial !== null) refs.push({ value: r.settings.initial, label: at("start") });
		if (r.settings.target !== null) refs.push({ value: (r.settings.initial ?? 0) + r.settings.target, label: at("target"), tone: "gain" });
		lineChart(
			card,
			this.tip,
			f.curve.map((p) => ({ at: p.at, value: p.value, tip: [dateLabel(p.at, { weekday: "short", day: "numeric", month: "short" }), amount(p.value, f.currency, 2)] })),
			{ label: f.name, currency: f.currency, base: r.settings.initial ?? 0, refs, formatAxis: r.settings.initial === null ? undefined : (x) => compactAmount(x, f.currency), firstLast: (ms) => dateLabel(ms, { day: "numeric", month: "short", year: "2-digit" }) },
		);
	}
}
