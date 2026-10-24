import { outcomeCounts, type Outcome } from "./gate";

// Session mode: the trading windows, the phases of a session, its log, its summary and
// the note it leaves in the journal. Pure: no Obsidian, so it is tested.

export interface SessionWindow {
	id: string;
	name: string;
	/** "HH:MM", in the journal time zone. A window that ends before it starts runs past midnight. */
	start: string;
	end: string;
	/** Days it applies to, Monday 0 to Sunday 6. */
	days: number[];
}

export type Phase = "prep" | "live" | "break" | "ended";

export interface LogEntry {
	at: number;
	kind: "note" | "gate" | "phase" | "trade";
	/** Tag of a note: Analysis, Market, Psychology, Lesson… */
	tag?: string;
	text: string;
	outcome?: Outcome;
	pnl?: number;
	currency?: string;
	/** Note of a trade, without ".md". */
	path?: string | null;
}

export interface SessionRecord {
	id: string;
	/** Trading day the session belongs to. */
	day: string;
	/** Name of the window it was started in; null when unplanned. */
	window: string | null;
	unplanned: boolean;
	reason: string | null;
	phase: Phase;
	prepAt: number;
	startAt: number | null;
	endAt: number | null;
	/** Breaks taken while live. */
	breaks: { from: number; to: number | null }[];
	checklist: { text: string; done: boolean }[];
	log: LogEntry[];
	/** Note written for the session, once written. */
	notePath: string | null;
}

/** Minutes after midnight of "HH:MM", null when it is not a time. */
export function minutesOf(hhmm: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	return h < 24 && min < 60 ? h * 60 + min : null;
}

export type WindowPhase = "prep" | "live" | "waiting" | "done" | "none";

export interface WindowStatus {
	phase: WindowPhase;
	window: SessionWindow | null;
	/** Minutes until the window opens (prep, waiting) or closes (live). */
	minutes: number | null;
}

/**
 * Where the clock stands against the trading windows of the day: inside one (live),
 * in the preparation time before one (prep), before the next one (waiting), after the
 * last one (done), or no window today (none).
 */
export function windowStatus(windows: SessionWindow[], weekday: number, minutes: number, prepMinutes: number): WindowStatus {
	const today = windows
		.map((w) => ({ w, s: minutesOf(w.start), e: minutesOf(w.end) }))
		.filter((x): x is { w: SessionWindow; s: number; e: number } => x.s !== null && x.e !== null && x.s !== x.e);
	// A window past midnight, started yesterday, is still live this morning.
	for (const x of today) {
		const yesterday = (weekday + 6) % 7;
		if (x.e < x.s && x.w.days.includes(yesterday) && minutes < x.e) return { phase: "live", window: x.w, minutes: x.e - minutes };
	}
	const mine = today.filter((x) => x.w.days.includes(weekday)).sort((a, b) => a.s - b.s);
	for (const x of mine) {
		const end = x.e < x.s ? x.e + 1440 : x.e;
		if (minutes >= x.s && minutes < end) return { phase: "live", window: x.w, minutes: end - minutes };
	}
	const next = mine.find((x) => x.s > minutes);
	if (next) return { phase: next.s - minutes <= prepMinutes ? "prep" : "waiting", window: next.w, minutes: next.s - minutes };
	return mine.length ? { phase: "done", window: mine[mine.length - 1].w, minutes: null } : { phase: "none", window: null, minutes: null };
}

/** Time spent live, breaks left out. */
export function liveTime(s: SessionRecord, now: number): number {
	if (s.startAt === null) return 0;
	const end = s.endAt ?? now;
	const paused = s.breaks.reduce((sum, b) => sum + Math.max(0, Math.min(b.to ?? end, end) - Math.max(b.from, s.startAt ?? b.from)), 0);
	return Math.max(0, end - s.startAt - paused);
}

/** "1 h 05", "42 min": a duration on a session clock. */
export function clock(ms: number): string {
	const min = Math.floor(ms / 60000);
	return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

export interface SessionTrade {
	key: string;
	path: string | null;
	symbol: string;
	side: string;
	at: number;
	openAt: number | null;
	pnl: number;
	currency: string;
	reviewed: boolean;
}

/** Trades opened or closed while the session ran (from the start of preparation). */
export function sessionTrades<T extends Pick<SessionTrade, "at" | "openAt">>(s: SessionRecord, trades: T[], now: number): T[] {
	const from = s.prepAt;
	const to = s.endAt ?? now;
	return trades.filter((t) => (t.at >= from && t.at <= to) || (t.openAt !== null && t.openAt >= from && t.openAt <= to)).sort((a, b) => a.at - b.at);
}

export interface SessionSummary {
	live: number;
	notes: number;
	lessons: number;
	gate: Record<Outcome, number>;
	trades: number;
	net: number;
	wins: number;
	losses: number;
	currency: string | null;
	checklistDone: number;
	checklistTotal: number;
}

export function summary(s: SessionRecord, trades: SessionTrade[], now: number, lessonTag: string): SessionSummary {
	const cur = trades[0]?.currency ?? null;
	const same = trades.filter((t) => t.currency === cur);
	return {
		live: liveTime(s, now),
		notes: s.log.filter((e) => e.kind === "note").length,
		lessons: s.log.filter((e) => e.kind === "note" && e.tag === lessonTag).length,
		gate: outcomeCounts(s.log.filter((e) => e.kind === "gate").map((e) => e.outcome)),
		trades: trades.length,
		net: same.reduce((a, t) => a + t.pnl, 0),
		wins: same.filter((t) => t.pnl > 0).length,
		losses: same.filter((t) => t.pnl < 0).length,
		currency: cur,
		checklistDone: s.checklist.filter((c) => c.done).length,
		checklistTotal: s.checklist.length,
	};
}

/** The log with the trades of the session, in time order. */
export function timeline(s: SessionRecord, trades: SessionTrade[], withTrades: boolean): LogEntry[] {
	const own = s.log.filter((e) => e.kind !== "trade");
	const fromVault: LogEntry[] = withTrades
		? trades.map((t) => ({ at: t.at, kind: "trade", text: `${t.symbol} ${t.side}`, pnl: t.pnl, currency: t.currency, path: t.path ? t.path.replace(/\.md$/, "") : null }))
		: [];
	return [...own, ...fromVault].sort((a, b) => a.at - b.at);
}

const OUTCOME_TEXT: Record<Outcome, string> = { go: "GO", nogo: "NO GO", wait: "WAIT" };

const escapeMd = (s: string): string => s.replace(/\r?\n+/g, " ").replace(/#/g, "\\#").trim();

const money = (v: number, currency: string): string => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(2)} ${currency}`;

/**
 * The managed part of a session note: checklist, log and figures, in Markdown that
 * reads without the plugin. Times are given by `time` (journal time zone, "HH:MM").
 */
export function sessionMarkdown(s: SessionRecord, trades: SessionTrade[], now: number, time: (ms: number) => string, withTrades: boolean, lessonTag: string): string {
	const sum = summary(s, trades, now, lessonTag);
	const lines: string[] = [];
	const facts: string[] = [];
	if (s.startAt !== null) facts.push(`**Live:** ${time(s.startAt)} → ${s.endAt ? time(s.endAt) : "…"} (${clock(sum.live)})`);
	facts.push(`**Trades:** ${sum.trades}${sum.currency && sum.trades ? ` · **P&L:** ${money(sum.net, sum.currency)}` : ""}`);
	const g = sum.gate;
	if (g.go + g.nogo + g.wait) facts.push(`**Trade gate:** GO ${g.go} · WAIT ${g.wait} · NO GO ${g.nogo}`);
	if (s.unplanned) facts.push(`**Unplanned**${s.reason ? `: ${escapeMd(s.reason)}` : ""}`);
	lines.push(facts.join(" · "), "");
	if (s.checklist.length) {
		lines.push("## Checklist", "");
		for (const c of s.checklist) lines.push(`- [${c.done ? "x" : " "}] ${escapeMd(c.text)}`);
		lines.push("");
	}
	lines.push("## Log", "");
	const entries = timeline(s, trades, withTrades);
	if (!entries.length) lines.push("- No entry.");
	for (const e of entries) {
		const at = time(e.at);
		if (e.kind === "trade") {
			const label = escapeMd(e.text).replace(/[|[\]]/g, "");
			const link = e.path ? `[[${e.path}|${label}]]` : label;
			lines.push(`- ${at} · Trade · ${link}${e.pnl !== undefined && e.currency ? ` ${money(e.pnl, e.currency)}` : ""}`);
		} else if (e.kind === "gate") {
			lines.push(`- ${at} · Trade gate · ${e.outcome ? OUTCOME_TEXT[e.outcome] : ""}${e.text ? ` · ${escapeMd(e.text)}` : ""}`);
		} else if (e.kind === "phase") {
			lines.push(`- ${at} · ${escapeMd(e.text)}`);
		} else {
			lines.push(`- ${at} · ${escapeMd(e.tag ?? "Note")} · ${escapeMd(e.text)}`);
		}
	}
	return lines.join("\n");
}

/** Properties of a session note. `dayLink` points to the day note when it exists. */
export function sessionFrontmatter(s: SessionRecord, trades: SessionTrade[], now: number, dateTime: (ms: number) => string, dayLink: string | null, lessonTag: string): Record<string, string | number | boolean | string[] | null> {
	const sum = summary(s, trades, now, lessonTag);
	return {
		tradoshi_session: s.id,
		session_day: s.day,
		session: s.window,
		unplanned: s.unplanned,
		reason: s.unplanned ? s.reason : null,
		started: s.startAt !== null ? dateTime(s.startAt) : null,
		ended: s.endAt !== null ? dateTime(s.endAt) : null,
		live_minutes: Math.round(sum.live / 60000),
		trades: sum.trades,
		pnl: sum.currency ? Math.round(sum.net * 100) / 100 : null,
		currency: sum.currency,
		gate_go: sum.gate.go,
		gate_wait: sum.gate.wait,
		gate_nogo: sum.gate.nogo,
		notes: sum.notes,
		checklist: sum.checklistTotal ? `${sum.checklistDone}/${sum.checklistTotal}` : null,
		review_day: dayLink,
		tags: ["tradoshi/session"],
	};
}

/** File name of a session note: its day, its start and its window, "2026-10-24 0902 London open". */
export function sessionFileName(s: SessionRecord, hhmm: string, unplannedLabel: string): string {
	const name = (s.window ?? unplannedLabel).replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim();
	return `${s.day} ${hhmm.replace(":", "")} ${name}`.trim();
}

/** The "## Log" section of a session note, for a report card to show it again. */
export function logSection(markdown: string): string | null {
	const m = /^## Log[ \t]*\r?\n([\s\S]*?)(?=^## |^%% tradoshi:end %%|(?![\s\S]))/m.exec(markdown);
	return m ? m[1].trim() : null;
}
