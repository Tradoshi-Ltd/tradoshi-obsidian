import { Notice, Plugin, TFile, TFolder, addIcon, type ObsidianProtocolData, type TAbstractFile } from "obsidian";
import { fetchJournal, fetchPairing, TradoshiError } from "./api";
import { ConnectModal } from "./connect-modal";
import { DASHBOARD_VIEW, DashboardView } from "./dashboard-view";
import { NO_FILTERS } from "./filters";
import { ImportModal } from "./import-modal";
import { t } from "./i18n";
import { modules } from "./modules";
import { normalizeOffer, offerEvents, openLock } from "./offer";
import { newPairing, openSealed } from "./pairing";
import { keyFromProperties, OVERVIEW_KEY } from "./plan";
import { appLink, isValidTimeZone } from "./render";
import { APP_URL, DEFAULT_SETTINGS, TOKEN_SECRET_ID, TradoshiSettingTab, type TradoshiSettings } from "./settings";
import { historyFrom, indexVault, renderContext, writeImport, writeJournal } from "./sync";
import type { ApiDayNote, ApiTrade, JournalResponse } from "./types";

const TOKEN_PATTERN = /^tsr_[A-Z0-9]{20,64}$/;
/** A one-click connection waits this long for the trader's approval (sign-up and email included). */
const PAIRING_LIFETIME = 2 * 3600 * 1000;
/** An automatic sync downloads the whole journal at least this often. */
const FULL_SYNC_EVERY = 24 * 3600 * 1000;

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
	/** The trader was told once this session that sync needs the Essential plan. */
	private planWarned = false;
	/** A vault waiting for the trader to approve it in Tradoshi (one-click connection). */
	private pairing: { id: string; key: CryptoKey; started: number } | null = null;
	private pairingTimer: number | null = null;
	/** Identity of every Tradoshi note, by path, kept up to date as the trader edits the vault. */
	private keyByPath = new Map<string, string>();
	private saveTimer: number | null = null;
	/** Day notes written in Tradoshi, from the last sync, kept when an imported file rebuilds the days. */
	private lastDayNotes: ApiDayNote[] = [];
	/** When this session last downloaded the whole journal; null until it has. */
	private lastFullSync: number | null = null;

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
		this.register(() => {
			if (this.pairingTimer !== null) window.clearTimeout(this.pairingTimer);
		});

		for (const m of modules()) m.load(this);

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
		if (!Array.isArray(this.settings.layout)) this.settings.layout = [];
		this.settings.filters = { ...NO_FILTERS, ...(this.settings.filters ?? {}) };
		if (!this.settings.modules || typeof this.settings.modules !== "object") this.settings.modules = {};
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

	/** The data a module keeps, or its default the first time. */
	moduleData<T>(id: string, fallback: T): T {
		return (this.settings.modules[id] as T | undefined) ?? fallback;
	}

	async saveModuleData(id: string, value: unknown): Promise<void> {
		this.settings.modules[id] = value;
		await this.saveSettings();
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

	/**
	 * Connects this vault in one click: Tradoshi opens in the browser, the trader signs in
	 * or creates a free account and approves the vault, and it connects by itself.
	 */
	connect(campaign: string): void {
		void (async () => {
			let pairing;
			try {
				pairing = await newPairing();
			} catch {
				// No Web Crypto here: the page where a token is created by hand.
				window.open(this.signupLink(campaign));
				return;
			}
			this.pairing = { id: pairing.id, key: pairing.privateKey, started: Date.now() };
			window.open(appLink(renderContext(this.settings), campaign, "params", `section=obsidian&obsidian_pair=${pairing.id}&obsidian_key=${pairing.publicKey}`));
			new Notice(`Tradoshi: ${t("nPairWaiting")}`, 10000);
			this.refreshDashboards();
			this.schedulePairing(3000);
		})();
	}

	/** A connection started from this vault is waiting for the trader's approval. */
	pairingPending(): boolean {
		return this.pairing !== null;
	}

	private schedulePairing(delay: number): void {
		if (this.pairingTimer !== null) window.clearTimeout(this.pairingTimer);
		this.pairingTimer = window.setTimeout(() => void this.pollPairing(), delay);
	}

	private async pollPairing(): Promise<void> {
		this.pairingTimer = null;
		const pairing = this.pairing;
		if (!pairing) return;
		const age = Date.now() - pairing.started;
		if (age > PAIRING_LIFETIME) {
			this.pairing = null;
			new Notice(`Tradoshi: ${t("nPairExpired")}`, 10000);
			this.refreshDashboards();
			return;
		}
		try {
			const answer = await fetchPairing(pairing.id);
			if (answer.status === "ready") {
				const token = (await openSealed(pairing.key, answer.sealed)).trim();
				if (this.pairing !== pairing) return;
				this.pairing = null;
				if (TOKEN_PATTERN.test(token)) await this.useToken(token);
				else new Notice(`Tradoshi: ${t("nBadLink")}`);
				return;
			}
		} catch (e) {
			// A network hiccup: the next try will do.
			console.error("Tradoshi pairing", e);
		}
		// Every 3 seconds while the trader is likely in the browser, then every 15.
		if (this.pairing === pairing) this.schedulePairing(age < 10 * 60000 ? 3000 : 15000);
	}

	/** Keeps the access token of this vault, then brings the journal in. */
	private async useToken(token: string): Promise<void> {
		this.app.secretStorage.setSecret(TOKEN_SECRET_ID, token);
		this.settings.tokenSecret = TOKEN_SECRET_ID;
		this.settings.lastSync = null;
		this.settings.offer = null;
		this.tokenWarned = false;
		this.planWarned = false;
		await this.saveSettings();
		new Notice(`Tradoshi: ${t("nConnected")}`);
		await this.openDashboard();
		await this.sync(true);
		this.refreshDashboards();
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

	/** Writes trades entered or edited by hand in an account of the vault; nothing is sent. */
	async saveManualTrades(account: { name: string; broker: string | null; currency: string }, trades: ApiTrade[]): Promise<void> {
		await writeImport(this.app, this.settings, account, trades, this.lastDayNotes);
		window.setTimeout(() => this.refreshDashboards(), 1500);
	}

	/** Category of each tag: those of Tradoshi, and those given to tags entered by hand. */
	tagCategories(): Record<string, string> {
		return { ...this.moduleData<Record<string, string>>("manual-tags", {}), ...this.settings.tagCategories };
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

	/** Redraws every open dashboard, after the notes or a module's data changed. */
	refreshDashboards(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) {
			if (leaf.view instanceof DashboardView) leaf.view.refresh();
		}
	}

	/** Redraws every view that shows a paid feature, after the plan of the account changed. */
	offerChanged(): void {
		for (const f of offerEvents) f();
		this.refreshDashboards();
	}

	private getToken(): string | null {
		const token = this.app.secretStorage.getSecret(this.settings.tokenSecret || TOKEN_SECRET_ID);
		return token && token.trim() ? token.trim() : null;
	}

	private link(campaign: string): string {
		return appLink(renderContext(this.settings), campaign);
	}

	/** The screen of the app where a broker or prop firm account is connected. */
	brokerLink(campaign: string): string {
		return appLink(renderContext(this.settings), campaign, "import");
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
			new ConnectModal(this.app, this.settings.folder, () => void this.useToken(token)).open();
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

	async openOverview(): Promise<void> {
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
			let data: JournalResponse | null = null;
			let stats: { created: number; updated: number };
			// The quick check is skipped when the overview note is gone: the trader may
			// have deleted the folder, and "nothing changed" would never write it again.
			if (!manual && this.settings.lastSync && this.overviewFile()) {
				const delta = await fetchJournal(token, { from, since: this.settings.lastSync, clientVersion });
				if (delta.accounts.every((a) => !a.changed) && delta.notes.length === 0) return;
				// Only what changed is downloaded and written. The first sync of a session,
				// and one a day, stay complete: they bring the Tradoshi text of every day
				// note, which a partial sync needs to rewrite a day without losing it.
				if (this.lastFullSync && Date.now() - this.lastFullSync < FULL_SYNC_EVERY) data = delta;
			}
			if (data) {
				const notes = new Map(this.lastDayNotes.map((n) => [n.date, n]));
				for (const n of data.notes) notes.set(n.date, n);
				this.lastDayNotes = [...notes.values()];
				stats = await writeJournal(this.app, data, this.settings, this.lastDayNotes, { noteDates: data.notes.map((n) => n.date) });
			} else {
				data = await fetchJournal(token, { from, since: null, clientVersion });
				this.lastDayNotes = data.notes;
				stats = await writeJournal(this.app, data, this.settings);
				this.lastFullSync = Date.now();
			}
			this.settings.tagCategories = Object.fromEntries(data.tags.map((tag) => [tag.name, tag.category ?? ""]));
			this.settings.lastSync = data.generatedAt;
			// An unreadable plan keeps the last one known, so a paid feature is not closed by mistake.
			const before = this.settings.offer?.code ?? null;
			if (data.plan) this.settings.offer = { code: normalizeOffer(data.plan.code), trial: data.plan.trial, until: data.plan.until, at: data.generatedAt };
			await this.saveSettings();
			if (manual || stats.created + stats.updated > 0) {
				new Notice(`Tradoshi: ${t("nSynced", { c: stats.created, u: stats.updated })}`);
			}
			if ((this.settings.offer?.code ?? null) !== before) this.offerChanged();
			// Notes just written are read by the dashboard once Obsidian has indexed them.
			window.setTimeout(() => this.refreshDashboards(), 1500);
		} catch (e) {
			// Sync is part of the Essential plan: the vault keeps what it has, imports and
			// trades entered by hand go on, and the trader is told once, or each time he asks.
			if (e instanceof TradoshiError && e.code === "plan_required") {
				const changed = this.settings.offer?.code !== "gratuit";
				this.settings.offer = { code: "gratuit", trial: false, until: null, at: new Date().toISOString() };
				await this.saveSettings();
				if (changed) this.offerChanged();
				if (manual || !this.planWarned) openLock(this, "essentiel", t("syncTitle"));
				this.planWarned = true;
				return;
			}
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
