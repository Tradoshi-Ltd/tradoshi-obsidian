import { normalizePath, TFile, type App } from "obsidian";
import { dayNoteKey, keyFromProperties, OVERVIEW_KEY, PlannedVault, tradeNoteKey, type NoteAction } from "./plan";
import {
	applyFrontmatter,
	dayBlock,
	dayFrontmatter,
	dayPath,
	frontmatterDiffers,
	groupByDay,
	newNote,
	overviewBlock,
	overviewPath,
	replaceBlock,
	tradeBlock,
	tradeFrontmatter,
	tradeKey,
	tradePath,
	type Frontmatter,
	type RenderContext,
} from "./render";
import { APP_URL, type TradoshiSettings } from "./settings";
import type { JournalResponse, TradeWithAccount } from "./types";

const PERSONAL_HEADING = "## My notes";

export interface WriteStats {
	created: number;
	updated: number;
}

/** Oldest day to include for a history setting ("90" = last 90 days, "0" = everything). */
export function historyFrom(history: string, now: Date = new Date()): string | null {
	const days = Number(history);
	if (!Number.isFinite(days) || days <= 0) return null;
	const d = new Date(now.getTime() - days * 86400000);
	return d.toISOString().slice(0, 10);
}

export function renderContext(settings: TradoshiSettings, appUrl: string = APP_URL): RenderContext {
	return {
		folder: normalizePath(settings.folder.trim() || "Tradoshi"),
		appUrl,
		appLinks: settings.appLinks,
		tradeNotes: settings.tradeNotes,
		dailyNotes: settings.dailyNotes,
		timeZone: settings.timeZone,
		dayStartHour: Number(settings.dayStartHour) || 0,
	};
}

/** Every note of the vault that carries a Tradoshi identity, wherever it was moved. */
export function indexVault(app: App): { byKey: Map<string, string>; byPath: Map<string, string> } {
	const byKey = new Map<string, string>();
	const byPath = new Map<string, string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const key = keyFromProperties(app.metadataCache.getFileCache(file)?.frontmatter);
		if (!key) continue;
		byPath.set(file.path, key);
		// Two notes with the same identity (a copy made by hand): the first one found
		// keeps receiving updates, the copy is left as the trader made it.
		if (!byKey.has(key)) byKey.set(key, file.path);
	}
	return { byKey, byPath };
}

class NoteWriter {
	readonly stats: WriteStats = { created: 0, updated: 0 };
	private writes = 0;

	constructor(private readonly app: App) {}

	private async ensureFolder(path: string): Promise<void> {
		let current = "";
		for (const part of path.split("/")) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getFolderByPath(current)) await this.app.vault.createFolder(current);
		}
	}

	/**
	 * Creates the note, or updates only what the plugin manages in it: its own
	 * properties and the block between the markers. The rest of the note belongs
	 * to the trader and is never rewritten.
	 */
	async write(action: NoteAction, fm: Frontmatter, block: string, personalHeading: string | null): Promise<void> {
		if (action.kind === "skip") return;
		if (action.kind === "create") {
			const parent = action.path.slice(0, action.path.lastIndexOf("/"));
			if (parent) await this.ensureFolder(parent);
			await this.app.vault.create(action.path, newNote(fm, block, personalHeading));
			this.stats.created++;
			await this.breathe();
			return;
		}
		const file = this.app.vault.getFileByPath(action.path);
		if (!(file instanceof TFile)) return;
		let changed = false;
		if (frontmatterDiffers(this.app.metadataCache.getFileCache(file)?.frontmatter, fm)) {
			await this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => applyFrontmatter(front, fm));
			changed = true;
		}
		const text = await this.app.vault.cachedRead(file);
		const next = replaceBlock(text, block);
		if (next !== null && next !== text) {
			await this.app.vault.process(file, (data) => replaceBlock(data, block) ?? data);
			changed = true;
		}
		if (changed) {
			this.stats.updated++;
			await this.breathe();
		}
	}

	// Gives the interface room to breathe during a first sync of several hundred notes.
	private async breathe(): Promise<void> {
		if (++this.writes % 50 === 0) await sleep(0);
	}
}

const stripMd = (path: string): string => path.replace(/\.md$/, "");

export async function writeJournal(app: App, data: JournalResponse, settings: TradoshiSettings): Promise<WriteStats> {
	const ctx = renderContext(settings, data.appUrl || APP_URL);
	const accounts = data.accounts.filter(
		(a) => (settings.includeDemo || a.mode !== "demo") && (settings.includeArchived || !a.archived),
	);
	const items: TradeWithAccount[] = accounts.flatMap((account) => (account.trades ?? []).map((trade) => ({ trade, account })));
	const deleted = new Set(settings.deletedKeys);
	const index = indexVault(app);
	const vault = new PlannedVault(index.byKey, index.byPath, (path) => !!app.vault.getAbstractFileByPath(path));

	// 1. Decide where every note goes, before writing anything, so links point to
	//    the notes as they really are in the vault.
	const tradeActions = new Map<string, NoteAction>();
	if (settings.tradeNotes) {
		for (const { trade, account } of items) {
			const id = tradeKey(account, trade);
			tradeActions.set(id, vault.plan(tradeNoteKey(id), tradePath(ctx, trade), deleted));
		}
	}

	const days = groupByDay(ctx, items);
	const notes = new Map(data.notes.map((n) => [n.date, n]));
	const from = historyFrom(settings.history);
	const dayActions = new Map<string, NoteAction>();
	if (settings.dailyNotes) {
		const dates = new Set([...days.keys(), ...notes.keys()]);
		// A day note already in the vault whose trades moved to another day (time zone
		// or day start changed) is kept and told it has no trades left.
		for (const key of index.byKey.keys()) if (key.startsWith("day:")) dates.add(key.slice(4));
		for (const date of [...dates].filter((d) => !from || d >= from).sort()) {
			dayActions.set(date, vault.plan(dayNoteKey(date), dayPath(ctx, date), deleted));
		}
	}
	const overviewAction = vault.plan(OVERVIEW_KEY, overviewPath(ctx), new Set());

	const target = (action: NoteAction | undefined): string | null => (action && action.kind !== "skip" ? stripMd(action.path) : null);
	ctx.links = {
		trade: (key) => target(tradeActions.get(key)),
		day: (date) => target(dayActions.get(date)),
	};

	// 2. Write.
	const writer = new NoteWriter(app);
	for (const { trade, account } of items) {
		const action = tradeActions.get(tradeKey(account, trade));
		if (action) await writer.write(action, tradeFrontmatter(ctx, trade, account), tradeBlock(ctx, trade, account), PERSONAL_HEADING);
	}
	for (const [date, action] of dayActions) {
		const dayItems = days.get(date) ?? [];
		await writer.write(action, dayFrontmatter(date, dayItems), dayBlock(ctx, date, dayItems, notes.get(date)), PERSONAL_HEADING);
	}
	await writer.write(
		overviewAction,
		{ tradoshi_overview: true, tags: ["tradoshi/overview"] },
		overviewBlock(ctx, accounts, items, data.generatedAt),
		null,
	);
	return writer.stats;
}
