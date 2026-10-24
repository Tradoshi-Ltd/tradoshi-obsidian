import { Modal, Setting, type App } from "obsidian";
import { filterOptions, NO_FILTERS, type TradeFilters } from "./filters";
import { t } from "./i18n";
import type { DashData } from "./journal-data";

/** The dashboard filters: symbols, setups, tags to require or to leave out, side and outcome. */
export class FilterModal extends Modal {
	private f: TradeFilters;

	constructor(
		app: App,
		private readonly data: DashData,
		current: TradeFilters,
		private readonly onApply: (f: TradeFilters) => void,
	) {
		super(app);
		this.f = { ...current, symbols: [...current.symbols], setups: [...current.setups], tags: [...current.tags], excludeTags: [...current.excludeTags] };
	}

	onOpen(): void {
		this.setTitle(t("filters"));
		this.draw();
	}

	private chips(parent: HTMLElement, title: string, values: string[], selected: string[], prefix = ""): void {
		if (!values.length) return;
		parent.createDiv({ cls: "tradoshi-filter-title", text: title });
		const row = parent.createDiv({ cls: "tradoshi-filter-chips" });
		for (const v of values) {
			const on = selected.includes(v);
			const b = row.createEl("button", { cls: `tradoshi-chip${on ? " is-active" : ""}`, text: `${prefix}${v}`, attr: { "aria-pressed": String(on) } });
			b.addEventListener("click", () => {
				const i = selected.indexOf(v);
				if (i >= 0) selected.splice(i, 1);
				else selected.push(v);
				this.draw();
			});
		}
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		const options = filterOptions(this.data.trades, this.data.categories);
		new Setting(el).setName(t("side")).addDropdown((d) =>
			d
				.addOptions({ all: t("fAll"), long: t("long"), short: t("short") })
				.setValue(this.f.side)
				.onChange((v) => (this.f.side = v as TradeFilters["side"])),
		);
		new Setting(el).setName(t("result")).addDropdown((d) =>
			d
				.addOptions({ all: t("fAll"), win: t("fWins"), loss: t("fLosses") })
				.setValue(this.f.outcome)
				.onChange((v) => (this.f.outcome = v as TradeFilters["outcome"])),
		);
		this.chips(el, t("symbol"), options.symbols, this.f.symbols);
		this.chips(el, t("setups"), options.setups, this.f.setups);
		if (options.tags.length) {
			new Setting(el).setName(t("fTags")).addDropdown((d) =>
				d
					.addOptions({ any: t("fAny"), all: t("fEvery") })
					.setValue(this.f.tagMode)
					.onChange((v) => (this.f.tagMode = v as TradeFilters["tagMode"])),
			);
			this.chips(el, "", options.tags, this.f.tags, "#");
			this.chips(el, t("fExclude"), [...options.setups, ...options.tags], this.f.excludeTags, "#");
		}
		new Setting(el)
			.addButton((b) =>
				b.setButtonText(t("clearFilters")).onClick(() => {
					this.f = { ...NO_FILTERS, symbols: [], setups: [], tags: [], excludeTags: [] };
					this.draw();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText(t("apply"))
					.setCta()
					.onClick(() => {
						this.onApply(this.f);
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
