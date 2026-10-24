import type TradoshiPlugin from "../main";
import { loadDashData, type DashData } from "../journal-data";
import { tradingDay } from "../render";
import { mainCurrency } from "../stats";
import { normalizeChallenges, type PhaseNames } from "./profiles";
import { localDay, type Challenge } from "./rules";
import { sampleChallenges } from "./sample";
import { tr } from "./texts";

// Where the challenges live: the plugin data, under the module id. Every change goes
// through `saveChallenges`, which redraws the prop firm views and the dashboard.

export const MODULE_ID = "propfirm";
export const PROPFIRM_VIEW = "tradoshi-prop-firms";

export function savedChallenges(plugin: TradoshiPlugin): Challenge[] {
	return normalizeChallenges(plugin.moduleData<unknown>(MODULE_ID, { challenges: [] }));
}

const listeners = new Set<() => void>();

/** Called after every change of the challenges; returns the function that stops it. */
export function onChallengesChanged(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export async function saveChallenges(plugin: TradoshiPlugin, list: Challenge[]): Promise<void> {
	await plugin.saveModuleData(MODULE_ID, { challenges: list });
	for (const fn of listeners) fn();
	plugin.refreshDashboards();
}

/** Adds the challenge, or replaces the one with the same id. */
export async function upsertChallenge(plugin: TradoshiPlugin, c: Challenge): Promise<void> {
	const list = savedChallenges(plugin);
	const i = list.findIndex((x) => x.id === c.id);
	if (i >= 0) list[i] = c;
	else list.push(c);
	await saveChallenges(plugin, list);
}

export async function removeChallenge(plugin: TradoshiPlugin, id: string): Promise<void> {
	await saveChallenges(
		plugin,
		savedChallenges(plugin).filter((c) => c.id !== id),
	);
}

export function phaseNames(): PhaseNames {
	return { phase: (n) => tr("phaseN", { n }), funded: tr("fundedAccount") };
}

/** Today as a trading day of the journal: its time zone and the hour its days start. */
export function todayOf(plugin: TradoshiPlugin, sample: boolean, now: number = Date.now()): string {
	if (sample) return localDay(now);
	const s = plugin.settings;
	const ctx = { folder: "", appUrl: "", appLinks: false, tradeNotes: false, dailyNotes: false, timeZone: s.timeZone, dayStartHour: Number(s.dayStartHour) || 0 };
	try {
		return tradingDay(ctx, new Date(now).toISOString()) ?? localDay(now);
	} catch {
		return localDay(now);
	}
}

export interface Shown {
	challenges: Challenge[];
	/** The challenges are the example of the sample journal: nothing can be changed. */
	sample: boolean;
	today: string;
}

/** The trader's challenges, or the example ones on the sample journal when he has none yet. */
export function shownChallenges(plugin: TradoshiPlugin, data: DashData): Shown {
	const saved = savedChallenges(plugin);
	const today = todayOf(plugin, data.sample);
	if (saved.length || !data.sample) return { challenges: saved, sample: false, today };
	return { challenges: sampleChallenges(data.trades, phaseNames()), sample: true, today };
}

export function journalData(plugin: TradoshiPlugin): DashData {
	return loadDashData(plugin.app, plugin.isConnected(), plugin.settings.tagCategories);
}

/** The accounts of the journal, each with the currency most of its trades are in. */
export function accountsOf(data: DashData): { name: string; currency: string }[] {
	return data.accounts.map((name) => {
		const mine = data.trades.filter((t) => t.account === name);
		return { name, currency: mine.length ? mainCurrency(mine) : "USD" };
	});
}

export async function openPropFirms(plugin: TradoshiPlugin): Promise<void> {
	const { workspace } = plugin.app;
	const existing = workspace.getLeavesOfType(PROPFIRM_VIEW)[0];
	const leaf = existing ?? workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: PROPFIRM_VIEW, active: true });
	await workspace.revealLeaf(leaf);
}
