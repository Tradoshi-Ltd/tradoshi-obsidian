import { FuzzySuggestModal, MarkdownRenderer, Modal, Notice, Setting, setIcon, TFile, type App } from "obsidian";
import { accountSettings } from "../accounts/settings";
import { accountFigures, positionSize } from "../accounts/stats";
import { amount, dateLabel, money, num, sign } from "../format";
import { tradesFromVault } from "../journal-data";
import type TradoshiPlugin from "../main";
import { parseTyped } from "../manual/calc";
import type { PluginModule } from "../modules";
import { allPlaces } from "../places";
import { mainCurrency } from "../stats";
import { wt } from "./tools-text";
import { cardTitle, emptyCard, type Widget } from "./types";

// Widgets that help the routine rather than measure it: what is left to review, the
// size of the next position, the places the trader goes to most, a note kept in view.

export const unreviewedWidget: Widget = {
	id: "unreviewed",
	title: () => wt("unreviewed"),
	size: "narrow",
	defaultOn: true,
	render(card, ctx) {
		const todo = ctx.trades.filter((t) => !t.reviewed).sort((a, b) => a.at - b.at);
		cardTitle(card, wt("unreviewed"), todo.length ? String(todo.length) : undefined);
		if (!todo.length) {
			emptyCard(card, wt("allReviewed"));
			return;
		}
		card.createEl("p", { cls: "tradoshi-muted tradoshi-small", text: `${wt("unreviewedCount", { n: todo.length })} ${wt("reviewHint")}` });
		const list = card.createDiv({ cls: "tradoshi-review-list" });
		for (const t of todo.slice(0, 5)) {
			const row = list.createEl("button", { cls: "tradoshi-review-row" });
			row.createSpan({ text: `${dateLabel(t.at, { day: "2-digit", month: "2-digit" })} · ${t.symbol}` });
			row.createSpan({ cls: `tradoshi-num ${sign(t.pnl)}`, text: money(t.pnl, t.currency, 2) });
			row.disabled = !t.path;
			row.addEventListener("click", () => void ctx.openPath(t.path));
		}
		const first = todo.find((t) => t.path);
		if (first) card.createEl("button", { cls: "mod-cta", text: wt("reviewOldest") }).addEventListener("click", () => void ctx.openPath(first.path));
	},
};

interface SizingData {
	riskPct: string;
	pointValue: string;
}

/** The calculator itself, drawn in a card or in a window. */
function drawCalculator(parent: HTMLElement, plugin: TradoshiPlugin, balance: number | null, currency: string): void {
	const saved = plugin.moduleData<SizingData>("position-size", { riskPct: "1", pointValue: "1" });
	const v = { balance: balance === null ? "" : String(Math.round(balance * 100) / 100), riskPct: saved.riskPct, entry: "", stop: "", pointValue: saved.pointValue };
	const out = parent.createDiv({ cls: "tradoshi-ps-result" });
	const update = (): void => {
		const b = parseTyped(v.balance);
		const r = parseTyped(v.riskPct);
		const e = parseTyped(v.entry);
		const s = parseTyped(v.stop);
		const pv = parseTyped(v.pointValue) ?? 1;
		out.empty();
		if (b === null || r === null || e === null || s === null) {
			out.setText(wt("psNeed"));
			return;
		}
		const res = positionSize({ balance: b, riskPct: r, entry: e, stop: s, pointValue: pv });
		out.createDiv({ cls: "tradoshi-ps-size", text: wt("psResult", { size: res.size === null ? "–" : num(res.size, res.size < 10 ? 2 : 0) }) });
		out.createDiv({ cls: "tradoshi-muted", text: wt("psRiskAmount", { risk: amount(res.risk, currency, 2) }) });
	};
	const field = (label: string, key: keyof typeof v, remember?: keyof SizingData): void => {
		new Setting(parent).setName(label).addText((t) =>
			t.setValue(v[key]).onChange((x) => {
				v[key] = x;
				if (remember) void plugin.saveModuleData("position-size", { ...saved, [remember]: x });
				update();
			}),
		);
	};
	field(`${wt("psBalance")} (${currency})`, "balance");
	field(wt("psRisk"), "riskPct", "riskPct");
	field(wt("psEntry"), "entry");
	field(wt("psStop"), "stop");
	field(wt("psPoint"), "pointValue", "pointValue");
	parent.appendChild(out);
	update();
}

export class PositionSizeModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private readonly balance: number | null,
		private readonly currency: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(wt("positionSize"));
		drawCalculator(this.contentEl, this.plugin, this.balance, this.currency);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export const positionSizeWidget: Widget = {
	id: "position-size",
	title: () => wt("positionSize"),
	size: "narrow",
	defaultOn: false,
	render(card, ctx) {
		cardTitle(card, wt("positionSize"));
		// The balance of the account shown, when its starting balance is set.
		const account = ctx.all[0]?.account;
		const one = account && ctx.all.every((t) => t.account === account) ? account : null;
		let balance: number | null = null;
		if (one) {
			const s = accountSettings(ctx.plugin, one, ctx.data.sample);
			balance = accountFigures(one, ctx.data.trades, s).balance;
		}
		drawCalculator(card.createDiv({ cls: "tradoshi-ps" }), ctx.plugin, balance, ctx.currency);
	},
};

interface QuickLinksData {
	hidden: string[];
}

class QuickLinksModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private readonly onChange: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(wt("chooseLinks"));
		const data = this.plugin.moduleData<QuickLinksData>("quick-links", { hidden: [] });
		for (const p of allPlaces(this.plugin)) {
			new Setting(this.contentEl).setName(p.label()).addToggle((tg) =>
				tg.setValue(!data.hidden.includes(p.id)).onChange((on) => {
					data.hidden = on ? data.hidden.filter((x) => x !== p.id) : [...data.hidden, p.id];
					void this.plugin.saveModuleData("quick-links", data).then(() => this.onChange());
				}),
			);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export const quickLinksWidget: Widget = {
	id: "quick-links",
	title: () => wt("quickLinks"),
	size: "full",
	defaultOn: true,
	render(card, ctx) {
		card.addClass("tradoshi-quick-card");
		const data = ctx.plugin.moduleData<QuickLinksData>("quick-links", { hidden: [] });
		const row = card.createDiv({ cls: "tradoshi-quick-links" });
		for (const p of allPlaces(ctx.plugin).filter((x) => !data.hidden.includes(x.id))) {
			const b = row.createEl("button", { cls: "tradoshi-quick-link" });
			setIcon(b.createSpan({ cls: "tradoshi-quick-icon" }), p.icon);
			b.createSpan({ text: p.label() });
			b.addEventListener("click", () => p.open());
		}
		const gear = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": wt("chooseLinks") } });
		setIcon(gear, "settings-2");
		gear.addEventListener("click", () => new QuickLinksModal(ctx.app, ctx.plugin, () => ctx.redraw()).open());
	},
};

class NotePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onPick: (f: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(wt("pinPlaceholder"));
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(f: TFile): string {
		return f.path;
	}

	onChooseItem(f: TFile): void {
		this.onPick(f);
	}
}

export const pinnedNoteWidget: Widget = {
	id: "pinned-note",
	title: () => wt("pinned"),
	size: "narrow",
	defaultOn: false,
	render(card, ctx) {
		const data = ctx.plugin.moduleData<{ path: string | null }>("pinned-note", { path: null });
		const head = cardTitle(card, wt("pinned"));
		const pick = (): void =>
			new NotePicker(ctx.app, (f) => {
				void ctx.plugin.saveModuleData("pinned-note", { path: f.path }).then(() => ctx.redraw());
			}).open();
		const change = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": wt("pinChange") } });
		setIcon(change, "pin");
		change.addEventListener("click", pick);
		const file = data.path ? ctx.app.vault.getFileByPath(data.path) : null;
		if (!file) {
			emptyCard(card, data.path ? wt("pinMissing") : wt("pinNone"));
			card.createEl("button", { text: wt("pinChoose") }).addEventListener("click", pick);
			return;
		}
		const body = card.createDiv({ cls: "tradoshi-pinned markdown-rendered" });
		const title = body.createEl("a", { cls: "tradoshi-strong", text: file.basename });
		title.addEventListener("click", () => void ctx.openPath(file.path));
		void ctx.app.vault.cachedRead(file).then((text) => MarkdownRenderer.render(ctx.app, text.replace(/^---[\s\S]*?---\n?/, ""), body.createDiv(), file.path, ctx.component));
	},
};

export const TOOL_WIDGETS: Widget[] = [quickLinksWidget, unreviewedWidget, positionSizeWidget, pinnedNoteWidget];

/** The position size calculator from the command palette, in the currency most trades are in. */
export function openPositionSize(plugin: TradoshiPlugin): void {
	const trades = tradesFromVault(plugin.app);
	new PositionSizeModal(plugin.app, plugin, null, trades.length ? mainCurrency(trades) : "USD").open();
}

/** Privacy mode: amounts, figures and charts blurred, for a screenshot or a stream. */
function applyPrivacy(plugin: TradoshiPlugin, doc: Document): void {
	doc.body.toggleClass("tradoshi-privacy", plugin.moduleData<boolean>("privacy", false));
}

async function togglePrivacy(plugin: TradoshiPlugin): Promise<void> {
	const on = !plugin.moduleData<boolean>("privacy", false);
	await plugin.saveModuleData("privacy", on);
	applyPrivacy(plugin, activeDocument);
	new Notice(on ? wt("privacyOn") : wt("privacyOff"));
}

export const toolsModule: PluginModule = {
	id: "tools",
	load(plugin) {
		plugin.addCommand({ id: "open-position-size", name: wt("cmdPositionSize"), callback: () => openPositionSize(plugin) });
		plugin.addCommand({ id: "toggle-privacy", name: wt("cmdPrivacy"), callback: () => void togglePrivacy(plugin) });
		plugin.app.workspace.onLayoutReady(() => applyPrivacy(plugin, activeDocument));
		plugin.registerEvent(plugin.app.workspace.on("window-open", (win) => applyPrivacy(plugin, win.doc)));
		plugin.register(() => activeDocument.body.removeClass("tradoshi-privacy"));
	},
	places: (plugin) => [
		{ id: "position-size", label: () => wt("positionSize"), icon: "calculator", open: () => openPositionSize(plugin) },
		{ id: "privacy", label: () => wt("privacy"), icon: "eye-off", open: () => void togglePrivacy(plugin) },
	],
};
