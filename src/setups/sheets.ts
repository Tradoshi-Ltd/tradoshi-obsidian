import { debounce, normalizePath, TFile, type App, type Debouncer } from "obsidian";
import type TradoshiPlugin from "../main";
import { indexMetas, linkTargetOf, metaFromProperties, nextSetupLinks, norm, setupLink, sheetFileName, sheetNote, type SetupMeta } from "./logic";
import { sampleSheets } from "./sample";
import { sheetTexts } from "./text";

// The setup sheets of the vault: reading them, writing a new one, and keeping the link
// from each trade note to the sheet of its setup (`review_setups`), for the graph. The
// link is a property of the trader's side: the sync never rewrites it.

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim() ? [v] : []);

/** Every setup sheet of the vault, read from the properties Obsidian keeps in memory. */
export function vaultMetas(app: App): SetupMeta[] {
	const out: SetupMeta[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const meta = metaFromProperties(app.metadataCache.getFileCache(file)?.frontmatter, file.path, file.basename);
		if (meta) out.push(meta);
	}
	// The same order every time, so that of two sheets with one name, the same one wins.
	return out.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? ""));
}

/** The sheets the figures use: the trader's, and with the sample journal the sample ones he has not written. */
export function setupMetas(app: App, sample: boolean): SetupMeta[] {
	const own = vaultMetas(app);
	if (!sample) return own;
	const names = indexMetas(own);
	return [...own, ...sampleSheets().map((s) => s.meta).filter((m) => !names.has(norm(m.name)))];
}

/** Path of the sheet of each setup name and alias. */
export function sheetPaths(app: App): Map<string, string> {
	const out = new Map<string, string>();
	for (const [k, m] of indexMetas(vaultMetas(app))) if (m.path) out.set(k, m.path);
	return out;
}

export interface Sheet {
	meta: SetupMeta;
	/** The note, null for a sheet of the sample journal. */
	file: TFile | null;
	content: string;
}

/** The sheets with their text, for their rules and playbook. */
export async function readSheets(app: App, sample: boolean): Promise<Sheet[]> {
	const out: Sheet[] = [];
	for (const meta of vaultMetas(app)) {
		const file = meta.path ? app.vault.getFileByPath(meta.path) : null;
		if (file) out.push({ meta, file, content: await app.vault.cachedRead(file) });
	}
	if (sample) {
		const names = indexMetas(out.map((s) => s.meta));
		for (const s of sampleSheets()) if (!names.has(norm(s.meta.name))) out.push({ meta: s.meta, file: null, content: s.content });
	}
	return out;
}

export function setupsFolder(plugin: TradoshiPlugin): string {
	return normalizePath(`${plugin.settings.folder.trim() || "Tradoshi"}/Setups`);
}

async function ensureFolder(app: App, path: string): Promise<void> {
	let current = "";
	for (const part of path.split("/")) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
	}
}

/** Writes the sheet of a setup in the Setups folder, and files its name as a setup. Returns the note. */
export async function createSheet(plugin: TradoshiPlugin, name: string, description = ""): Promise<TFile> {
	const app = plugin.app;
	const clean = name.trim();
	const folder = setupsFolder(plugin);
	await ensureFolder(app, folder);
	const base = sheetFileName(clean);
	let path = normalizePath(`${folder}/${base}.md`);
	for (let i = 2; app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}/${base} ${i}.md`);
	const file = await app.vault.create(path, sheetNote(clean, sheetTexts(), description.trim()));
	// A name typed here becomes a setup for the dashboard, the filters and the trade log too.
	if (!plugin.tagCategories()[clean]) {
		const own = plugin.moduleData<Record<string, string>>("manual-tags", {});
		await plugin.saveModuleData("manual-tags", { ...own, [clean]: "Setups" });
	}
	return file;
}

/** What tells one set of sheets from another for the links: their paths, names and aliases. */
const signature = (metas: SetupMeta[]): string => metas.map((m) => [m.path, m.name, ...m.aliases].join("|")).join("\n");

/**
 * Keeps `review_setups` of each trade note in line with its setups: a link to the sheet
 * of each one that has a sheet. Works on the notes that changed, a few seconds after the
 * last change, and on every note when a sheet appears, goes or is renamed. Nothing is
 * written with the sample journal.
 */
export class SetupLinker {
	private readonly paths = new Set<string>();
	private all = false;
	private running = false;
	private known = "";
	private readonly later: Debouncer<[], void>;

	constructor(private readonly plugin: TradoshiPlugin) {
		this.later = debounce(() => void this.flush(), 2500, true);
	}

	trade(path: string): void {
		this.paths.add(path);
		this.later();
	}

	everything(): void {
		this.all = true;
		this.later();
	}

	/** A sheet changed: every note is looked at again when the names of the sheets changed. */
	sheetsChanged(): void {
		if (signature(vaultMetas(this.plugin.app)) !== this.known) this.everything();
	}

	cancel(): void {
		this.later.cancel();
	}

	/** Writes the links that are missing or wrong. Returns how many notes changed. */
	async flush(): Promise<number> {
		if (this.running) {
			this.later();
			return 0;
		}
		if (!this.plugin.isConnected()) {
			this.paths.clear();
			this.all = false;
			return 0;
		}
		this.running = true;
		try {
			const app = this.plugin.app;
			const metas = vaultMetas(app);
			this.known = signature(metas);
			const sheets = indexMetas(metas);
			const files = this.all ? app.vault.getMarkdownFiles() : [...this.paths].map((p) => app.vault.getFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
			this.all = false;
			this.paths.clear();
			let n = 0;
			for (const file of files) if (await this.link(file, sheets)) n++;
			return n;
		} finally {
			this.running = false;
		}
	}

	private async link(file: TFile, sheets: Map<string, SetupMeta>): Promise<boolean> {
		const app = this.plugin.app;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm || typeof fm.tradoshi_id !== "string") return false;
		const wanted = new Map<string, string>();
		for (const tag of [...strings(fm.tradoshi_tags), ...strings(fm.review_tags)]) {
			const sheet = sheets.get(norm(tag));
			if (sheet?.path && !wanted.has(sheet.path)) wanted.set(sheet.path, setupLink(sheet.path, sheet.name));
		}
		const folder = `${setupsFolder(this.plugin)}/`;
		// An entry is a setup link when it points to a sheet, or into the Setups folder (a sheet deleted since).
		const resolve = (entry: string): string | null => {
			const target = linkTargetOf(entry);
			if (!target) return null;
			const dest = app.metadataCache.getFirstLinkpathDest(target, file.path);
			if (dest) return metaFromProperties(app.metadataCache.getFileCache(dest)?.frontmatter, dest.path, dest.basename) ? dest.path : null;
			return normalizePath(target).startsWith(folder) ? `missing:${target}` : null;
		};
		const next = nextSetupLinks(strings(fm.review_setups), resolve, wanted);
		if (!next) return false;
		await app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
			if (next.length) front.review_setups = next;
			else delete front.review_setups;
		});
		return true;
	}
}
