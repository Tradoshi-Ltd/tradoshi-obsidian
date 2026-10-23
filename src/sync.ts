import { normalizePath, type App } from "obsidian";
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

class NoteWriter {
	readonly stats: WriteStats = { created: 0, updated: 0 };
	private writes = 0;

	constructor(private readonly app: App) {}

	private async ensureFolder(path: string): Promise<void> {
		const parts = path.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getFolderByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	/**
	 * Creates the note, or updates only what the plugin manages in it: its own
	 * properties and the block between the markers. The rest of the note belongs
	 * to the trader and is never rewritten.
	 */
	async upsert(path: string, fm: Frontmatter, block: string, personalHeading: string | null): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			const parent = path.slice(0, path.lastIndexOf("/"));
			if (parent) await this.ensureFolder(parent);
			await this.app.vault.create(path, newNote(fm, block, personalHeading));
			this.stats.created++;
			await this.breathe();
			return;
		}

		let changed = false;
		const current = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (frontmatterDiffers(current, fm)) {
			await this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => applyFrontmatter(front, fm));
			changed = true;
		}
		const text = await this.app.vault.read(file);
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

export async function writeJournal(app: App, data: JournalResponse, settings: TradoshiSettings): Promise<WriteStats> {
	const ctx: RenderContext = {
		folder: normalizePath(settings.folder.trim() || "Tradoshi"),
		appUrl: data.appUrl || APP_URL,
		appLinks: settings.appLinks,
		tradeNotes: settings.tradeNotes,
		dailyNotes: settings.dailyNotes,
	};
	const accounts = data.accounts.filter(
		(a) => (settings.includeDemo || a.mode !== "demo") && (settings.includeArchived || !a.archived),
	);
	const items: TradeWithAccount[] = accounts.flatMap((account) => (account.trades ?? []).map((trade) => ({ trade, account })));
	const writer = new NoteWriter(app);

	if (settings.tradeNotes) {
		for (const { trade, account } of items) {
			await writer.upsert(tradePath(ctx, trade), tradeFrontmatter(trade, account), tradeBlock(ctx, trade, account), PERSONAL_HEADING);
		}
	}

	if (settings.dailyNotes) {
		const days = groupByDay(items);
		const notes = new Map(data.notes.map((n) => [n.date, n]));
		const from = historyFrom(settings.history);
		const dates = [...new Set([...days.keys(), ...notes.keys()])].filter((d) => !from || d >= from).sort();
		for (const date of dates) {
			const dayItems = days.get(date) ?? [];
			await writer.upsert(dayPath(ctx, date), dayFrontmatter(date, dayItems), dayBlock(ctx, date, dayItems, notes.get(date)), PERSONAL_HEADING);
		}
	}

	await writer.upsert(overviewPath(ctx), { tags: ["tradoshi/overview"] }, overviewBlock(ctx, accounts, items, data.generatedAt), null);
	return writer.stats;
}
