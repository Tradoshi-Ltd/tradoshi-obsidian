import { normalizePath, TFile, type App } from "obsidian";
import type TradoshiPlugin from "../main";
import { dayBlock, dayFrontmatter, dayPath, newNote, recordFromProperties, toYaml, tradingDay, type NoteRecord } from "../render";
import { renderContext } from "../sync";
import {
	childKind,
	childrenOf,
	DOWN_PROPERTY,
	linksTo,
	NEXT_PROPERTY,
	noteLink,
	parentOf,
	PREVIOUS_PROPERTY,
	reviewBody,
	reviewFrontmatter,
	reviewPath,
	UP_PROPERTY,
	type Period,
} from "./periods";

// Where the reviews live in the vault: the day notes (written by the sync, completed
// here when the trader plans a day that has no trade yet), the review notes of the
// weeks, months, quarters and years, and the links between them. Only `review_*`
// properties are written in a note of the sync; review notes belong to this module.

export type Props = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function fmOf(app: App, file: TFile | null): Props | undefined {
	return file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
}

/** Local day "YYYY-MM-DD" of a moment on this computer. */
export function localDay(ms: number = Date.now()): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today's trading day, in the journal time zone and with its day start. */
export function todayOf(plugin: TradoshiPlugin, ms: number = Date.now()): string {
	return tradingDay(renderContext(plugin.settings), new Date(ms).toISOString()) ?? localDay(ms);
}

/** The trading day of a note: its `tradoshi_day`, or the `date` of a day note of version 1.0. */
export function dayOfNote(fm: Props | undefined): string | null {
	if (!fm) return null;
	const day = str(fm.tradoshi_day);
	if (day) return day;
	const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
	return tags.includes("tradoshi/day") ? str(fm.date) : null;
}

/** Every day note of the vault, by trading day, wherever it was moved. */
export function dayNotes(app: App): Map<string, TFile> {
	const out = new Map<string, TFile>();
	for (const file of app.vault.getMarkdownFiles()) {
		const day = dayOfNote(fmOf(app, file));
		if (day && !out.has(day)) out.set(day, file);
	}
	return out;
}

/** Every review note of the vault, by period id. */
export function reviewNotes(app: App): Map<string, TFile> {
	const out = new Map<string, TFile>();
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = fmOf(app, file);
		const id = fm && str(fm.tradoshi_review) ? str(fm.period) : null;
		if (id && !out.has(id)) out.set(id, file);
	}
	return out;
}

/** The session notes of a trading day, in time order. */
export function sessionNotes(app: App, day: string): TFile[] {
	return app.vault
		.getMarkdownFiles()
		.filter((f) => {
			const fm = fmOf(app, f);
			return !!fm && str(fm.tradoshi_session) !== null && fm.session_day === day;
		})
		.sort((a, b) => (str(fmOf(app, a)?.started) ?? a.basename).localeCompare(str(fmOf(app, b)?.started) ?? b.basename));
}

/** The note of a period: the day note of a day, the review note of the others. */
export function noteOfPeriod(app: App, p: Period, days: Map<string, TFile> = dayNotes(app), reviews?: Map<string, TFile>): TFile | null {
	if (p.kind === "day") return days.get(p.id) ?? null;
	return (reviews ?? reviewNotes(app)).get(p.id) ?? null;
}

async function ensureFolder(app: App, path: string): Promise<void> {
	let current = "";
	for (const part of path.split("/")) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getFolderByPath(current)) await app.vault.createFolder(current);
	}
}

/** A free path next to the wanted one: "name.md", then "name (2).md"… */
function freePath(app: App, path: string): string {
	let out = path;
	for (let n = 2; app.vault.getAbstractFileByPath(out); n++) out = path.replace(/\.md$/, ` (${n}).md`);
	return out;
}

/** Creates a note, its folders first. */
export async function createNote(app: App, path: string, content: string): Promise<TFile> {
	const target = freePath(app, normalizePath(path));
	const parent = target.slice(0, target.lastIndexOf("/"));
	if (parent) await ensureFolder(app, parent);
	return app.vault.create(target, content);
}

/**
 * The day note of a day, created when it does not exist yet: the plan of a day is
 * written before its first trade. It is made like the sync makes it, so the next sync
 * keeps it up to date; a day note the trader had deleted comes back to the sync too.
 */
export async function ensureDayNote(plugin: TradoshiPlugin, day: string): Promise<TFile> {
	const app = plugin.app;
	const existing = dayNotes(app).get(day);
	if (existing) return existing;
	const ctx = renderContext(plugin.settings);
	const records: NoteRecord[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = fmOf(app, file);
		if (fm?.trading_day !== day) continue;
		const r = recordFromProperties(file.path, fm);
		if (r) records.push(r);
	}
	const file = await createNote(app, dayPath(ctx, day), newNote(dayFrontmatter(day, records), dayBlock(ctx, day, records, undefined), "## My notes"));
	const key = `day:${day}`;
	if (plugin.settings.deletedKeys.includes(key)) {
		plugin.settings.deletedKeys = plugin.settings.deletedKeys.filter((k) => k !== key);
		await plugin.saveSettings();
	}
	return file;
}

/** The review note of a week, a month, a quarter or a year, created with its links when it does not exist yet. */
export async function ensureReviewNote(plugin: TradoshiPlugin, p: Period): Promise<TFile> {
	if (p.kind === "day") return ensureDayNote(plugin, p.id);
	const app = plugin.app;
	const existing = reviewNotes(app).get(p.id);
	if (existing) return existing;
	const folder = renderContext(plugin.settings).folder;
	const links = linkPlan(app, p, null);
	const fm = reviewFrontmatter(p, { up: links.up?.link ?? null, previous: links.previous?.link ?? null, next: links.next?.link ?? null, children: links.children.map((c) => c.link) });
	const file = await createNote(app, reviewPath(folder, p), `${toYaml(fm)}\n\n${reviewBody()}`);
	await linkReview(plugin, p, file);
	return file;
}

interface Linked {
	file: TFile;
	link: string;
}

/** The notes a review links to: the period above, the one before and after (the nearest that exists), the ones below. */
function linkPlan(app: App, p: Period, self: TFile | null): { up: Linked | null; previous: Linked | null; next: Linked | null; children: Linked[] } {
	const days = dayNotes(app);
	const reviews = reviewNotes(app);
	const as = (file: TFile | null, label: string): Linked | null => (file && file !== self ? { file, link: noteLink(file.path, label) } : null);
	const parent = parentOf(p);
	const up = parent ? as(noteOfPeriod(app, parent, days, reviews), parent.id) : null;
	const same = [...reviews.entries()].filter(([id, f]) => f !== self && fmOf(app, f)?.tradoshi_review === p.kind && id !== p.id).sort(([a], [b]) => a.localeCompare(b));
	const before = [...same].reverse().find(([id]) => id < p.id);
	const after = same.find(([id]) => id > p.id);
	const children = childrenOf(p)
		.map((c) => as(noteOfPeriod(app, c, days, reviews), c.id))
		.filter((x): x is Linked => x !== null);
	return { up, previous: before ? as(before[1], before[0]) : null, next: after ? as(after[1], after[0]) : null, children };
}

const pathLink = (file: TFile, label: string): string => noteLink(file.path, label);

/**
 * Writes the links of a review both ways, only those missing: the review points up,
 * down, back and forward, and each of those notes points back to it. A day note gets
 * `review_week`, a week `review_month`… so the graph shows the review tree.
 */
export async function linkReview(plugin: TradoshiPlugin, p: Period, file: TFile): Promise<void> {
	const app = plugin.app;
	const plan = linkPlan(app, p, file);
	const me = pathLink(file, p.id);
	const fm = fmOf(app, file) ?? {};
	const up = UP_PROPERTY[p.kind];
	const down = DOWN_PROPERTY[p.kind];
	const mine: Props = {};
	if (up && plan.up && !linksTo(fm[up], plan.up.file.path)) mine[up] = plan.up.link;
	if (plan.previous && !linksTo(fm[PREVIOUS_PROPERTY], plan.previous.file.path)) mine[PREVIOUS_PROPERTY] = plan.previous.link;
	if (plan.next && !linksTo(fm[NEXT_PROPERTY], plan.next.file.path)) mine[NEXT_PROPERTY] = plan.next.link;
	if (down) {
		const have = Array.isArray(fm[down]) ? (fm[down] as unknown[]).map(String) : [];
		const missing = plan.children.filter((c) => !linksTo(have, c.file.path)).map((c) => c.link);
		if (missing.length) mine[down] = [...have, ...missing];
	}
	if (Object.keys(mine).length) await setProps(app, file, mine);

	if (plan.up && up) {
		const parent = parentOf(p);
		const parentDown = parent ? DOWN_PROPERTY[parent.kind] : null;
		const pfm = fmOf(app, plan.up.file) ?? {};
		if (parentDown && !linksTo(pfm[parentDown], file.path)) {
			const have = Array.isArray(pfm[parentDown]) ? (pfm[parentDown] as unknown[]).map(String) : [];
			await setProps(app, plan.up.file, { [parentDown]: [...have, me] });
		}
	}
	const below = childKind(p.kind);
	const childUp = below ? UP_PROPERTY[below] : null;
	for (const child of plan.children) {
		if (childUp && !linksTo(fmOf(app, child.file)?.[childUp], file.path)) await setProps(app, child.file, { [childUp]: me });
	}
	if (plan.previous && !linksTo(fmOf(app, plan.previous.file)?.[NEXT_PROPERTY], file.path)) await setProps(app, plan.previous.file, { [NEXT_PROPERTY]: me });
	if (plan.next && !linksTo(fmOf(app, plan.next.file)?.[PREVIOUS_PROPERTY], file.path)) await setProps(app, plan.next.file, { [PREVIOUS_PROPERTY]: me });
}

/** Sets properties of a note; null or an empty text removes the property. */
export async function setProps(app: App, file: TFile, props: Props): Promise<void> {
	await app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
		for (const [k, v] of Object.entries(props)) {
			if (v === null || v === undefined || v === "") delete front[k];
			else front[k] = v;
		}
	});
}

/** Marks a day, a trade or a review as reviewed today, or not. */
export async function markReviewed(app: App, file: TFile, done: boolean): Promise<void> {
	await setProps(app, file, done ? { review_done: true, review_date: localDay() } : { review_done: null, review_date: null });
}

export async function openFile(app: App, file: TFile | null, newTab = false): Promise<void> {
	if (file instanceof TFile) await app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
}

/** Opens the note of a period, created when needed. */
export async function openPeriod(plugin: TradoshiPlugin, p: Period, newTab = false): Promise<void> {
	await openFile(plugin.app, await ensureReviewNote(plugin, p), newTab);
}
