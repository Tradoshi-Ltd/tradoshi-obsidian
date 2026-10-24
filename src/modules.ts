import type { SettingDefinitionItem } from "obsidian";
import type TradoshiPlugin from "./main";
import { propFirmModule } from "./propfirm";

// A module adds one family of features (prop firm rules, reviews, sessions, trade log…)
// without touching the plugin core: it registers its views, commands and code blocks in
// `load`, keeps its data under its own id (`plugin.moduleData`), and may add a group to
// the settings. New modules are listed in MODULES.

export interface PluginModule {
	id: string;
	load(plugin: TradoshiPlugin): void;
	/** Settings of the module, shown as their own group after the core ones. */
	settings?(plugin: TradoshiPlugin): SettingDefinitionItem[];
}

export const MODULES: PluginModule[] = [propFirmModule];
