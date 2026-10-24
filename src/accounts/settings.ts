import { Modal, Setting, type App } from "obsidian";
import type TradoshiPlugin from "../main";
import { SAMPLE_ACCOUNTS } from "../sample-data";
import { parseTyped } from "../manual/calc";
import { DEFAULT_ACCOUNT, type AccountSettings, type AccountType } from "./stats";
import { at } from "./text";

export const ACCOUNTS_DATA = "accounts";

/** The settings of every account the trader has set, by account name. */
export function savedAccounts(plugin: TradoshiPlugin): Record<string, AccountSettings> {
	return plugin.moduleData<Record<string, AccountSettings>>(ACCOUNTS_DATA, {});
}

/** The settings of one account; the sample accounts come with their own. */
export function accountSettings(plugin: TradoshiPlugin, name: string, sample: boolean): AccountSettings {
	if (sample) {
		const s = SAMPLE_ACCOUNTS.find((a) => a.name === name);
		const type: AccountType = /challenge/i.test(name) ? "challenge" : /funded/i.test(name) ? "funded" : "live";
		return { ...DEFAULT_ACCOUNT, type, initial: s?.initial ?? null, target: type === "challenge" && s?.initial ? s.initial * 0.1 : null };
	}
	return { ...DEFAULT_ACCOUNT, ...(savedAccounts(plugin)[name] ?? {}) };
}

export class AccountSettingsModal extends Modal {
	private s: AccountSettings;

	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private readonly name: string,
		private readonly currency: string,
		private readonly onSaved: () => void,
	) {
		super(app);
		this.s = accountSettings(plugin, name, false);
	}

	onOpen(): void {
		this.setTitle(at("settingsTitle", { name: this.name }));
		const el = this.contentEl;
		new Setting(el).setName(at("type")).addDropdown((d) =>
			d
				.addOptions({ live: at("live"), demo: at("demo"), challenge: at("challenge"), funded: at("funded"), backtest: at("backtest") })
				.setValue(this.s.type)
				.onChange((v) => (this.s.type = v as AccountType)),
		);
		new Setting(el)
			.setName(`${at("initial")} (${this.currency})`)
			.setDesc(at("initialDesc"))
			.addText((t) => t.setValue(this.s.initial === null ? "" : String(this.s.initial)).onChange((v) => (this.s.initial = parseTyped(v))));
		new Setting(el)
			.setName(`${at("target")} (${this.currency})`)
			.setDesc(at("targetDesc"))
			.addText((t) => t.setValue(this.s.target === null ? "" : String(this.s.target)).onChange((v) => (this.s.target = parseTyped(v))));
		new Setting(el)
			.setName(at("hidden"))
			.setDesc(at("hiddenDesc"))
			.addToggle((tg) => tg.setValue(this.s.hidden).onChange((v) => (this.s.hidden = v)));
		new Setting(el)
			.addButton((b) => b.setButtonText(at("cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(at("save"))
					.setCta()
					.onClick(() => {
						void (async () => {
							const all = { ...savedAccounts(this.plugin), [this.name]: this.s };
							await this.plugin.saveModuleData(ACCOUNTS_DATA, all);
							this.onSaved();
							this.plugin.refreshDashboards();
							this.close();
						})();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
