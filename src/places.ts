import { Notice, TFile } from "obsidian";
import type TradoshiPlugin from "./main";
import { modules, type Place } from "./modules";
import { appLink } from "./render";
import { renderContext } from "./sync";
import { wt } from "./widgets/tools-text";

const todayKey = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Every place of the plugin: the core ones, then those of each module. */
export function allPlaces(plugin: TradoshiPlugin): Place[] {
	const core: Place[] = [
		{ id: "dashboard", label: () => wt("dashboard"), icon: "tradoshi", open: () => void plugin.openDashboard() },
		{ id: "import", label: () => wt("importStatement"), icon: "file-up", open: () => plugin.openImport() },
		{ id: "sync", label: () => wt("sync"), icon: "refresh-cw", open: () => void plugin.sync(true) },
		{
			id: "today",
			label: () => wt("today"),
			icon: "calendar-check",
			open: () => {
				const path = plugin.pathForKey(`day:${todayKey()}`);
				const file = path ? plugin.app.vault.getFileByPath(path) : null;
				if (file instanceof TFile) void plugin.app.workspace.getLeaf(false).openFile(file);
				else new Notice(wt("noToday"));
			},
		},
		{ id: "overview", label: () => wt("overview"), icon: "layout-list", open: () => void plugin.openOverview() },
		{ id: "web-app", label: () => wt("webApp"), icon: "external-link", open: () => window.open(appLink(renderContext(plugin.settings), "quick_link")) },
	];
	return [...core, ...modules().flatMap((m) => m.places?.(plugin) ?? [])];
}
