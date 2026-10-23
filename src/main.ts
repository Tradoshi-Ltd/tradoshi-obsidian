import { Notice, Plugin, normalizePath, type ObsidianProtocolData } from "obsidian";
import { fetchJournal, TradoshiError } from "./api";
import { ConnectModal } from "./connect-modal";
import { appLink, overviewPath } from "./render";
import { APP_URL, DEFAULT_SETTINGS, TOKEN_SECRET_ID, TradoshiSettingTab, type TradoshiSettings } from "./settings";
import { historyFrom, writeJournal } from "./sync";

const TOKEN_PATTERN = /^tsr_[A-Z0-9]{20,64}$/;

// Settings that change which notes are written: a full sync is needed afterwards.
const RESYNC_KEYS = new Set(["tokenSecret", "folder", "history", "tradeNotes", "dailyNotes", "includeDemo", "includeArchived", "appLinks"]);

export default class TradoshiPlugin extends Plugin {
	settings: TradoshiSettings = { ...DEFAULT_SETTINGS };
	private syncing = false;
	private autoSyncTimer: number | null = null;
	// A rejected token is reported once per session, not at every automatic sync.
	private tokenWarned = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new TradoshiSettingTab(this.app, this));

		this.addRibbonIcon("chart-candlestick", "Sync Tradoshi journal", () => void this.sync(true));

		this.addCommand({
			id: "sync-now",
			name: "Sync journal now",
			callback: () => void this.sync(true),
		});
		this.addCommand({
			id: "open-overview",
			name: "Open the overview note",
			callback: () => void this.openOverview(),
		});
		this.addCommand({
			id: "open-web-app",
			name: "Open the web app",
			callback: () => window.open(this.link("command")),
		});

		// obsidian://tradoshi?token=… is opened by the "Connect Obsidian" button of the app.
		this.registerObsidianProtocolHandler("tradoshi", (params) => this.onConnectLink(params));

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnStartup && this.getToken()) void this.sync(false);
		});
		this.scheduleAutoSync();
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<TradoshiSettings> | null) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async onSettingsChanged(key: string): Promise<void> {
		if (RESYNC_KEYS.has(key)) {
			this.settings.lastSync = null;
			await this.saveSettings();
		}
		if (key === "autoSyncMinutes") this.scheduleAutoSync();
	}

	private getToken(): string | null {
		const token = this.app.secretStorage.getSecret(this.settings.tokenSecret || TOKEN_SECRET_ID);
		return token && token.trim() ? token.trim() : null;
	}

	private link(campaign: string): string {
		return appLink({ folder: "", appUrl: APP_URL, appLinks: true, tradeNotes: true, dailyNotes: true }, campaign);
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
			new Notice("Tradoshi: this link does not carry a valid access token. Create a new one in Tradoshi.");
			return;
		}
		new ConnectModal(this.app, this.settings.folder, () => {
			void (async () => {
				this.app.secretStorage.setSecret(TOKEN_SECRET_ID, token);
				this.settings.tokenSecret = TOKEN_SECRET_ID;
				this.settings.lastSync = null;
				this.tokenWarned = false;
				await this.saveSettings();
				new Notice("Tradoshi: connected. Your journal is on its way.");
				await this.sync(true);
				await this.openOverview();
			})();
		}).open();
	}

	private async openOverview(): Promise<void> {
		const path = overviewPath({ folder: normalizePath(this.settings.folder || "Tradoshi"), appUrl: APP_URL, appLinks: true, tradeNotes: true, dailyNotes: true });
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			new Notice("Tradoshi: run a first sync to create the overview note.");
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	/**
	 * Fetches the journal and writes the notes. An automatic sync first asks only
	 * for what changed since the last one, and stops there when nothing did.
	 */
	async sync(manual: boolean): Promise<void> {
		if (this.syncing) {
			if (manual) new Notice("Tradoshi: a sync is already running.");
			return;
		}
		const token = this.getToken();
		if (!token) {
			if (manual) new Notice("Tradoshi: add your access token in the settings first.");
			return;
		}
		this.syncing = true;
		try {
			const from = historyFrom(this.settings.history);
			const clientVersion = this.manifest.version;
			if (!manual && this.settings.lastSync) {
				const delta = await fetchJournal(token, { from, since: this.settings.lastSync, clientVersion });
				if (delta.accounts.every((a) => !a.changed) && delta.notes.length === 0) return;
			}
			const data = await fetchJournal(token, { from, since: null, clientVersion });
			const stats = await writeJournal(this.app, data, this.settings);
			this.settings.lastSync = data.generatedAt;
			await this.saveSettings();
			if (manual || stats.created + stats.updated > 0) {
				new Notice(`Tradoshi: ${stats.created} notes created, ${stats.updated} updated.`);
			}
		} catch (e) {
			const message = e instanceof TradoshiError ? e.message : "the sync stopped on an unexpected error.";
			const tokenProblem = e instanceof TradoshiError && e.status === 401;
			if (manual || (tokenProblem && !this.tokenWarned)) new Notice(`Tradoshi: ${message}`, 10000);
			if (tokenProblem) this.tokenWarned = true;
			console.error("Tradoshi sync failed", e);
		} finally {
			this.syncing = false;
		}
	}
}
