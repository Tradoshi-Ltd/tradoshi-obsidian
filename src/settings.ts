import { normalizePath, PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
import type TradoshiPlugin from "./main";
import { appLink } from "./render";

export const TOKEN_SECRET_ID = "tradoshi-access-token";

export interface TradoshiSettings {
	/** Id of the secret, in Obsidian's secret storage, that holds the access token. */
	tokenSecret: string;
	folder: string;
	history: string;
	tradeNotes: boolean;
	dailyNotes: boolean;
	includeDemo: boolean;
	includeArchived: boolean;
	appLinks: boolean;
	syncOnStartup: boolean;
	autoSyncMinutes: string;
	/** Server time of the last complete sync, used to ask only for what changed. */
	lastSync: string | null;
}

export const DEFAULT_SETTINGS: TradoshiSettings = {
	tokenSecret: TOKEN_SECRET_ID,
	folder: "Tradoshi",
	history: "90",
	tradeNotes: true,
	dailyNotes: true,
	includeDemo: false,
	includeArchived: false,
	appLinks: true,
	syncOnStartup: true,
	autoSyncMinutes: "60",
	lastSync: null,
};

export const APP_URL = "https://app.tradoshi.com";

export class TradoshiSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const ctx = { folder: "", appUrl: APP_URL, appLinks: true, tradeNotes: true, dailyNotes: true };
		return [
			{
				type: "group",
				heading: "Account",
				items: [
					{
						name: "Access token",
						desc: "Create it in Tradoshi, under Settings, Obsidian. The token can only read your journal, and it is kept in the secret storage of Obsidian.",
						control: { type: "secret", key: "tokenSecret", defaultValue: TOKEN_SECRET_ID },
					},
					{
						name: "Get an access token",
						desc: "Opens Tradoshi in your browser. From there, one click sends the token back to this vault.",
						action: () => window.open(appLink(ctx, "settings", "params", "section=obsidian")),
					},
					{
						name: "Create a free Tradoshi account",
						desc: "Manual entry and file imports are free. Automatic sync from your broker is part of the paid plans, with a free trial.",
						action: () => window.open(appLink(ctx, "signup", "")),
					},
				],
			},
			{
				type: "group",
				heading: "Notes",
				items: [
					{
						name: "Folder",
						desc: "Where the plugin writes its notes.",
						control: {
							type: "folder",
							key: "folder",
							defaultValue: DEFAULT_SETTINGS.folder,
							validate: (value: string) => (normalizePath(value || "") === "/" || !value.trim() ? "Choose a folder." : undefined),
						},
					},
					{
						name: "History",
						desc: "How far back trades and day notes are written.",
						control: {
							type: "dropdown",
							key: "history",
							defaultValue: DEFAULT_SETTINGS.history,
							options: { "30": "Last 30 days", "90": "Last 90 days", "365": "Last 12 months", "0": "Everything" },
						},
					},
					{
						name: "One note per trade",
						control: { type: "toggle", key: "tradeNotes", defaultValue: true },
					},
					{
						name: "One note per trading day",
						control: { type: "toggle", key: "dailyNotes", defaultValue: true },
					},
					{
						name: "Include demo accounts",
						control: { type: "toggle", key: "includeDemo", defaultValue: false },
					},
					{
						name: "Include archived accounts",
						control: { type: "toggle", key: "includeArchived", defaultValue: false },
					},
					{
						name: "Links back to Tradoshi",
						desc: "Adds a link to replay each trade and review each day in Tradoshi.",
						control: { type: "toggle", key: "appLinks", defaultValue: true },
					},
				],
			},
			{
				type: "group",
				heading: "Sync",
				items: [
					{
						name: "Sync when the vault opens",
						control: { type: "toggle", key: "syncOnStartup", defaultValue: true },
					},
					{
						name: "Sync automatically",
						control: {
							type: "dropdown",
							key: "autoSyncMinutes",
							defaultValue: DEFAULT_SETTINGS.autoSyncMinutes,
							options: { "0": "Off", "30": "Every 30 minutes", "60": "Every hour", "240": "Every 4 hours" },
						},
					},
					{
						name: "Sync now",
						desc: "Fetches your journal and updates the notes.",
						action: () => void this.plugin.sync(true),
					},
				],
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		await this.plugin.onSettingsChanged(key);
	}
}
