import { MarkdownView, Platform, type Plugin, type TFile } from "obsidian";

const TRIES = 20;
const TRY_EVERY_MS = 50;

/**
 * On a phone, a trade note opens on its card: its long list of properties is folded once, when
 * the note is opened, with Obsidian's own fold. Tapping "Properties" opens it again.
 */
export function foldTradePropertiesOnPhone(plugin: Plugin): void {
	if (!Platform.isPhone) return;
	plugin.registerEvent(
		plugin.app.workspace.on("file-open", (file) => {
			if (file && isTradeNote(plugin, file)) foldWhenShown(plugin, file, 0);
		}),
	);
}

/** A trade note carries both the day it belongs to and its symbol. */
function isTradeNote(plugin: Plugin, file: TFile): boolean {
	const properties = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
	return !!properties && properties.trading_day !== undefined && properties.symbol !== undefined;
}

/** Waits for the properties block of the note to be shown, then folds it. */
function foldWhenShown(plugin: Plugin, file: TFile, tries: number): void {
	const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view || view.file !== file) return;
	const block = Array.from(view.containerEl.querySelectorAll<HTMLElement>(".metadata-container")).find((el) => el.offsetParent !== null);
	const heading = block?.querySelector<HTMLElement>(".metadata-properties-heading");
	if (block && heading) {
		if (!block.hasClass("is-collapsed")) heading.click();
		return;
	}
	if (tries < TRIES) window.setTimeout(() => foldWhenShown(plugin, file, tries + 1), TRY_EVERY_MS);
}
