import { Modal, Notice, Setting, type App } from "obsidian";
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
			contentEl.createEl("p", { text: t("importNeedsAccount") });
			new Setting(contentEl).addButton((b) =>
				b
					.setButtonText(t("connect"))
					.setCta()
					.onClick(() => window.open(this.plugin.signupLink("import"))),
			);
			return;
		}

		const input = contentEl.createEl("input", { attr: { type: "file", accept: ".htm,.html,.csv,.txt,.xlsx" } });
		contentEl.createEl("p", { cls: "setting-item-description", text: t("importChoose") });
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (file) void this.read(file);
		});
		this.resultEl = contentEl.createDiv();
	}

	onClose(): void {
		this.contentEl.empty();
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
				tr.createEl("td", { cls: x.pnl >= 0 ? "pos" : "neg", text: x.pnl.toFixed(2) });
			}
		}

		new Setting(el).addButton((b) =>
			b
				.setButtonText(t("importDo", { n: this.trades.length }))
				.setCta()
				.setDisabled(!this.trades.length)
				.onClick(() => {
					b.setDisabled(true);
					void this.plugin
						.importTrades({ name: this.accountName || "Imported account", broker: p.account.broker, currency: this.currency }, this.trades)
						.then((n) => {
							new Notice(`Tradoshi: ${t("importDone", { n })}`);
							this.close();
						});
				}),
		);
	}
}
