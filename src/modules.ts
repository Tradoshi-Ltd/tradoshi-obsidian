import type { SettingDefinitionItem } from "obsidian";
import type TradoshiPlugin from "./main";
import { manualModule } from "./manual";
import { tradeCardModule } from "./tradecard";

// A module adds one family of features (prop firm rules, reviews, sessions, trade log…)
// without touching the plugin core: it registers its views, commands and code blocks in
// `load`, keeps its data under its own id (`plugin.moduleData`), and may add a group to
// the settings. New modules are listed in `modules()`.

export interface PluginModule {
	id: string;
	load(plugin: TradoshiPlugin): void;
	/** Settings of the module, shown as their own group after the core ones. */
	settings?(plugin: TradoshiPlugin): SettingDefinitionItem[];
}

/**
 * Every module. A function, read when the plugin loads: modules import the plugin core,
 * which imports this file, and a list built at import time would hold empty slots.
 */
export function modules(): PluginModule[] {
	return [tradeCardModule, manualModule];
}
