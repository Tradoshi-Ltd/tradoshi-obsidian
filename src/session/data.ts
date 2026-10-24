import { language } from "../i18n";
import type TradoshiPlugin from "../main";
import { defaultChecklist, defaultLessonTag, defaultLogTags, starterGate } from "./defaults";
import type { Gate, GateStep } from "./gate";
import type { SessionRecord, SessionWindow } from "./logic";

// What session mode keeps in the plugin data: the trader's settings (windows,
// checklist, log tags, trade gates), the session under way, and the gate run in
// progress, so that closing Obsidian in the middle of a session loses nothing.
// Lists never edited follow the language of Obsidian.

export const SESSION_DATA = "session";

export interface SessionConfig {
	windows: SessionWindow[];
	/** Minutes of preparation before a window opens. */
	prepMinutes: number;
	checklist: string[] | null;
	tags: string[] | null;
	lessonTag: string | null;
	gates: Gate[] | null;
	/** The gate offered first. */
	gate: string | null;
	/** Trades of the journal shown in the session log. */
	tradeEvents: boolean;
}

export interface GateRun {
	gate: string;
	steps: GateStep[];
	/** The decision reached has been written to the log. */
	logged: boolean;
}

export interface SessionData {
	config: SessionConfig;
	current: SessionRecord | null;
	run: GateRun | null;
	/** Note of the last session written. */
	last: string | null;
}

const DEFAULT_CONFIG: SessionConfig = { windows: [], prepMinutes: 30, checklist: null, tags: null, lessonTag: null, gates: null, gate: null, tradeEvents: true };

export function sessionData(plugin: TradoshiPlugin): SessionData {
	const d = plugin.moduleData<Partial<SessionData>>(SESSION_DATA, {});
	return { config: { ...DEFAULT_CONFIG, ...(d.config ?? {}) }, current: d.current ?? null, run: d.run ?? null, last: d.last ?? null };
}

export async function saveSessionData(plugin: TradoshiPlugin, data: SessionData): Promise<void> {
	await plugin.saveModuleData(SESSION_DATA, data);
}

export const checklistOf = (c: SessionConfig): string[] => c.checklist ?? defaultChecklist(language());
export const tagsOf = (c: SessionConfig): string[] => (c.tags?.length ? c.tags : defaultLogTags(language()));
export const lessonTagOf = (c: SessionConfig): string => c.lessonTag ?? defaultLessonTag(language());
export const gatesOf = (c: SessionConfig): Gate[] => (c.gates?.length ? c.gates : [starterGate(language())]);

/** The gate offered first: the chosen one, or the first. */
export function defaultGate(c: SessionConfig): Gate {
	const gates = gatesOf(c);
	return gates.find((g) => g.id === c.gate) ?? gates[0];
}
