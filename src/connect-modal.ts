import { Modal, Setting, type App } from "obsidian";

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
		this.setTitle("Connect to Tradoshi");
		this.contentEl.createEl("p", {
			text: `Tradoshi will write your trading journal into the "${this.folder}" folder of this vault, as Markdown notes you own. The access token can only read your journal.`,
		});
		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText("Connect")
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
