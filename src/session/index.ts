import { colon } from "../format";
import type TradoshiPlugin from "../main";
import type { PluginModule } from "../modules";
import { allows, offerEvents } from "../offer";
import { sessionHooks } from "../reviews/day-card";
import { closeSession, endSession, goLive, restartGate, sessionEvents } from "./actions";
import { defaultGate, gatesOf, saveSessionData, sessionData } from "./data";
import { GateEditorModal } from "./gate-ui";
import { clock, liveTime } from "./logic";
import { SessionSettingsModal } from "./settings-modal";
import { st } from "./text";
import { askNote, askUnplanned, clockStatus, openSessionView, SESSION_VIEW, SessionView } from "./view";

// Session mode: a sidebar view that follows a trading session from its preparation to
// its review, a status bar item that shows it is running, and the commands to drive
// it from the keyboard. It is part of the Premium plan: without it, every entry opens
// the view, which says so.

const premium = (plugin: TradoshiPlugin): boolean => allows(plugin, "premium");

/** The status bar: the session under way, or the trading window that is open. */
function statusBar(plugin: TradoshiPlugin): void {
	const item = plugin.addStatusBarItem();
	item.addClass("tradoshi-sv-status");
	item.addEventListener("click", () => void openSessionView(plugin));
	const draw = (): void => {
		const s = sessionData(plugin).current;
		item.empty();
		item.removeClass("is-live", "is-prep", "is-break");
		if (!premium(plugin)) return;
		if (s && s.phase !== "ended") {
			item.addClass(`is-${s.phase}`);
			item.setText(s.phase === "prep" ? `◔ ${st("phasePrep")}` : s.phase === "break" ? `❚❚ ${st("phaseBreak")}` : `● ${clock(liveTime(s, Date.now()))}`);
			item.setAttr("aria-label", `${st("title")}${colon()}${s.window ?? st("unplanned")}`);
			return;
		}
		const w = clockStatus(plugin);
		if (w.phase === "live" && w.window) {
			item.addClass("is-prep");
			item.setText(`○ ${w.window.name}`);
			item.setAttr("aria-label", st("windowOpenNoSession"));
		} else if (w.phase === "prep" && w.window) {
			item.addClass("is-prep");
			item.setText(`◔ ${w.window.name} ${clock((w.minutes ?? 0) * 60000)}`);
			item.setAttr("aria-label", st("statusPrep"));
		}
	};
	draw();
	sessionEvents.add(draw);
	offerEvents.add(draw);
	plugin.register(() => {
		sessionEvents.delete(draw);
		offerEvents.delete(draw);
	});
	plugin.registerInterval(window.setInterval(draw, 30000));
}

export const sessionModule: PluginModule = {
	id: "session",
	load(plugin) {
		plugin.registerView(SESSION_VIEW, (leaf) => new SessionView(leaf, plugin));
		sessionHooks.open = () => void openSessionView(plugin);
		plugin.register(() => (sessionHooks.open = null));
		plugin.app.workspace.onLayoutReady(() => statusBar(plugin));

		plugin.addCommand({ id: "open-session-mode", name: st("cmdOpen"), callback: () => void openSessionView(plugin) });
		plugin.addCommand({
			id: "start-session",
			name: st("cmdStart"),
			checkCallback: (checking) => {
				const s = sessionData(plugin).current;
				if (s && s.phase !== "prep" && s.phase !== "ended") return false;
				if (!checking && !premium(plugin)) void openSessionView(plugin);
				else if (!checking) {
					const w = clockStatus(plugin);
					if (s?.phase === "prep" || (w.phase === "live" && w.window)) void goLive(plugin, w.window?.name ?? null).then(() => openSessionView(plugin));
					else askUnplanned(plugin, true);
				}
				return true;
			},
		});
		plugin.addCommand({ id: "start-unplanned-session", name: st("cmdUnplanned"), callback: () => (premium(plugin) ? askUnplanned(plugin, true) : void openSessionView(plugin)) });
		plugin.addCommand({
			id: "end-session",
			name: st("cmdEnd"),
			checkCallback: (checking) => {
				const s = sessionData(plugin).current;
				if (!s) return false;
				if (!checking) void (s.phase === "ended" ? closeSession(plugin) : endSession(plugin));
				return true;
			},
		});
		plugin.addCommand({
			id: "add-session-note",
			name: st("cmdNote"),
			checkCallback: (checking) => {
				if (!sessionData(plugin).current || !premium(plugin)) return false;
				if (!checking) askNote(plugin);
				return true;
			},
		});
		plugin.addCommand({
			id: "run-trade-gate",
			name: st("cmdGate"),
			checkCallback: (checking) => {
				const s = sessionData(plugin).current;
				if (!s || s.phase !== "live" || !premium(plugin)) return false;
				if (!checking) void restartGate(plugin, defaultGate(sessionData(plugin).config).id).then(() => openSessionView(plugin));
				return true;
			},
		});
		plugin.addCommand({
			id: "edit-trade-gate",
			name: st("cmdEditGate"),
			callback: () => {
				if (!premium(plugin)) return void openSessionView(plugin);
				const gate = defaultGate(sessionData(plugin).config);
				new GateEditorModal(plugin.app, gate, (saved) => {
					const data = sessionData(plugin);
					const list = gatesOf(data.config);
					data.config.gates = list.some((g) => g.id === saved.id) ? list.map((g) => (g.id === saved.id ? saved : g)) : [...list, saved];
					void saveSessionData(plugin, data).then(() => sessionEvents.forEach((f) => f()));
				}).open();
			},
		});
	},
	settings: (plugin) => [
		{
			type: "group",
			heading: st("title"),
			items: [
				{ name: st("settingsTitle"), desc: st("settingsDesc"), action: () => (premium(plugin) ? new SessionSettingsModal(plugin.app, plugin, () => sessionEvents.forEach((f) => f())).open() : void openSessionView(plugin)) },
				{ name: st("cmdOpen"), action: () => void openSessionView(plugin) },
			],
		},
	],
	places: (plugin) => [{ id: "session-mode", label: () => st("title"), icon: "timer", open: () => void openSessionView(plugin) }],
};
