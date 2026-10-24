import { TFile } from "obsidian";
import { tradesFromVault } from "../journal-data";
import type TradoshiPlugin from "../main";
import { applyFrontmatter, newNote, replaceBlock, zoned } from "../render";
import { noteLink, linksTo } from "../reviews/periods";
import { createNote, ensureDayNote, fmOf, setProps } from "../reviews/vault";
import { renderContext } from "../sync";
import { lessonTagOf, sessionData } from "./data";
import { sessionFileName, sessionFrontmatter, sessionMarkdown, sessionTrades, type SessionRecord, type SessionTrade } from "./logic";
import { st } from "./text";

// A session ends in the journal: a note of its own, linked from the day note
// (`review_sessions`), with its checklist, its log and its figures. The report card
// of the day lists it and shows its log again.

/** The trades of the vault, as a session sees them. */
export function vaultSessionTrades(plugin: TradoshiPlugin): SessionTrade[] {
	return tradesFromVault(plugin.app).map((t) => ({
		key: t.key,
		path: t.path,
		symbol: t.symbol,
		side: t.side,
		at: t.at,
		openAt: t.openAt,
		pnl: t.pnl,
		currency: t.currency,
		reviewed: t.reviewed,
	}));
}

const zone = (plugin: TradoshiPlugin): string => plugin.settings.timeZone || "UTC";

/** Writes the session note, or brings it up to date; the trader's own part of the note is kept. */
export async function writeSession(plugin: TradoshiPlugin, s: SessionRecord): Promise<TFile> {
	const app = plugin.app;
	const cfg = sessionData(plugin).config;
	const now = Date.now();
	const trades = sessionTrades(s, vaultSessionTrades(plugin), now);
	const time = (ms: number): string => zoned(ms, zone(plugin)).time;
	const dateTime = (ms: number): string => {
		const z = zoned(ms, zone(plugin));
		return `${z.date}T${z.time}`;
	};
	const day = await ensureDayNote(plugin, s.day);
	const fm = sessionFrontmatter(s, trades, now, dateTime, noteLink(day.path, s.day), lessonTagOf(cfg));
	const block = sessionMarkdown(s, trades, now, time, cfg.tradeEvents, lessonTagOf(cfg));
	let file = s.notePath ? app.vault.getFileByPath(s.notePath) : null;
	if (file instanceof TFile) {
		await app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => applyFrontmatter(front, fm));
		await app.vault.process(file, (data) => replaceBlock(data, block) ?? data);
	} else {
		const folder = renderContext(plugin.settings).folder;
		const name = sessionFileName(s, time(s.startAt ?? s.prepAt), st("unplanned"));
		file = await createNote(app, `${folder}/Sessions/${s.day.slice(0, 4)}/${name}.md`, newNote(fm, block, "## My notes"));
	}
	const have = fmOf(app, day)?.review_sessions;
	if (!linksTo(have, file.path)) {
		const list = Array.isArray(have) ? have.map(String) : typeof have === "string" && have ? [have] : [];
		await setProps(app, day, { review_sessions: [...list, noteLink(file.path, file.basename)] });
	}
	return file;
}
