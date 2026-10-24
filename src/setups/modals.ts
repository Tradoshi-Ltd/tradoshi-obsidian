import { Modal, Notice, Setting, type App, type TFile } from "obsidian";
import { tradesLabel } from "../i18n";
import { linkTargetOf, STATUSES, type SetupMeta, type SetupStatus } from "./logic";
import { st, statusLabel } from "./text";

// The forms of the setups: a new setup, the properties of a sheet, and the choice of
// the setups to compare. A sheet is edited through its properties only; the playbook,
// the rules and the examples are written in the note itself.

const split = (s: string): string[] =>
	s
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean);

function buttons(el: HTMLElement, cancel: () => void, ok: string, submit: () => void): void {
	new Setting(el)
		.addButton((b) => b.setButtonText(st("cancel")).onClick(cancel))
		.addButton((b) =>
			b
				.setButtonText(ok)
				.setCta()
				.onClick(submit),
		);
}

/** Asks for the name of a new setup, the setups used on trades without a sheet offered first. */
export class NewSetupModal extends Modal {
	private name = "";
	private description = "";

	constructor(
		app: App,
		private readonly suggestions: string[],
		private readonly onSubmit: (name: string, description: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(st("newSetup"));
		this.contentEl.createEl("p", { cls: "setting-item-description", text: st("newSetupHint") });
		const id = `tradoshi-setup-names-${Date.now()}`;
		new Setting(this.contentEl)
			.setName(st("name"))
			.setDesc(st("nameDesc"))
			.addText((t) => {
				t.inputEl.setAttr("list", id);
				t.onChange((v) => (this.name = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") this.submit();
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		const list = this.contentEl.createEl("datalist", { attr: { id } });
		for (const s of this.suggestions) list.createEl("option", { value: s });
		new Setting(this.contentEl).setName(st("description")).addText((t) => t.setPlaceholder(st("descriptionHint")).onChange((v) => (this.description = v)));
		buttons(this.contentEl, () => this.close(), st("create"), () => this.submit());
	}

	private submit(): void {
		if (!this.name.trim()) return;
		this.onSubmit(this.name.trim(), this.description.trim());
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** The properties of a sheet: description, context, status, colour, other names, playbook note. */
export class EditSetupModal extends Modal {
	private description: string;
	private markets: string;
	private sessions: string;
	private timeframe: string;
	private status: SetupStatus;
	private color: string;
	private aliases: string;
	private playbook: string;

	constructor(
		app: App,
		private readonly file: TFile,
		private readonly meta: SetupMeta,
	) {
		super(app);
		this.description = meta.description;
		this.markets = meta.markets.join(", ");
		this.sessions = meta.sessions.join(", ");
		this.timeframe = meta.timeframe;
		this.status = meta.status;
		this.color = meta.color ?? "";
		this.aliases = meta.aliases.join(", ");
		this.playbook = meta.playbook ? `[[${meta.playbook}]]` : "";
	}

	onOpen(): void {
		this.setTitle(st("editTitle", { name: this.meta.name }));
		const el = this.contentEl;
		new Setting(el).setName(st("description")).addText((t) =>
			t
				.setPlaceholder(st("descriptionHint"))
				.setValue(this.description)
				.onChange((v) => (this.description = v)),
		);
		new Setting(el)
			.setName(st("markets"))
			.setDesc(st("marketsDesc"))
			.addText((t) =>
				t
					.setPlaceholder(st("marketsHint"))
					.setValue(this.markets)
					.onChange((v) => (this.markets = v)),
			);
		new Setting(el)
			.setName(st("sessions"))
			.setDesc(st("sessionsDesc"))
			.addText((t) => t.setValue(this.sessions).onChange((v) => (this.sessions = v)));
		new Setting(el)
			.setName(st("timeframe"))
			.setDesc(st("timeframeDesc"))
			.addText((t) =>
				t
					.setPlaceholder("M15")
					.setValue(this.timeframe)
					.onChange((v) => (this.timeframe = v)),
			);
		new Setting(el)
			.setName(st("status"))
			.setDesc(st("statusDesc"))
			.addDropdown((d) => {
				for (const s of STATUSES) d.addOption(s, statusLabel(s));
				d.setValue(this.status).onChange((v) => (this.status = v as SetupStatus));
			});
		const color = new Setting(el).setName(st("color")).setDesc(st("colorDesc"));
		color.addColorPicker((c) => {
			if (/^#[0-9a-f]{6}$/i.test(this.color)) c.setValue(this.color);
			c.onChange((v) => (this.color = v));
		});
		color.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip(st("colorReset"))
				.onClick(() => {
					this.color = "";
					new Notice(st("colorReset"));
				}),
		);
		new Setting(el)
			.setName(st("aliases"))
			.setDesc(st("aliasesDesc"))
			.addText((t) => t.setValue(this.aliases).onChange((v) => (this.aliases = v)));
		new Setting(el)
			.setName(st("playbookLink"))
			.setDesc(st("playbookLinkDesc"))
			.addText((t) =>
				t
					.setPlaceholder("[[…]]")
					.setValue(this.playbook)
					.onChange((v) => (this.playbook = v)),
			);
		buttons(el, () => this.close(), st("save"), () => void this.save());
	}

	private async save(): Promise<void> {
		const aliases = split(this.aliases);
		const playbook = this.playbook.trim();
		await this.app.fileManager.processFrontMatter(this.file, (front: Record<string, unknown>) => {
			front.description = this.description.trim();
			front.markets = split(this.markets);
			front.sessions = split(this.sessions);
			front.timeframe = this.timeframe.trim();
			front.status = this.status;
			front.color = this.color;
			if (aliases.length) front.aliases = aliases;
			else delete front.aliases;
			if (playbook) front.playbook = linkTargetOf(playbook) ? playbook : `[[${playbook}]]`;
			else delete front.playbook;
		});
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Two to four setups to put side by side. */
export class ComparePicker extends Modal {
	private chosen: string[];

	constructor(
		app: App,
		private readonly choices: { key: string; name: string; trades: number }[],
		chosen: string[],
		private readonly onPick: (keys: string[]) => void,
	) {
		super(app);
		this.chosen = chosen.filter((k) => choices.some((c) => c.key === k)).slice(0, 4);
	}

	onOpen(): void {
		this.setTitle(st("chooseSetups"));
		this.draw();
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		el.createEl("p", { cls: "setting-item-description", text: st("compareHint") });
		for (const c of this.choices) {
			const on = this.chosen.includes(c.key);
			new Setting(el)
				.setName(c.name)
				.setDesc(tradesLabel(c.trades))
				.addToggle((t) =>
					t
						.setValue(on)
						.setDisabled(!on && this.chosen.length >= 4)
						.onChange((v) => {
							this.chosen = v ? [...this.chosen, c.key] : this.chosen.filter((k) => k !== c.key);
							this.draw();
						}),
				);
		}
		new Setting(el)
			.addButton((b) => b.setButtonText(st("cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(st("compareGo"))
					.setCta()
					.setDisabled(this.chosen.length < 2)
					.onClick(() => {
						this.onPick(this.chosen);
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
