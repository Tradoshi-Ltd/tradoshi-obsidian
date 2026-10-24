import { normalizePath, TFile, type App } from "obsidian";
import { dayNoteKey, keyFromProperties, OVERVIEW_KEY, PlannedVault, tradeNoteKey, type NoteAction } from "./plan";
import {
	applyFrontmatter,
	dayBlock,
	dayFrontmatter,
	dayPath,
	frontmatterDiffers,
	newNote,
	overviewBlock,
	overviewPath,
	recordFromProperties,
	recordOf,
	replaceBlock,
	tradeBlock,
	tradeFrontmatter,
	tradeKey,
	tradePath,
	type Frontmatter,
	type NoteRecord,
	type OverviewAccount,
	type RenderContext,
} from "./render";
import { APP_URL, type TradoshiSettings } from "./settings";
import type { ApiAccount, ApiDayNote, ApiTrade, JournalResponse } from "./types";

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

interface Batch {
	accounts: ApiAccount[];
	/** Day notes written in Tradoshi, by date. */
	dayNotes: ApiDayNote[];
	generatedAt: string;
}

/**
 * Writes the trade notes of a batch (a sync or an imported file), then rebuilds the
 * day notes and the overview from every trade of the vault, so trades from Tradoshi
 * and trades from a file share their days without overwriting each other.
 */
async function writeBatch(app: App, settings: TradoshiSettings, ctx: RenderContext, batch: Batch): Promise<WriteStats> {
	const deleted = new Set(settings.deletedKeys);
	const index = indexVault(app);
	const vault = new PlannedVault(index.byKey, index.byPath, (path) => !!app.vault.getAbstractFileByPath(path));
	const writer = new NoteWriter(app);

	// 1. Trade notes of the batch.
	const batchRecords = new Map<string, NoteRecord>();
	const tradeWrites: { action: NoteAction; trade: ApiTrade; account: ApiAccount }[] = [];
	for (const account of batch.accounts) {
		for (const trade of account.trades ?? []) {
			const id = tradeKey(account, trade);
			const action: NoteAction = settings.tradeNotes ? vault.plan(tradeNoteKey(id), tradePath(ctx, trade), deleted) : { kind: "skip" };
			const record = recordOf(ctx, trade, account, action.kind === "skip" ? null : stripMd(action.path));
			if (record) batchRecords.set(id, record);
			if (action.kind !== "skip") tradeWrites.push({ action, trade, account });
		}
	}

	// 2. Every trade of the vault, the batch taking precedence over what is on disk.
	const records = new Map<string, NoteRecord>();
	for (const [path, key] of index.byPath) {
		if (!key.startsWith("trade:")) continue;
		const file = app.vault.getFileByPath(path);
		const fm = file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		const record = fm ? recordFromProperties(path, fm) : null;
		if (record && !records.has(record.key)) records.set(record.key, record);
	}
	for (const [key, record] of batchRecords) records.set(key, record);
	const all = [...records.values()];

	// 3. Day notes, planned before writing so links point to the notes as they are.
	const from = historyFrom(settings.history);
	const byDay = new Map<string, NoteRecord[]>();
	for (const r of all) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
	const notes = new Map(batch.dayNotes.map((n) => [n.date, n]));
	const dayActions = new Map<string, NoteAction>();
	if (settings.dailyNotes) {
		const dates = new Set([...byDay.keys(), ...notes.keys()]);
		// A day note already in the vault whose trades moved to another day (time zone
		// or day start changed) is kept and told it has no trades left.
		for (const key of index.byKey.keys()) if (key.startsWith("day:")) dates.add(key.slice(4));
		for (const date of [...dates].filter((d) => !from || d >= from).sort()) {
			dayActions.set(date, vault.plan(dayNoteKey(date), dayPath(ctx, date), deleted));
		}
	}
	const overviewAction = vault.plan(OVERVIEW_KEY, overviewPath(ctx), new Set());
	ctx.links = {
		trade: (key) => batchRecords.get(key)?.path ?? records.get(key)?.path ?? null,
		day: (date) => {
			const a = dayActions.get(date);
			return a && a.kind !== "skip" ? stripMd(a.path) : null;
		},
	};

	// 4. Write.
	for (const { action, trade, account } of tradeWrites) {
		await writer.write(action, tradeFrontmatter(ctx, trade, account), tradeBlock(ctx, trade, account), PERSONAL_HEADING);
	}
	for (const [date, action] of dayActions) {
		const dayRecords = byDay.get(date) ?? [];
		await writer.write(action, dayFrontmatter(date, dayRecords), dayBlock(ctx, date, dayRecords, notes.get(date)), PERSONAL_HEADING);
	}
	const known = new Set(batch.accounts.map((a) => a.name));
	const fromFile = (id: string): boolean => id.startsWith("file-");
	const overviewAccounts: OverviewAccount[] = batch.accounts.map((a) => ({
		name: a.name,
		broker: a.broker,
		trades: a.tradeCount,
		source: fromFile(a.id) ? "file" : "tradoshi",
		updated: fromFile(a.id) ? null : a.updatedAt,
		demo: a.mode === "demo",
	}));
	for (const r of all) {
		if (known.has(r.account)) continue;
		known.add(r.account);
		overviewAccounts.push({
			name: r.account,
			broker: r.broker,
			trades: all.filter((x) => x.account === r.account).length,
			source: fromFile(r.key) ? "file" : "tradoshi",
			updated: null,
			demo: false,
		});
	}
	await writer.write(overviewAction, { tradoshi_overview: true, tags: ["tradoshi/overview"] }, overviewBlock(ctx, overviewAccounts, all, batch.generatedAt), null);
	return writer.stats;
}

/** Writes the journal read from Tradoshi. */
export async function writeJournal(app: App, data: JournalResponse, settings: TradoshiSettings): Promise<WriteStats> {
	const accounts = data.accounts.filter(
		(a) => (settings.includeDemo || a.mode !== "demo") && (settings.includeArchived || !a.archived),
	);
	return writeBatch(app, settings, renderContext(settings, data.appUrl || APP_URL), { accounts, dayNotes: data.notes, generatedAt: data.generatedAt });
}

const slug = (s: string): string =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || "account";

/**
 * Writes the trades of a file imported on this computer. They live in the vault only:
 * nothing is sent to Tradoshi. Importing the same file again updates the same notes.
 */
export async function writeImport(
	app: App,
	settings: TradoshiSettings,
	account: { name: string; broker: string | null; currency: string },
	trades: ApiTrade[],
	dayNotes: ApiDayNote[],
): Promise<WriteStats> {
	const now = new Date().toISOString();
	const imported: ApiAccount = {
		id: `file-${slug(account.name)}`,
		name: account.name,
		broker: account.broker,
		currency: account.currency,
		mode: "live",
		archived: false,
		updatedAt: now,
		tradeCount: trades.length,
		changed: true,
		trades,
	};
	return writeBatch(app, settings, renderContext(settings), { accounts: [imported], dayNotes, generatedAt: now });
}
