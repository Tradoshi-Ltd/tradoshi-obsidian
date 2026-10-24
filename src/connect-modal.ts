import { Modal, Setting, type App } from "obsidian";
import { t } from "./i18n";

/** Asks before a link from the Tradoshi app connects this vault to a journal. */
export class ConnectModal extends Modal {
	constructor(
		app: App,
		private readonly folder: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t("connectTitle"));
		this.contentEl.createEl("p", {
			text: t("connectText", { folder: this.folder }),
		});
		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText(t("connectButton"))
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			)
			.addButton((b) => b.setButtonText(t("cancel")).onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
