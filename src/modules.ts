import type { SettingDefinitionItem } from "obsidian";
import type TradoshiPlugin from "./main";
import { accountsModule } from "./accounts";
import { manualModule } from "./manual";
import { navModule } from "./nav/view";
import { reviewsModule } from "./reviews";
import { sessionModule } from "./session";
import { tradeCardModule } from "./tradecard";
import { tradeLogModule } from "./tradelog";
import { toolsModule } from "./widgets/tools";

// A module adds one family of features (prop firm rules, reviews, sessions, trade log…)
// without touching the plugin core: it registers its views, commands and code blocks in
// `load`, keeps its data under its own id (`plugin.moduleData`), and may add a group to
// the settings. New modules are listed in `modules()`.

/** A place of the plugin the trader can jump to: a view, a form, an action. */
export interface Place {
	id: string;
	label(): string;
	/** Lucide icon name, as Obsidian uses them. */
	icon: string;
	open(): void;
}

export interface PluginModule {
	id: string;
	load(plugin: TradoshiPlugin): void;
	/** Settings of the module, shown as their own group after the core ones. */
	settings?(plugin: TradoshiPlugin): SettingDefinitionItem[];
	/** Its views and actions, offered in the quick links and the navigation sidebar. */
	places?(plugin: TradoshiPlugin): Place[];
}

/**
 * Every module. A function, read when the plugin loads: modules import the plugin core,
 * which imports this file, and a list built at import time would hold empty slots.
 */
export function modules(): PluginModule[] {
	return [tradeCardModule, manualModule, tradeLogModule, accountsModule, toolsModule, navModule, reviewsModule, sessionModule];
}
