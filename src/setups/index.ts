import { Notice, TFile } from "obsidian";
import type TradoshiPlugin from "../main";
import type { PluginModule } from "../modules";
import { SetupBlock } from "./block";
import { norm, SHEET_BLOCK } from "./logic";
import { NewSetupModal } from "./modals";
import { createSheet, setupMetas, SetupLinker, sheetPaths } from "./sheets";
import { st } from "./text";
import { openSetups, SETUPS_VIEW, SetupsView } from "./view";

// Setups and their playbooks: the view, the sheet of each setup (a note with its
// properties, playbook, rules and examples, and its figures at the top), the link from
// each trade note to the sheet of its setup, and the commands. The figures live in
// logic.ts, the dashboard widget in widget.ts. Nothing runs at import.

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim() ? [v] : []);

/** Asks for a name, writes the sheet and opens it. */
function newSetup(plugin: TradoshiPlugin): void {
	const metas = setupMetas(plugin.app, false);
	const named = new Set(metas.flatMap((m) => [norm(m.name), ...m.aliases.map(norm)]));
	const cats = plugin.tagCategories();
	const without = Object.entries(cats)
		.filter(([tag, cat]) => cat.toLowerCase() === "setups" && !named.has(norm(tag)))
		.map(([tag]) => tag)
		.sort((a, b) => a.localeCompare(b));
	new NewSetupModal(plugin.app, without, (name, description) => {
		const existing = sheetPaths(plugin.app).get(norm(name));
		const file = existing ? plugin.app.vault.getFileByPath(existing) : null;
		if (file) {
			new Notice(st("sheetExists", { name }));
			void plugin.app.workspace.getLeaf("tab").openFile(file);
			return;
		}
		void createSheet(plugin, name, description)
			.then((f) => plugin.app.workspace.getLeaf("tab").openFile(f))
			.catch((e) => {
				console.error("Tradoshi: setup sheet", e);
				new Notice(st("sheetFailed"));
			});
	}).open();
}

/** The linker of each loaded plugin, for the command and the settings. */
const linkers = new WeakMap<TradoshiPlugin, SetupLinker>();

/** Checks the link of every trade note to its setup sheet now, and says how many changed. */
function linkAll(plugin: TradoshiPlugin): void {
	const linker = linkers.get(plugin);
	if (!linker) return;
	if (!plugin.isConnected()) {
		new Notice(st("nSample"));
		return;
	}
	linker.everything();
	void linker.flush().then((n) => new Notice(n ? st("nLinked", { n }) : st("nLinkedNone")));
}

/** The sheet of the setup of the trade note open, when it has one. */
function sheetOfActiveTrade(plugin: TradoshiPlugin): TFile | null {
	const file = plugin.app.workspace.getActiveFile();
	const fm = file ? plugin.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
	if (!file || typeof fm?.tradoshi_id !== "string") return null;
	const sheets = sheetPaths(plugin.app);
	for (const tag of [...strings(fm.tradoshi_tags), ...strings(fm.review_tags)]) {
		const path = sheets.get(norm(tag));
		const sheet = path ? plugin.app.vault.getFileByPath(path) : null;
		if (sheet) return sheet;
	}
	return null;
}

export const setupsModule: PluginModule = {
	id: "setups",
	load(plugin) {
		plugin.registerView(SETUPS_VIEW, (leaf) => new SetupsView(leaf, plugin));
		plugin.registerMarkdownCodeBlockProcessor(SHEET_BLOCK, (_source, el, ctx) => {
			ctx.addChild(new SetupBlock(el, plugin, ctx.sourcePath));
		});

		// Trade notes keep a link to the sheet of their setup, written a moment after they change.
		const linker = new SetupLinker(plugin);
		linkers.set(plugin, linker);
		plugin.register(() => {
			linker.cancel();
			linkers.delete(plugin);
		});
		plugin.registerEvent(
			plugin.app.metadataCache.on("changed", (file, _data, cache) => {
				const fm = cache.frontmatter;
				if (typeof fm?.tradoshi_id === "string") linker.trade(file.path);
				else if (fm?.tradoshi_setup === true || fm?.tradoshi_setup === "true") linker.sheetsChanged();
			}),
		);
		plugin.registerEvent(
			plugin.app.metadataCache.on("deleted", (_file, prev) => {
				if (prev?.frontmatter?.tradoshi_setup) linker.sheetsChanged();
			}),
		);
		plugin.registerEvent(plugin.app.vault.on("rename", () => linker.sheetsChanged()));
		plugin.app.workspace.onLayoutReady(() => linker.everything());

		plugin.addCommand({ id: "open-setups", name: st("cmdOpen"), callback: () => void openSetups(plugin) });
		plugin.addCommand({ id: "new-setup", name: st("cmdNew"), callback: () => newSetup(plugin) });
		plugin.addCommand({ id: "compare-setups", name: st("cmdCompare"), callback: () => void openSetups(plugin, { kind: "compare", keys: [] }) });
		plugin.addCommand({
			id: "open-trade-setup",
			name: st("cmdOpenTradeSetup"),
			checkCallback: (checking) => {
				const sheet = sheetOfActiveTrade(plugin);
				if (!sheet) return false;
				if (!checking) void plugin.app.workspace.getLeaf(false).openFile(sheet);
				return true;
			},
		});
		plugin.addCommand({ id: "link-setup-sheets", name: st("cmdLink"), callback: () => linkAll(plugin) });
	},
	places: (plugin) => [
		{ id: "setups", label: () => st("title"), icon: "layers", open: () => void openSetups(plugin) },
		{ id: "new-setup", label: () => st("newSetup"), icon: "file-plus", open: () => newSetup(plugin) },
	],
	settings(plugin) {
		return [
			{
				type: "group",
				heading: st("title"),
				items: [
					{ name: st("cmdOpen"), desc: st("setOpenDesc"), action: () => void openSetups(plugin) },
					{ name: st("cmdNew"), desc: st("setNewDesc"), action: () => newSetup(plugin) },
					{ name: st("cmdLink"), desc: st("setLinkDesc"), action: () => linkAll(plugin) },
				],
			},
		];
	},
};
