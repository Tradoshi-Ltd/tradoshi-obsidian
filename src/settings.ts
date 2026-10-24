import { normalizePath, PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
import type TradoshiPlugin from "./main";
import { language, t } from "./i18n";
import { appLink, guideLink, isValidTimeZone } from "./render";

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
	/** IANA time zone of the journal. Set once from the computer, so moving does not shift any day. */
	timeZone: string;
	/** Hour, as a string from "0" to "23", at which a trading day starts. */
	dayStartHour: string;
	/** Identities of the notes the trader deleted: they are not written again. */
	deletedKeys: string[];
	/** Category of each Tradoshi tag ("Setups", "Mistakes"…), read at each sync. */
	tagCategories: Record<string, string>;
	/** The dashboard opens by itself once, the first time the plugin runs. */
	dashboardOpened: boolean;
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
	timeZone: "",
	dayStartHour: "0",
	deletedKeys: [],
	tagCategories: {},
	dashboardOpened: false,
	lastSync: null,
};

const hours = (): Record<string, string> =>
	Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), h === 0 ? t("sMidnight") : `${String(h).padStart(2, "0")}:00`]));

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
				heading: t("sAccount"),
				items: [
					{
						name: t("sToken"),
						desc: t("sTokenDesc"),
						control: { type: "secret", key: "tokenSecret", defaultValue: TOKEN_SECRET_ID },
					},
					{
						name: t("sGetToken"),
						desc: t("sGetTokenDesc"),
						action: () => window.open(appLink(ctx, "settings", "params", "section=obsidian")),
					},
					{
						name: t("sGuide"),
						desc: t("sGuideDesc"),
						action: () => window.open(guideLink(language(), "settings")),
					},
					{
						name: t("sCreate"),
						desc: t("sCreateDesc"),
						action: () => window.open(appLink(ctx, "signup", "")),
					},
				],
			},
			{
				type: "group",
				heading: t("sNotes"),
				items: [
					{
						name: t("sFolder"),
						desc: t("sFolderDesc"),
						control: {
							type: "folder",
							key: "folder",
							defaultValue: DEFAULT_SETTINGS.folder,
							validate: (value: string) => (normalizePath(value || "") === "/" || !value.trim() ? t("sFolderInvalid") : undefined),
						},
					},
					{
						name: t("sHistory"),
						desc: t("sHistoryDesc"),
						control: {
							type: "dropdown",
							key: "history",
							defaultValue: DEFAULT_SETTINGS.history,
							options: { "30": t("h30"), "90": t("h90"), "365": t("h365"), "0": t("hAll") },
						},
					},
					{
						name: t("sTradeNotes"),
						control: { type: "toggle", key: "tradeNotes", defaultValue: true },
					},
					{
						name: t("sDayNotes"),
						control: { type: "toggle", key: "dailyNotes", defaultValue: true },
					},
					{
						name: t("sDemo"),
						control: { type: "toggle", key: "includeDemo", defaultValue: false },
					},
					{
						name: t("sArchived"),
						control: { type: "toggle", key: "includeArchived", defaultValue: false },
					},
					{
						name: t("sLinks"),
						desc: t("sLinksDesc"),
						control: { type: "toggle", key: "appLinks", defaultValue: true },
					},
				],
			},
			{
				type: "group",
				heading: t("sDay"),
				items: [
					{
						name: t("sTz"),
						desc: t("sTzDesc"),
						control: {
							type: "text",
							key: "timeZone",
							placeholder: "Europe/Paris",
							validate: (value: string) => (isValidTimeZone(value.trim()) ? undefined : t("sTzInvalid")),
						},
					},
					{
						name: t("sDayStart"),
						desc: t("sDayStartDesc"),
						control: { type: "dropdown", key: "dayStartHour", defaultValue: "0", options: hours() },
					},
				],
			},
			{
				type: "group",
				heading: t("sSync"),
				items: [
					{
						name: t("sOnStart"),
						control: { type: "toggle", key: "syncOnStartup", defaultValue: true },
					},
					{
						name: t("sAuto"),
						control: {
							type: "dropdown",
							key: "autoSyncMinutes",
							defaultValue: DEFAULT_SETTINGS.autoSyncMinutes,
							options: { "0": t("aOff"), "30": t("a30"), "60": t("a60"), "240": t("a240") },
						},
					},
					{
						name: t("sSyncNow"),
						desc: t("sSyncNowDesc"),
						action: () => void this.plugin.sync(true),
					},
					{
						name: t("cmdRestore"),
						desc: t("sRestoreDesc"),
						action: () => void this.plugin.restoreDeletedNotes(),
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
