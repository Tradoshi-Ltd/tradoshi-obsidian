import { Modal, Notice, Setting, type App } from "obsidian";
import { num } from "./format";
import { language, locale, t } from "./i18n";
import { CSV_FIELDS, parseCsv, parseRows, parseMetaTrader, tradesFromCsv, type CsvField, type ParsedFile } from "./import-parsers";
import { readXlsx } from "./xlsx";
import type TradoshiPlugin from "./main";
import type { ApiTrade } from "./types";

const FIELD_LABELS: Record<CsvField, () => string> = {
	symbol: () => t("fieldSymbol"),
	side: () => t("fieldSide"),
	open: () => t("fieldOpen"),
	close: () => t("fieldClose"),
	entry: () => t("fieldEntry"),
	exit: () => t("fieldExit"),
	volume: () => t("fieldVolume"),
	pnl: () => t("fieldPnl"),
	gross: () => t("fieldGross"),
	commission: () => t("fieldCommission"),
	swap: () => t("fieldSwap"),
	stop: () => t("fieldStop"),
	target: () => t("fieldTarget"),
	id: () => t("fieldId"),
};

/** Without a Tradoshi account, a vault holds this many trades; a free account lifts the limit. */
export const FREE_IMPORT_LIMIT = 20;

/** Imports a broker statement read on this computer. Nothing leaves the vault. */
export class ImportModal extends Modal {
	private parsed: (ParsedFile & { rows?: string[][]; header?: number; mapping?: Partial<Record<CsvField, number>> }) | null = null;
	private trades: ApiTrade[] = [];
	private skipped = 0;
	private accountName = "";
	private currency = "USD";
	private resultEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t("importTitle"));
		const { contentEl } = this;
		contentEl.addClass("tradoshi-import");
		contentEl.createEl("p", { cls: "tradoshi-import-privacy", text: t("importPrivacy") });

		if (!this.plugin.isConnected()) {
			const left = this.room();
			contentEl.createEl("p", { cls: "tradoshi-import-limit", text: left > 0 ? t("importFreeLimit", { n: FREE_IMPORT_LIMIT }) : t("importFreeFull", { n: FREE_IMPORT_LIMIT }) });
			new Setting(contentEl).addButton((b) =>
				b
					.setButtonText(t("connect"))
					.setCta()
					.onClick(() => this.plugin.connect("import_limit")),
			);
			if (left <= 0) return;
		}

		// The native file field speaks the language of the system, not Obsidian's: a button of ours opens it.
		const input = contentEl.createEl("input", { cls: "tradoshi-import-input", attr: { type: "file", accept: ".htm,.html,.csv,.txt,.xlsx" } });
		const pick = contentEl.createDiv({ cls: "tradoshi-import-pick" });
		pick.createEl("button", { text: t("importPick") }).addEventListener("click", () => input.click());
		const chosen = pick.createSpan({ cls: "tradoshi-muted", text: t("importNoFile") });
		contentEl.createEl("p", { cls: "setting-item-description", text: t("importChoose") });
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (!file) return;
			chosen.setText(file.name);
			void this.read(file);
		});
		this.resultEl = contentEl.createDiv();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Trades this vault can still take without an account; no limit with one. */
	private room(): number {
		return this.plugin.isConnected() ? Infinity : Math.max(0, FREE_IMPORT_LIMIT - this.plugin.tradeNoteCount());
	}

	private async read(file: File): Promise<void> {
		try {
			if (/\.xlsx$/i.test(file.name)) {
				this.parsed = parseRows(await readXlsx(await file.arrayBuffer()), file.name, language() === "en");
			} else {
				const text = await file.text();
				this.parsed = /<html|<table/i.test(text.slice(0, 5000)) ? parseMetaTrader(text, file.name) : parseCsv(text, file.name, language() === "en");
			}
			this.trades = this.parsed.trades;
			this.skipped = Number(this.parsed.warnings.find((w) => w.startsWith("skipped:"))?.split(":")[1] ?? 0);
			this.accountName = this.parsed.account.name;
			// A MetaTrader report names its currency; a CSV rarely does, so the language of Obsidian gives the best guess.
			this.currency = this.parsed.format === "csv" ? { en: "USD", fr: "EUR", es: "EUR", pt: "BRL" }[language()] : this.parsed.account.currency;
			this.drawResult();
		} catch (e) {
			console.error("Tradoshi import failed", e);
			new Notice(`Tradoshi: ${t("importFailed")}`);
		}
	}

	private remap(field: CsvField, column: string): void {
		const p = this.parsed;
		if (!p?.rows || p.header === undefined || !p.mapping) return;
		if (column === "") delete p.mapping[field];
		else p.mapping[field] = Number(column);
		const r = tradesFromCsv(p.rows, p.header, p.mapping, language() === "en");
		this.trades = r.trades;
		this.skipped = r.skipped;
		this.drawResult();
	}

	private drawResult(): void {
		const el = this.resultEl;
		const p = this.parsed;
		if (!el || !p) return;
		el.empty();

		const dates = this.trades.map((x) => x.closeTime ?? x.openTime).filter((x): x is string => !!x).sort();
		const day = (iso: string): string => new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
		el.createEl("p", {
			cls: "tradoshi-import-summary",
			text: this.trades.length ? t("importFound", { n: this.trades.length, from: day(dates[0]), to: day(dates[dates.length - 1]) }) : t("importNone"),
		});
		if (this.skipped) el.createEl("p", { cls: "setting-item-description", text: t("importSkipped", { n: this.skipped }) });

		new Setting(el).setName(t("importAccount")).addText((x) =>
			x.setValue(this.accountName).onChange((v) => {
				this.accountName = v.trim();
			}),
		);
		new Setting(el).setName(t("importCurrency")).addText((x) =>
			x.setValue(this.currency).onChange((v) => {
				this.currency = v.trim().toUpperCase().slice(0, 3) || "USD";
			}),
		);

		if (p.format === "csv" && p.rows && p.header !== undefined && p.mapping) {
			new Setting(el).setName(t("importColumns")).setHeading();
			const headers = p.rows[p.header] ?? [];
			for (const field of CSV_FIELDS) {
				new Setting(el).setName(FIELD_LABELS[field]()).addDropdown((d) => {
					d.addOption("", t("noColumn"));
					headers.forEach((h, i) => {
						d.addOption(String(i), h || `#${i + 1}`);
					});
					d.setValue(p.mapping?.[field] !== undefined ? String(p.mapping[field]) : "");
					d.onChange((v) => this.remap(field, v));
				});
			}
		}

		if (this.trades.length) {
			const table = el.createEl("table", { cls: "tradoshi-import-preview" });
			for (const x of this.trades.slice(0, 5)) {
				const tr = table.createEl("tr");
				tr.createEl("td", { text: x.closeTime ? day(x.closeTime) : "" });
				tr.createEl("td", { text: x.symbol });
				tr.createEl("td", { text: t(x.side) });
				tr.createEl("td", { cls: x.pnl >= 0 ? "pos" : "neg", text: `${x.pnl > 0 ? "+" : ""}${num(x.pnl, 2)}` });
			}
		}

		// Without an account: the most recent trades, up to what the vault can still take.
		const room = this.room();
		const kept = room >= this.trades.length ? this.trades : [...this.trades].sort((a, b) => (b.closeTime ?? "").localeCompare(a.closeTime ?? "")).slice(0, room);
		if (kept.length < this.trades.length) el.createEl("p", { cls: "tradoshi-import-limit", text: t("importFreeCut", { n: kept.length, total: this.trades.length }) });

		new Setting(el).addButton((b) =>
			b
				.setButtonText(t("importDo", { n: kept.length }))
				.setCta()
				.setDisabled(!kept.length)
				.onClick(() => {
					b.setDisabled(true);
					void this.plugin
						.importTrades({ name: this.accountName || "Imported account", broker: p.account.broker, currency: this.currency }, kept)
						.then((n) => {
							new Notice(`Tradoshi: ${t("importDone", { n })}`);
							this.close();
						});
				}),
		);
	}
}
