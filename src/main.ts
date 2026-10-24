import { Notice, Plugin, TFile, TFolder, addIcon, type ObsidianProtocolData, type TAbstractFile } from "obsidian";
import { fetchJournal, TradoshiError } from "./api";
import { ConnectModal } from "./connect-modal";
import { DASHBOARD_VIEW, DashboardView } from "./dashboard-view";
import { ImportModal } from "./import-modal";
import { t } from "./i18n";
import { keyFromProperties, OVERVIEW_KEY } from "./plan";
import { appLink, isValidTimeZone } from "./render";
import { APP_URL, DEFAULT_SETTINGS, TOKEN_SECRET_ID, TradoshiSettingTab, type TradoshiSettings } from "./settings";
import { historyFrom, indexVault, renderContext, writeImport, writeJournal } from "./sync";
import type { ApiDayNote, ApiTrade } from "./types";

const TOKEN_PATTERN = /^tsr_[A-Z0-9]{20,64}$/;

// The Tradoshi owl, drawn in the current text color like the core ribbon icons.
const TRADOSHI_ICON =
	'<g transform="scale(0.9615) translate(-8 -2)">' +
	'<path d="M40 25 L31 6 L55 22 Z" fill="currentColor"/><path d="M80 25 L89 6 L65 22 Z" fill="currentColor"/>' +
	'<path d="M60 15C33 15 21 33 21 55C21 80 39 100 60 100C81 100 99 80 99 55C99 33 87 15 60 15Z" fill="none" stroke="currentColor" stroke-width="7"/>' +
	'<circle cx="45.5" cy="55" r="12" fill="none" stroke="currentColor" stroke-width="6"/>' +
	'<circle cx="74.5" cy="55" r="12" fill="none" stroke="currentColor" stroke-width="6"/>' +
	'<circle cx="45.5" cy="55" r="4.5" fill="currentColor"/><circle cx="74.5" cy="55" r="4.5" fill="currentColor"/>' +
	'<path d="M60 66 L54 77 L66 77 Z" fill="currentColor"/></g>';

// Settings that change which notes are written: a full sync is needed afterwards.
const RESYNC_KEYS = new Set([
	"tokenSecret",
	"folder",
	"history",
	"tradeNotes",
	"dailyNotes",
	"includeDemo",
	"includeArchived",
	"appLinks",
	"timeZone",
	"dayStartHour",
]);

const systemTimeZone = (): string => {
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return tz && isValidTimeZone(tz) ? tz : "UTC";
};

export default class TradoshiPlugin extends Plugin {
	settings: TradoshiSettings = { ...DEFAULT_SETTINGS };
	private syncing = false;
	private autoSyncTimer: number | null = null;
	// A rejected token is reported once per session, not at every automatic sync.
	private tokenWarned = false;
	/** Identity of every Tradoshi note, by path, kept up to date as the trader edits the vault. */
	private keyByPath = new Map<string, string>();
	private saveTimer: number | null = null;
	/** Day notes written in Tradoshi, from the last sync, kept when an imported file rebuilds the days. */
	private lastDayNotes: ApiDayNote[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new TradoshiSettingTab(this.app, this));

		addIcon("tradoshi", TRADOSHI_ICON);
		this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, this));
		this.addRibbonIcon("tradoshi", t("ribbon"), () => void this.openDashboard());

		this.addCommand({
			id: "sync-now",
			name: t("cmdSync"),
			callback: () => void this.sync(true),
		});
		this.addCommand({
			id: "open-dashboard",
			name: t("cmdDashboard"),
			callback: () => void this.openDashboard(),
		});
		this.addCommand({
			id: "open-overview",
			name: t("cmdOverview"),
			callback: () => void this.openOverview(),
		});
		this.addCommand({
			id: "open-web-app",
			name: t("cmdWebApp"),
			callback: () => window.open(this.link("command")),
		});
		this.addCommand({
			id: "import-statement",
			name: t("importStatement"),
			callback: () => this.openImport(),
		});
		this.addCommand({
			id: "restore-deleted-notes",
			name: t("cmdRestore"),
			callback: () => void this.restoreDeletedNotes(),
		});

		// obsidian://tradoshi?token=… is opened by the "Connect Obsidian" button of the app.
		this.registerObsidianProtocolHandler("tradoshi", (params) => this.onConnectLink(params));

		this.app.workspace.onLayoutReady(() => {
			this.keyByPath = indexVault(this.app).byPath;
			this.watchVault();
			// First run: the dashboard opens by itself, with the sample journal until an account is connected.
			if (!this.settings.dashboardOpened) {
				this.settings.dashboardOpened = true;
				void this.saveSettings().then(() => this.openDashboard());
			}
			if (this.settings.syncOnStartup && this.getToken()) void this.sync(false);
		});
		this.scheduleAutoSync();
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<TradoshiSettings> | null) };
		if (!Array.isArray(this.settings.deletedKeys)) this.settings.deletedKeys = [];
		// The time zone is taken from the computer once, then kept: a trader who moves,
		// or opens the vault on a computer set to another zone, keeps the same days.
		if (!this.settings.timeZone || !isValidTimeZone(this.settings.timeZone)) {
			this.settings.timeZone = systemTimeZone();
			await this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async onSettingsChanged(key: string): Promise<void> {
		if (key === "timeZone") this.settings.timeZone = this.settings.timeZone.trim();
		if (RESYNC_KEYS.has(key)) {
			this.settings.lastSync = null;
			await this.saveSettings();
		}
		if (key === "autoSyncMinutes") this.scheduleAutoSync();
	}

	// ── What the trader does in the vault ──────────────────────────────────────

	private watchVault(): void {
		this.registerEvent(
			this.app.metadataCache.on("changed", (file, _data, cache) => {
				const key = keyFromProperties(cache.frontmatter);
				if (key) this.keyByPath.set(file.path, key);
				else this.keyByPath.delete(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				for (const [path, key] of this.entriesUnder(oldPath, file instanceof TFolder)) {
					this.keyByPath.delete(path);
					this.keyByPath.set(file.path + path.slice(oldPath.length), key);
				}
			}),
		);
		this.registerEvent(this.app.vault.on("delete", (file) => this.onDelete(file)));
	}

	private entriesUnder(path: string, isFolder: boolean): [string, string][] {
		if (!isFolder) {
			const key = this.keyByPath.get(path);
			return key ? [[path, key]] : [];
		}
		return [...this.keyByPath].filter(([p]) => p.startsWith(path + "/"));
	}

	/** A note deleted by the trader is remembered, so the next sync does not bring it back. */
	private onDelete(file: TAbstractFile): void {
		const gone = this.entriesUnder(file.path, file instanceof TFolder || !(file instanceof TFile));
		if (!gone.length) return;
		const deleted = new Set(this.settings.deletedKeys);
		for (const [path, key] of gone) {
			this.keyByPath.delete(path);
			if (key !== OVERVIEW_KEY) deleted.add(key);
		}
		this.settings.deletedKeys = [...deleted];
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveSettings();
		}, 1000);
	}

	async restoreDeletedNotes(): Promise<void> {
		const count = this.settings.deletedKeys.length;
		this.settings.deletedKeys = [];
		this.settings.lastSync = null;
		await this.saveSettings();
		new Notice(`Tradoshi: ${count ? t("nRestore", { n: count }) : t("nNoRestore")}`);
		if (count) await this.sync(true);
	}

	// ── Connection ────────────────────────────────────────────────────────────

	get appUrl(): string {
		return APP_URL;
	}

	/** Sign-up link of the web app, counted as coming from Obsidian. */
	signupLink(campaign: string): string {
		return appLink(renderContext(this.settings), campaign, "params", "section=obsidian");
	}

	openImport(): void {
		new ImportModal(this.app, this).open();
	}

	/** Writes the trades of a file read on this computer. Returns how many were imported. */
	async importTrades(account: { name: string; broker: string | null; currency: string }, trades: ApiTrade[]): Promise<number> {
		await writeImport(this.app, this.settings, account, trades, this.lastDayNotes);
		window.setTimeout(() => this.refreshDashboards(), 1500);
		await this.openDashboard();
		return trades.length;
	}

	isConnected(): boolean {
		return this.getToken() !== null;
	}

	/** Path of the note carrying an identity ("trade:…", "day:YYYY-MM-DD"), if it exists. */
	pathForKey(key: string): string | null {
		for (const [path, k] of this.keyByPath) if (k === key) return path;
		return null;
	}

	async openDashboard(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0];
		const leaf = existing ?? this.app.workspace.getLeaf("tab");
		if (!existing) await leaf.setViewState({ type: DASHBOARD_VIEW, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private refreshDashboards(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) {
			if (leaf.view instanceof DashboardView) leaf.view.refresh();
		}
	}

	private getToken(): string | null {
		const token = this.app.secretStorage.getSecret(this.settings.tokenSecret || TOKEN_SECRET_ID);
		return token && token.trim() ? token.trim() : null;
	}

	private link(campaign: string): string {
		return appLink(renderContext(this.settings), campaign);
	}

	private scheduleAutoSync(): void {
		if (this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
		this.autoSyncTimer = null;
		const minutes = Number(this.settings.autoSyncMinutes);
		if (!Number.isFinite(minutes) || minutes <= 0) return;
		this.autoSyncTimer = window.setInterval(() => void this.sync(false), minutes * 60000);
		this.registerInterval(this.autoSyncTimer);
	}

	private onConnectLink(params: ObsidianProtocolData): void {
		const token = (params.token ?? "").trim();
		if (!TOKEN_PATTERN.test(token)) {
			new Notice(`Tradoshi: ${t("nBadLink")}`);
			return;
		}
		// The dashboard first: it brings the main window forward, so the confirmation opens there
		// and not in a detached window, with the sample journal behind it.
		void this.openDashboard().then(() => {
			new ConnectModal(this.app, this.settings.folder, () => {
				void (async () => {
					this.app.secretStorage.setSecret(TOKEN_SECRET_ID, token);
					this.settings.tokenSecret = TOKEN_SECRET_ID;
					this.settings.lastSync = null;
					this.tokenWarned = false;
					await this.saveSettings();
					new Notice(`Tradoshi: ${t("nConnected")}`);
					await this.sync(true);
					await this.openDashboard();
				})();
			}).open();
		});
	}

	private overviewFile(): TFile | null {
		for (const [path, key] of this.keyByPath) {
			if (key !== OVERVIEW_KEY) continue;
			const file = this.app.vault.getFileByPath(path);
			if (file) return file;
		}
		return null;
	}

	private async openOverview(): Promise<void> {
		const file = this.overviewFile();
		if (!file) {
			new Notice(`Tradoshi: ${t("nNoOverview")}`);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	// ── Sync ──────────────────────────────────────────────────────────────────

	/**
	 * Fetches the journal and writes the notes. An automatic sync first asks only
	 * for what changed since the last one, and stops there when nothing did.
	 */
	async sync(manual: boolean): Promise<void> {
		if (this.syncing) {
			if (manual) new Notice(`Tradoshi: ${t("nSyncRunning")}`);
			return;
		}
		const token = this.getToken();
		if (!token) {
			if (manual) new Notice(`Tradoshi: ${t("nAddToken")}`);
			return;
		}
		this.syncing = true;
		try {
			const from = historyFrom(this.settings.history);
			const clientVersion = this.manifest.version;
			// The quick check is skipped when the overview note is gone: the trader may
			// have deleted the folder, and "nothing changed" would never write it again.
			if (!manual && this.settings.lastSync && this.overviewFile()) {
				const delta = await fetchJournal(token, { from, since: this.settings.lastSync, clientVersion });
				if (delta.accounts.every((a) => !a.changed) && delta.notes.length === 0) return;
			}
			const data = await fetchJournal(token, { from, since: null, clientVersion });
			this.lastDayNotes = data.notes;
			const stats = await writeJournal(this.app, data, this.settings);
			this.settings.tagCategories = Object.fromEntries(data.tags.map((tag) => [tag.name, tag.category ?? ""]));
			this.settings.lastSync = data.generatedAt;
			await this.saveSettings();
			if (manual || stats.created + stats.updated > 0) {
				new Notice(`Tradoshi: ${t("nSynced", { c: stats.created, u: stats.updated })}`);
			}
			// Notes just written are read by the dashboard once Obsidian has indexed them.
			window.setTimeout(() => this.refreshDashboards(), 1500);
		} catch (e) {
			const message = e instanceof TradoshiError ? e.message : t("nUnexpected");
			const tokenProblem = e instanceof TradoshiError && e.status === 401;
			if (manual || (tokenProblem && !this.tokenWarned)) new Notice(`Tradoshi: ${message}`, 10000);
			if (tokenProblem) this.tokenWarned = true;
			console.error("Tradoshi sync failed", e);
		} finally {
			this.syncing = false;
		}
	}
}
