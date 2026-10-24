import { Modal, Setting, type App } from "obsidian";
import { t } from "./i18n";
import type TradoshiPlugin from "./main";
import { planName } from "./offer";
import { resolveLayout, type LayoutItem } from "./widgets/registry";

/** Which widgets the dashboard shows, and in which order. Saved at each change. */
export class CustomizeModal extends Modal {
	private items: LayoutItem[];

	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private readonly onChange: () => void,
	) {
		super(app);
		this.items = resolveLayout(plugin.settings.layout).map(({ widget, on }) => ({ id: widget.id, on }));
	}

	onOpen(): void {
		this.setTitle(t("customizeTitle"));
		this.draw();
	}

	private async save(): Promise<void> {
		this.plugin.settings.layout = this.items.map((x) => ({ ...x }));
		await this.plugin.saveSettings();
		this.onChange();
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		el.createEl("p", { cls: "setting-item-description", text: t("customizeHint") });
		// A widget of a paid plan carries its name, as on the pricing page.
		const titles = new Map(resolveLayout([]).map(({ widget }) => [widget.id, widget.plan ? `${widget.title()} · ${planName(widget.plan)}` : widget.title()]));
		this.items.forEach((item, i) => {
			new Setting(el)
				.setName(titles.get(item.id) ?? item.id)
				.addExtraButton((b) =>
					b
						.setIcon("arrow-up")
						.setTooltip(t("moveUp"))
						.setDisabled(i === 0)
						.onClick(() => this.move(i, -1)),
				)
				.addExtraButton((b) =>
					b
						.setIcon("arrow-down")
						.setTooltip(t("moveDown"))
						.setDisabled(i === this.items.length - 1)
						.onClick(() => this.move(i, 1)),
				)
				.addToggle((tg) =>
					tg.setValue(item.on).onChange((v) => {
						item.on = v;
						void this.save();
					}),
				);
		});
		new Setting(el).addButton((b) =>
			b.setButtonText(t("resetLayout")).onClick(() => {
				this.items = resolveLayout([]).map(({ widget, on }) => ({ id: widget.id, on }));
				void this.save().then(() => this.draw());
			}),
		);
	}

	private move(i: number, delta: number): void {
		const j = i + delta;
		if (j < 0 || j >= this.items.length) return;
		[this.items[i], this.items[j]] = [this.items[j], this.items[i]];
		void this.save().then(() => this.draw());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
