import { Modal, Setting, TFile, type App } from "obsidian";
import type TradoshiPlugin from "../main";
import { lt } from "./text";

// What the trade log does to several trades at once. It writes only the trader's own
// properties (`review_*`), which the sync never touches; a trade note it deletes is
// remembered by the plugin and not written again.

const today = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const filesOf = (app: App, paths: string[]): TFile[] => paths.map((p) => app.vault.getFileByPath(p)).filter((f): f is TFile => f instanceof TFile);

export async function setReviewed(app: App, paths: string[], reviewed: boolean): Promise<number> {
	const files = filesOf(app, paths);
	for (const f of files) {
		await app.fileManager.processFrontMatter(f, (front: Record<string, unknown>) => {
			if (reviewed) {
				front.review_done = true;
				front.review_date = typeof front.review_date === "string" ? front.review_date : today();
			} else {
				delete front.review_done;
				delete front.review_date;
			}
		});
	}
	return files.length;
}

/** Adds a tag of the trader's own to each trade; a setup or a mistake is filed in its category. */
export async function addOwnTag(plugin: TradoshiPlugin, paths: string[], name: string, category: "Setups" | "Mistakes" | null): Promise<number> {
	const tag = name.trim();
	if (!tag) return 0;
	if (category) {
		const cats = plugin.moduleData<Record<string, string>>("manual-tags", {});
		if (cats[tag] !== category) await plugin.saveModuleData("manual-tags", { ...cats, [tag]: category });
	}
	const files = filesOf(plugin.app, paths);
	for (const f of files) {
		await plugin.app.fileManager.processFrontMatter(f, (front: Record<string, unknown>) => {
			const have = Array.isArray(front.review_tags) ? front.review_tags.map(String) : [];
			if (!have.includes(tag)) front.review_tags = [...have, tag];
		});
	}
	return files.length;
}

export async function deleteNotes(app: App, paths: string[]): Promise<number> {
	const files = filesOf(app, paths);
	for (const f of files) await app.fileManager.trashFile(f);
	return files.length;
}

/** Asks for a name, with the names already used offered first. */
export class NamePrompt extends Modal {
	private value = "";

	constructor(
		app: App,
		private readonly title: string,
		private readonly suggestions: string[],
		private readonly onSubmit: (name: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		const id = `tradoshi-names-${Date.now()}`;
		new Setting(this.contentEl).setName(lt("tagPrompt")).addText((t) => {
			t.inputEl.setAttr("list", id);
			t.onChange((v) => (this.value = v));
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") this.submit();
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		const list = this.contentEl.createEl("datalist", { attr: { id } });
		for (const s of this.suggestions) list.createEl("option", { value: s });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(lt("cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(lt("save"))
					.setCta()
					.onClick(() => this.submit()),
			);
	}

	private submit(): void {
		if (!this.value.trim()) return;
		this.onSubmit(this.value.trim());
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly text: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("p", { text: this.text });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(lt("cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(lt("confirm"))
					.setDestructive()
					.onClick(() => {
						this.onConfirm();
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
