import { Notice } from "obsidian";
import type TradoshiPlugin from "../main";
import { todayOf } from "../reviews/vault";
import { checklistOf, gatesOf, saveSessionData, sessionData, type SessionData } from "./data";
import { pathLabels, runGate, type GateStep } from "./gate";
import type { LogEntry, SessionRecord } from "./logic";
import { st } from "./text";
import { writeSession } from "./write";

// What a trader does in a session: prepare, go live, take a break, write a note, run
// the trade gate, end, close. Each action saves the session at once and tells the
// open views and the status bar to redraw.

/** Redraws of the open session views and of the status bar. */
export const sessionEvents = new Set<() => void>();

function notify(): void {
	for (const f of sessionEvents) f();
}

async function commit(plugin: TradoshiPlugin, data: SessionData): Promise<void> {
	await saveSessionData(plugin, data);
	notify();
}

const entry = (kind: LogEntry["kind"], text: string, extra: Partial<LogEntry> = {}): LogEntry => ({ at: Date.now(), kind, text, ...extra });

function newSession(plugin: TradoshiPlugin, window: string | null, reason: string | null, live: boolean): SessionRecord {
	const now = Date.now();
	const cfg = sessionData(plugin).config;
	return {
		id: `s${now}`,
		day: todayOf(plugin, now),
		window,
		unplanned: window === null,
		reason,
		phase: live ? "live" : "prep",
		prepAt: now,
		startAt: live ? now : null,
		endAt: null,
		breaks: [],
		checklist: checklistOf(cfg)
			.filter((x) => x.trim())
			.map((text) => ({ text, done: false })),
		log: [entry("phase", live ? st("logLive") : st("logPrep"))],
		notePath: null,
	};
}

/** Starts the preparation of a planned session (window given) or an unplanned one (reason given). */
export async function prepare(plugin: TradoshiPlugin, window: string | null, reason: string | null): Promise<void> {
	const data = sessionData(plugin);
	if (data.current && data.current.phase !== "ended") return void new Notice(st("alreadyRunning"));
	data.current = newSession(plugin, window, reason, false);
	data.run = null;
	await commit(plugin, data);
}

/** Goes live: from the preparation, or straight away. */
export async function goLive(plugin: TradoshiPlugin, window: string | null = null, reason: string | null = null): Promise<void> {
	const data = sessionData(plugin);
	const s = data.current;
	if (s && s.phase !== "ended") {
		if (s.phase !== "prep") return;
		s.phase = "live";
		s.startAt = Date.now();
		s.log.push(entry("phase", st("logLive")));
	} else {
		data.current = newSession(plugin, window, reason, true);
		data.run = null;
	}
	await commit(plugin, data);
}

export async function takeBreak(plugin: TradoshiPlugin): Promise<void> {
	const data = sessionData(plugin);
	const s = data.current;
	if (!s || s.phase !== "live") return;
	s.phase = "break";
	s.breaks.push({ from: Date.now(), to: null });
	s.log.push(entry("phase", st("logBreak")));
	await commit(plugin, data);
}

export async function resume(plugin: TradoshiPlugin): Promise<void> {
	const data = sessionData(plugin);
	const s = data.current;
	if (!s || s.phase !== "break") return;
	s.phase = "live";
	const open = s.breaks[s.breaks.length - 1];
	if (open && open.to === null) open.to = Date.now();
	s.log.push(entry("phase", st("logResume")));
	await commit(plugin, data);
}

/** Ends the session and writes it to the journal. `at` sets the end of a session left running. */
export async function endSession(plugin: TradoshiPlugin, at: number = Date.now()): Promise<void> {
	const data = sessionData(plugin);
	const s = data.current;
	if (!s || s.phase === "ended") return;
	for (const b of s.breaks) if (b.to === null) b.to = at;
	if (s.startAt === null) s.startAt = s.prepAt;
	s.phase = "ended";
	s.endAt = at;
	s.log.push({ at, kind: "phase", text: st("logEnded") });
	await commit(plugin, data);
	await save(plugin);
}

/** Writes the session note again (a lesson added after the end). */
async function save(plugin: TradoshiPlugin): Promise<void> {
	const data = sessionData(plugin);
	if (!data.current) return;
	try {
		const file = await writeSession(plugin, data.current);
		const fresh = sessionData(plugin);
		if (fresh.current && fresh.current.id === data.current.id) {
			fresh.current.notePath = file.path;
			fresh.last = file.path;
			await commit(plugin, fresh);
		}
	} catch (e) {
		console.error("Tradoshi session note", e);
		new Notice(st("writeFailed"));
	}
}

/** Puts the ended session away: the view is ready for the next one. */
export async function closeSession(plugin: TradoshiPlugin): Promise<void> {
	const data = sessionData(plugin);
	if (!data.current) return;
	if (data.current.phase !== "ended") return endSession(plugin);
	await save(plugin);
	const fresh = sessionData(plugin);
	fresh.current = null;
	fresh.run = null;
	await commit(plugin, fresh);
}

export async function addNote(plugin: TradoshiPlugin, tag: string, text: string): Promise<void> {
	const data = sessionData(plugin);
	const s = data.current;
	if (!s || !text.trim()) return;
	s.log.push(entry("note", text.trim(), { tag }));
	await commit(plugin, data);
	if (s.phase === "ended") await save(plugin);
}

export async function removeEntry(plugin: TradoshiPlugin, at: number): Promise<void> {
	const data = sessionData(plugin);
	const s = data.current;
	if (!s) return;
	s.log = s.log.filter((e) => !(e.at === at && e.kind === "note"));
	await commit(plugin, data);
	if (s.phase === "ended") await save(plugin);
}

export async function toggleCheck(plugin: TradoshiPlugin, index: number): Promise<void> {
	const data = sessionData(plugin);
	const item = data.current?.checklist[index];
	if (!item) return;
	item.done = !item.done;
	await commit(plugin, data);
}

/** An answer in a live gate run. The decision reached goes to the session log once. */
export async function answerGate(plugin: TradoshiPlugin, gateId: string, steps: GateStep[]): Promise<void> {
	const data = sessionData(plugin);
	const gate = gatesOf(data.config).find((g) => g.id === gateId);
	if (!gate) return;
	data.run = { gate: gateId, steps, logged: false };
	const state = runGate(gate, steps);
	if (state.kind === "outcome" && data.current && data.current.phase !== "ended") {
		data.current.log.push(entry("gate", pathLabels(gate, state.steps).join(" → "), { outcome: state.outcome }));
		data.run.logged = true;
	}
	await commit(plugin, data);
}

export async function restartGate(plugin: TradoshiPlugin, gateId: string | null = null): Promise<void> {
	const data = sessionData(plugin);
	data.run = gateId ? { gate: gateId, steps: [], logged: false } : null;
	await commit(plugin, data);
}

/** A session left running past its trading day ends by itself, at its last activity. */
export async function endStale(plugin: TradoshiPlugin): Promise<void> {
	const s = sessionData(plugin).current;
	if (!s || s.phase === "ended" || s.day >= todayOf(plugin)) return;
	const last = Math.max(s.startAt ?? s.prepAt, ...s.log.map((e) => e.at));
	await endSession(plugin, last);
}
