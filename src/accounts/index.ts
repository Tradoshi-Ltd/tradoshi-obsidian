import type TradoshiPlugin from "../main";
import type { PluginModule } from "../modules";
import { at } from "./text";
import { ACCOUNTS_VIEW, AccountsView } from "./view";

export async function openAccounts(plugin: TradoshiPlugin): Promise<void> {
	const existing = plugin.app.workspace.getLeavesOfType(ACCOUNTS_VIEW)[0];
	const leaf = existing ?? plugin.app.workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: ACCOUNTS_VIEW, active: true });
	await plugin.app.workspace.revealLeaf(leaf);
}

export const accountsModule: PluginModule = {
	id: "accounts",
	load(plugin) {
		plugin.registerView(ACCOUNTS_VIEW, (leaf) => new AccountsView(leaf, plugin));
		plugin.addCommand({ id: "open-accounts", name: at("cmdOpen"), callback: () => void openAccounts(plugin) });
	},
	places: (plugin) => [{ id: "accounts", label: () => at("title"), icon: "wallet", open: () => void openAccounts(plugin) }],
};
