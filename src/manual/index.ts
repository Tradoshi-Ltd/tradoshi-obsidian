import { Notice, type TFile } from "obsidian";
import type TradoshiPlugin from "../main";
import type { PluginModule } from "../modules";
import { ManualTradeModal } from "./modal";
import { mt } from "./text";

/** True for a trade that lives in the vault only (entered by hand, imported file): it can be edited here. */
export function editableHere(plugin: TradoshiPlugin, file: TFile | null): boolean {
	const id: unknown = file ? plugin.app.metadataCache.getFileCache(file)?.frontmatter?.tradoshi_id : null;
	return typeof id === "string" && id.startsWith("file-");
}

export function openManualTrade(plugin: TradoshiPlugin, file: TFile | null = null): void {
	new ManualTradeModal(plugin.app, plugin, file).open();
}

export const manualModule: PluginModule = {
	id: "manual",
	load(plugin) {
		plugin.addCommand({ id: "add-trade", name: mt("cmdAdd"), callback: () => openManualTrade(plugin) });
		plugin.addCommand({
			id: "edit-trade",
			name: mt("cmdEdit"),
			checkCallback: (checking) => {
				const file = plugin.app.workspace.getActiveFile();
				const id: unknown = file ? plugin.app.metadataCache.getFileCache(file)?.frontmatter?.tradoshi_id : null;
				if (typeof id !== "string") return false;
				if (checking) return true;
				if (editableHere(plugin, file)) openManualTrade(plugin, file);
				else new Notice(mt("notEditable"));
				return true;
			},
		});
	},
	places: (plugin) => [{ id: "add-trade", label: () => mt("titleAdd"), icon: "plus-circle", open: () => openManualTrade(plugin) }],
};
