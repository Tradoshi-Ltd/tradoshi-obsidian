import { Modal, Notice, Setting, TFile, type App, type FrontMatterCache } from "obsidian";
import { money, num } from "../format";
import { tradesFromVault } from "../journal-data";
import type TradoshiPlugin from "../main";
import { fileAccountId } from "../sync";
import type { ApiTrade } from "../types";
import { figures, manualId, parseTyped, wallToUtc } from "./calc";
import { mt } from "./text";

const NEW = "\u0000new";
const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD", "BRL", "XOF", "USDT"];

interface ManualData {
	/** Value of one point, by symbol, as last typed. */
	pointValues: Record<string, number>;
	/** The account used last, offered first next time. */
	lastAccount: string | null;
}

interface Form {
	id: string | null;
	kind: "executed" | "missed" | "backtest";
	missedReason: string;
	account: string;
	newAccount: string;
	currency: string;
	broker: string | null;
	symbol: string;
	side: "long" | "short";
	opened: string;
	closed: string;
	entry: string;
	exit: string;
	size: string;
	pointValue: string;
	stopLoss: string;
	takeProfit: string;
	commission: string;
	swap: string;
	pnlTyped: boolean;
	pnl: string;
	emotion: string;
	plan: "unknown" | "yes" | "no";
	rating: string;
	setup: string;
	mistakes: string;
	tags: string;
}

const nowWall = (): string => {
	const d = new Date();
	const p = (n: number): string => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const str = (v: unknown): string => (typeof v === "number" ? String(v) : typeof v === "string" ? v : "");
const list = (s: string): string[] =>
	s
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean);

/** Adds a trade by hand, or edits one that lives in the vault only (hand entry, imported file). */
export class ManualTradeModal extends Modal {
	private f: Form;
	private readonly accounts: Map<string, { currency: string; broker: string | null }>;
	private readonly data: ManualData;
	private result: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		/** The trade note to edit; none to add a new trade. */
		private readonly editing: TFile | null = null,
	) {
		super(app);
		this.data = plugin.moduleData<ManualData>("manual", { pointValues: {}, lastAccount: null });
		this.accounts = new Map();
		for (const t of tradesFromVault(app)) if (!this.accounts.has(t.account)) this.accounts.set(t.account, { currency: t.currency, broker: t.broker });
		const first = this.data.lastAccount && this.accounts.has(this.data.lastAccount) ? this.data.lastAccount : [...this.accounts.keys()][0];
		this.f = {
			id: null,
			kind: "executed",
			missedReason: "",
			account: first ?? NEW,
			newAccount: first ? "" : "Manual",
			currency: (first && this.accounts.get(first)?.currency) || "USD",
			broker: (first && this.accounts.get(first)?.broker) || null,
			symbol: "",
			side: "long",
			opened: nowWall(),
			closed: nowWall(),
			entry: "",
			exit: "",
			size: "",
			pointValue: "1",
			stopLoss: "",
			takeProfit: "",
			commission: "",
			swap: "",
			pnlTyped: false,
			pnl: "",
			emotion: "",
			plan: "unknown",
			rating: "",
			setup: "",
			mistakes: "",
			tags: "",
		};
		const fm = editing ? app.metadataCache.getFileCache(editing)?.frontmatter : undefined;
		if (fm) this.fill(fm);
	}

	/** Puts an existing trade in the form. */
	private fill(fm: FrontMatterCache): void {
		const id = str(fm.tradoshi_id);
		const cats = this.plugin.tagCategories();
		const tags = Array.isArray(fm.tradoshi_tags) ? fm.tradoshi_tags.map(String) : [];
		const symbol = str(fm.symbol);
		const pv = this.data.pointValues[symbol];
		Object.assign(this.f, {
			id: id.slice(id.indexOf("/") + 1),
			kind: fm.trade_type === "missed" || fm.trade_type === "backtest" ? (fm.trade_type as Form["kind"]) : "executed",
			missedReason: str(fm.missed_reason),
			account: str(fm.account),
			currency: str(fm.currency) || "USD",
			broker: str(fm.broker) || null,
			symbol,
			side: fm.side === "short" ? "short" : "long",
			opened: str(fm.opened) || str(fm.closed),
			closed: str(fm.closed) || str(fm.opened),
			entry: str(fm.entry),
			exit: str(fm.exit),
			size: str(fm.volume),
			pointValue: String(pv ?? 1),
			stopLoss: str(fm.stop_loss),
			takeProfit: str(fm.take_profit),
			commission: str(fm.commission),
			swap: str(fm.swap),
			// Without a known point value, the P&L of the note is kept as it is.
			pnlTyped: pv === undefined,
			pnl: str(fm.pnl),
			emotion: str(fm.emotion),
			plan: fm.followed_plan === true ? "yes" : fm.followed_plan === false ? "no" : "unknown",
			rating: str(fm.rating),
			setup: tags.filter((t) => (cats[t] ?? "").toLowerCase() === "setups").join(", "),
			mistakes: tags.filter((t) => (cats[t] ?? "").toLowerCase() === "mistakes").join(", "),
			tags: tags.filter((t) => !["setups", "mistakes"].includes((cats[t] ?? "").toLowerCase())).join(", "),
		});
		if (!this.accounts.has(this.f.account)) this.accounts.set(this.f.account, { currency: this.f.currency, broker: this.f.broker });
	}

	onOpen(): void {
		this.setTitle(this.editing ? mt("titleEdit") : mt("titleAdd"));
		this.modalEl.addClass("tradoshi-manual");
		if (!this.plugin.isConnected()) {
			this.contentEl.createEl("p", { text: mt("needsAccount") });
			new Setting(this.contentEl).addButton((b) =>
				b
					.setButtonText(mt("connect"))
					.setCta()
					.onClick(() => window.open(this.plugin.signupLink("manual_trade"))),
			);
			return;
		}
		this.draw();
	}

	private text(parent: HTMLElement, name: string, key: keyof Form, opts: { desc?: string; type?: string; placeholder?: string } = {}): void {
		new Setting(parent)
			.setName(name)
			.setDesc(opts.desc ?? "")
			.addText((t) => {
				if (opts.type) t.inputEl.type = opts.type;
				if (opts.placeholder) t.setPlaceholder(opts.placeholder);
				t.setValue(String(this.f[key] ?? "")).onChange((v) => {
					(this.f as unknown as Record<string, string>)[key] = v;
					this.update();
				});
			});
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		el.createEl("p", { cls: "setting-item-description", text: mt("intro") });

		new Setting(el)
			.setName(mt("type"))
			.setDesc(mt("typeDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ executed: mt("executed"), missed: mt("missed"), backtest: mt("backtest") })
					.setValue(this.f.kind)
					.onChange((v) => {
						this.f.kind = v as Form["kind"];
						this.draw();
					}),
			);
		if (this.f.kind === "missed") this.text(el, mt("missedReason"), "missedReason");

		const account = new Setting(el).setName(mt("account")).addDropdown((d) => {
			for (const name of this.accounts.keys()) d.addOption(name, name);
			d.addOption(NEW, mt("newAccount"));
			d.setValue(this.f.account).onChange((v) => {
				this.f.account = v;
				const a = this.accounts.get(v);
				if (a) {
					this.f.currency = a.currency;
					this.f.broker = a.broker;
				}
				this.draw();
			});
			// An edited trade stays in its account: moving it would leave a copy behind.
			d.setDisabled(!!this.editing);
		});
		account.addDropdown((d) => {
			const options = new Set([...CURRENCIES, this.f.currency]);
			for (const c of options) d.addOption(c, c);
			d.setValue(this.f.currency).onChange((v) => {
				this.f.currency = v;
				this.update();
			});
			d.setDisabled(!!this.editing || this.f.account !== NEW);
		});
		if (this.f.account === NEW) this.text(el, mt("accountName"), "newAccount");

		new Setting(el)
			.setName(mt("symbol"))
			.addText((t) =>
				t.setValue(this.f.symbol).onChange((v) => {
					this.f.symbol = v.trim().toUpperCase();
					const pv = this.data.pointValues[this.f.symbol];
					if (pv !== undefined && !this.f.pnlTyped) this.f.pointValue = String(pv);
					this.update();
				}),
			)
			.addDropdown((d) =>
				d
					.addOptions({ long: mt("long"), short: mt("short") })
					.setValue(this.f.side)
					.onChange((v) => {
						this.f.side = v as Form["side"];
						this.update();
					}),
			);
		this.text(el, mt("opened"), "opened", { type: "datetime-local" });
		this.text(el, mt("closed"), "closed", { type: "datetime-local", desc: mt("timeZoneNote", { tz: this.plugin.settings.timeZone }) });

		new Setting(el).setName(mt("prices")).setHeading();
		this.text(el, mt("entry"), "entry");
		this.text(el, mt("exit"), "exit");
		this.text(el, mt("size"), "size");
		this.text(el, mt("pointValue"), "pointValue", { desc: mt("pointValueDesc") });
		this.text(el, mt("stopLoss"), "stopLoss");
		this.text(el, mt("takeProfit"), "takeProfit");
		this.text(el, mt("commission"), "commission", { desc: mt("costsDesc") });
		this.text(el, mt("swap"), "swap");
		new Setting(el).setName(mt("pnlTyped")).addToggle((tg) =>
			tg.setValue(this.f.pnlTyped).onChange((v) => {
				this.f.pnlTyped = v;
				this.draw();
			}),
		);
		if (this.f.pnlTyped) this.text(el, mt("pnl"), "pnl");
		this.result = el.createDiv({ cls: "tradoshi-manual-result" });

		new Setting(el).setName(mt("review")).setHeading();
		this.text(el, mt("emotion"), "emotion");
		new Setting(el).setName(mt("plan")).addDropdown((d) =>
			d
				.addOptions({ unknown: mt("unknown"), yes: mt("yes"), no: mt("no") })
				.setValue(this.f.plan)
				.onChange((v) => (this.f.plan = v as Form["plan"])),
		);
		this.text(el, mt("rating"), "rating");
		this.text(el, mt("setup"), "setup");
		this.text(el, mt("mistakes"), "mistakes", { desc: mt("mistakesDesc") });
		this.text(el, mt("otherTags"), "tags", { desc: mt("mistakesDesc") });

		new Setting(el)
			.addButton((b) => b.setButtonText(mt("cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(mt("save"))
					.setCta()
					.onClick(() => void this.save()),
			);
		this.update();
	}

	private compute(): ReturnType<typeof figures> {
		return figures({
			side: this.f.side,
			entry: parseTyped(this.f.entry),
			exit: parseTyped(this.f.exit),
			volume: parseTyped(this.f.size),
			pointValue: parseTyped(this.f.pointValue) ?? 1,
			stopLoss: parseTyped(this.f.stopLoss),
			commission: parseTyped(this.f.commission) ?? 0,
			swap: parseTyped(this.f.swap) ?? 0,
			pnlTyped: this.f.pnlTyped ? parseTyped(this.f.pnl) : null,
		});
	}

	/** The figures as they will be saved, under the prices. */
	private update(): void {
		if (!this.result) return;
		const c = this.compute();
		this.result.empty();
		if (c.pnl === null) {
			this.result.setText(mt("cannotCompute"));
			this.result.removeClass("pos", "neg");
			return;
		}
		this.result.setText(
			mt("computed", {
				pnl: money(c.pnl, this.f.currency, 2),
				risk: c.risk === null ? "–" : money(c.risk, this.f.currency, 2).replace(/^\+/, ""),
				r: c.r === null ? "– R" : `${c.r > 0 ? "+" : ""}${num(c.r)} R`,
			}),
		);
		this.result.toggleClass("pos", c.pnl > 0);
		this.result.toggleClass("neg", c.pnl < 0);
	}

	private async save(): Promise<void> {
		const c = this.compute();
		const name = this.f.account === NEW ? this.f.newAccount.trim() : this.f.account;
		const tz = this.plugin.settings.timeZone;
		const openTime = this.f.opened ? wallToUtc(this.f.opened, tz) : null;
		const closeTime = (this.f.closed ? wallToUtc(this.f.closed, tz) : null) ?? openTime;
		if (!this.f.symbol || !name || !closeTime || c.pnl === null) {
			new Notice(mt("missing"));
			return;
		}
		const setups = list(this.f.setup);
		const mistakes = list(this.f.mistakes);
		const rating = parseTyped(this.f.rating);
		const trade: ApiTrade = {
			id: this.f.id ?? manualId(),
			symbol: this.f.symbol,
			side: this.f.side,
			openTime: openTime ?? closeTime,
			closeTime,
			entryPrice: parseTyped(this.f.entry),
			exitPrice: parseTyped(this.f.exit),
			volume: parseTyped(this.f.size),
			pnl: c.pnl,
			commission: parseTyped(this.f.commission) ?? 0,
			swap: parseTyped(this.f.swap) ?? 0,
			stopLoss: parseTyped(this.f.stopLoss),
			takeProfit: parseTyped(this.f.takeProfit),
			riskAmount: c.risk,
			rMultiple: c.r,
			emotion: this.f.emotion.trim() || null,
			rating: rating === null ? null : Math.max(0, Math.min(5, rating)),
			followedPlan: this.f.plan === "yes" ? true : this.f.plan === "no" ? false : null,
			reviewNote: null,
			tags: [...setups, ...mistakes, ...list(this.f.tags)],
			kind: this.f.kind === "executed" ? undefined : this.f.kind,
			missedReason: this.f.kind === "missed" ? this.f.missedReason.trim() || null : null,
		};
		// The categories of the tags typed here, so the dashboard sorts them like Tradoshi's.
		const cats = this.plugin.moduleData<Record<string, string>>("manual-tags", {});
		for (const s of setups) cats[s] = "Setups";
		for (const m of mistakes) cats[m] = "Mistakes";
		await this.plugin.saveModuleData("manual-tags", cats);
		const pv = parseTyped(this.f.pointValue);
		if (pv !== null && !this.f.pnlTyped) this.data.pointValues[trade.symbol] = pv;
		this.data.lastAccount = name;
		await this.plugin.saveModuleData("manual", this.data);

		await this.plugin.saveManualTrades({ name, broker: this.f.broker, currency: this.f.currency }, [trade]);
		new Notice(mt("saved"));
		this.close();
		// The note is indexed a moment after it is written: then it opens.
		const key = `trade:${fileAccountId(name)}/${trade.id}`;
		window.setTimeout(() => {
			const path = this.plugin.pathForKey(key);
			const file = path ? this.app.vault.getFileByPath(path) : null;
			if (file instanceof TFile && !this.editing) void this.app.workspace.getLeaf("tab").openFile(file);
		}, 1200);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
