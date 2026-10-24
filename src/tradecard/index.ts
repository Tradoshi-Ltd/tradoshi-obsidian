import { Notice, TFile } from "obsidian";
import type { PluginModule } from "../modules";
import { neighbours, TradeCard } from "./card";
import { tc } from "./text";

/** The language of the code block that shows the card in a trade note. */
export const TRADE_CARD_BLOCK = "tradoshi-trade";

export const tradeCardModule: PluginModule = {
	id: "tradecard",
	load(plugin) {
		plugin.registerMarkdownCodeBlockProcessor(TRADE_CARD_BLOCK, (_source, el, ctx) => {
			ctx.addChild(new TradeCard(el, plugin, ctx.sourcePath));
		});

		const currentTrade = (): TFile | null => {
			const file = plugin.app.workspace.getActiveFile();
			const fm = file ? plugin.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
			return file && typeof fm?.tradoshi_id === "string" && typeof fm.pnl === "number" ? file : null;
		};
		plugin.addCommand({
			id: "mark-trade-reviewed",
			name: tc("cmdReviewed"),
			checkCallback: (checking) => {
				const file = currentTrade();
				if (!file) return false;
				if (!checking) {
					const d = new Date();
					const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
					void plugin.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
						front.review_done = true;
						front.review_date = day;
					});
				}
				return true;
			},
		});
		const open = (which: "prev" | "next"): ((checking: boolean) => boolean) => (checking) => {
			const file = currentTrade();
			if (!file) return false;
			if (checking) return true;
			const account: unknown = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.account;
			const target = neighbours(plugin.app, file.path, typeof account === "string" ? account : null)[which];
			const next = target ? plugin.app.vault.getFileByPath(target) : null;
			if (next instanceof TFile) void plugin.app.workspace.getLeaf(false).openFile(next);
			else new Notice(tc("nothingToShow"));
			return true;
		};
		plugin.addCommand({ id: "open-next-trade", name: tc("cmdNext"), checkCallback: open("next") });
		plugin.addCommand({ id: "open-previous-trade", name: tc("cmdPrevious"), checkCallback: open("prev") });
	},
};
