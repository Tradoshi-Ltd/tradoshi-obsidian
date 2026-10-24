import type TradoshiPlugin from "../main";
import type { PluginModule } from "../modules";
import { showable } from "../offer";
import { ChallengeModal } from "./modals";
import { MODULE_ID, openPropFirms, PROPFIRM_VIEW } from "./store";
import { tr } from "./texts";
import { PropFirmView } from "./view";

// Prop firm challenges: the view, its commands and its settings. The rules live in
// rules.ts, the firm profiles in profiles.ts, the dashboard widgets in widgets.ts.
// Nothing runs at import: everything happens in `load`. Challenge tracking is part of
// the Pro plan: without it, every entry opens the view, which says so.

const newChallenge = (plugin: TradoshiPlugin): void => {
	if (showable(plugin, "pro")) new ChallengeModal(plugin.app, plugin, null).open();
	else void openPropFirms(plugin);
};

export const propFirmModule: PluginModule = {
	id: MODULE_ID,
	load(plugin: TradoshiPlugin) {
		plugin.registerView(PROPFIRM_VIEW, (leaf) => new PropFirmView(leaf, plugin));
		plugin.addCommand({
			id: "open-prop-firms",
			name: tr("cmdOpen"),
			callback: () => void openPropFirms(plugin),
		});
		plugin.addCommand({
			id: "new-prop-challenge",
			name: tr("cmdNew"),
			callback: () => newChallenge(plugin),
		});
	},
	places: (plugin) => [
		{ id: "prop-firms", label: () => tr("viewTitle"), icon: "trophy", open: () => void openPropFirms(plugin) },
		{ id: "new-challenge", label: () => tr("cmdNew"), icon: "flag", open: () => newChallenge(plugin) },
	],
	settings(plugin: TradoshiPlugin) {
		return [
			{
				type: "group",
				heading: tr("viewTitle"),
				items: [
					{ name: tr("cmdOpen"), desc: tr("setOpenDesc"), action: () => void openPropFirms(plugin) },
					{ name: tr("cmdNew"), desc: tr("setNewDesc"), action: () => newChallenge(plugin) },
				],
			},
		];
	},
};
