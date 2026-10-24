// Decides, for each note the journal needs, whether to update an existing note,
// create a new one or leave it alone. Pure, so it can be tested without Obsidian.
//
// A note is found by its identity (a trade id, a trading day), never by its path:
// a note the trader renamed or moved keeps receiving its updates where it is, and
// a note the trader deleted is not written again.

export type NoteAction = { kind: "create"; path: string } | { kind: "update"; path: string } | { kind: "skip" };

export interface VaultView {
	/** Path of the note that carries this identity, if any. */
	pathOf(key: string): string | undefined;
	/** Identity carried by the note at this path, if any. */
	keyAt(path: string): string | undefined;
	exists(path: string): boolean;
}

export const tradeNoteKey = (tradoshiId: string): string => `trade:${tradoshiId}`;
export const dayNoteKey = (date: string): string => `day:${date}`;
export const OVERVIEW_KEY = "overview";

export function planNote(key: string, desiredPath: string, vault: VaultView, deleted: ReadonlySet<string>): NoteAction {
	if (deleted.has(key)) return { kind: "skip" };
	const known = vault.pathOf(key);
	if (known) return { kind: "update", path: known };
	// The usual path is taken by another note (another trade with the same name,
	// or a note of the trader): the new note gets a numbered name next to it.
	let path = desiredPath;
	for (let n = 2; vault.exists(path) && vault.keyAt(path) !== key; n++) {
		path = desiredPath.replace(/\.md$/, ` (${n}).md`);
	}
	return vault.exists(path) ? { kind: "update", path } : { kind: "create", path };
}

/** Identity of a note from its properties, including notes written by version 1.0. */
export function keyFromProperties(fm: Record<string, unknown> | undefined): string | undefined {
	if (!fm) return undefined;
	if (typeof fm.tradoshi_id === "string" && fm.tradoshi_id) return tradeNoteKey(fm.tradoshi_id);
	if (typeof fm.tradoshi_day === "string" && fm.tradoshi_day) return dayNoteKey(fm.tradoshi_day);
	if (fm.tradoshi_overview === true) return OVERVIEW_KEY;
	const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
	if (tags.includes("tradoshi/day") && typeof fm.date === "string") return dayNoteKey(fm.date);
	if (tags.includes("tradoshi/overview")) return OVERVIEW_KEY;
	return undefined;
}

/** A view of the vault that also remembers the notes planned in the current sync. */
export class PlannedVault implements VaultView {
	private readonly claimedByKey = new Map<string, string>();
	private readonly claimedByPath = new Map<string, string>();

	constructor(
		private readonly byKey: ReadonlyMap<string, string>,
		private readonly byPath: ReadonlyMap<string, string>,
		private readonly fileExists: (path: string) => boolean,
	) {}

	pathOf(key: string): string | undefined {
		return this.claimedByKey.get(key) ?? this.byKey.get(key);
	}

	keyAt(path: string): string | undefined {
		return this.claimedByPath.get(path) ?? this.byPath.get(path);
	}

	exists(path: string): boolean {
		return this.claimedByPath.has(path) || this.fileExists(path);
	}

	/** Plans the note and reserves its path, so two new notes never get the same one. */
	plan(key: string, desiredPath: string, deleted: ReadonlySet<string>): NoteAction {
		const action = planNote(key, desiredPath, this, deleted);
		if (action.kind !== "skip") {
			this.claimedByKey.set(key, action.path);
			this.claimedByPath.set(action.path, key);
		}
		return action;
	}
}
