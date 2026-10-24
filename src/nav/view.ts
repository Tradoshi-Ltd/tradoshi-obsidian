import { ItemView, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import { dateLabel, money, sign } from "../format";
import { emotionLabel, language, makeT, t } from "../i18n";
import type TradoshiPlugin from "../main";
import type { PluginModule } from "../modules";
import { allPlaces } from "../places";
import { ideasLink } from "../render";

export const NAV_VIEW = "tradoshi-nav";

const nt = makeT({
	en: {
		title: "Tradoshi",
		cmdOpen: "Open the navigation sidebar",
		places: "Go to",
		search: "Search trades and days: symbol, account, tag, emotion, date…",
		results: "{n} results",
		oneResult: "1 result",
		noResult: "Nothing matches.",
		recent: "Latest trades",
		day: "Day",
		missed: "missed",
		backtest: "backtest",
	},
	fr: {
		title: "Tradoshi",
		cmdOpen: "Ouvrir la barre de navigation",
		places: "Aller à",
		search: "Chercher dans les trades et les journées : instrument, compte, étiquette, émotion, date…",
		results: "{n} résultats",
		oneResult: "1 résultat",
		noResult: "Rien ne correspond.",
		recent: "Derniers trades",
		day: "Journée",
		missed: "raté",
		backtest: "backtest",
	},
	es: {
		title: "Tradoshi",
		cmdOpen: "Abrir la barra de navegación",
		places: "Ir a",
		search: "Buscar en operaciones y jornadas: instrumento, cuenta, etiqueta, emoción, fecha…",
		results: "{n} resultados",
		oneResult: "1 resultado",
		noResult: "No hay coincidencias.",
		recent: "Últimas operaciones",
		day: "Jornada",
		missed: "perdida",
		backtest: "backtest",
	},
	pt: {
		title: "Tradoshi",
		cmdOpen: "Abrir a barra de navegação",
		places: "Ir para",
		search: "Buscar em trades e dias: ativo, conta, etiqueta, emoção, data…",
		results: "{n} resultados",
		oneResult: "1 resultado",
		noResult: "Nada corresponde.",
		recent: "Últimos trades",
		day: "Dia",
		missed: "perdido",
		backtest: "backtest",
	},
});

interface Entry {
	kind: "trade" | "day";
	path: string;
	at: number;
	title: string;
	sub: string;
	pnl: number | null;
	currency: string;
	/** Everything the search looks into, in lower case. */
	hay: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Trade notes (missed and backtest included) and day notes of the vault, newest first. */
function entries(plugin: TradoshiPlugin): Entry[] {
	const out: Entry[] = [];
	for (const file of plugin.app.vault.getMarkdownFiles()) {
		const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		if (typeof fm.tradoshi_id === "string" && typeof fm.pnl === "number") {
			const tags = Array.isArray(fm.tradoshi_tags) ? fm.tradoshi_tags.map(String) : [];
			const own = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
			const day = str(fm.trading_day);
			const kind = fm.trade_type === "missed" ? ` · ${nt("missed")}` : fm.trade_type === "backtest" ? ` · ${nt("backtest")}` : "";
			const emotion = str(fm.emotion);
			out.push({
				kind: "trade",
				path: file.path,
				at: Date.parse(str(fm.closed_utc)) || Date.parse(`${day}T12:00:00`) || 0,
				title: `${str(fm.symbol)} ${str(fm.side)}`,
				sub: `${str(fm.account)}${kind}`,
				pnl: fm.pnl,
				currency: str(fm.currency) || "USD",
				hay: [fm.symbol, fm.side, fm.account, fm.broker, day, emotion, emotion ? emotionLabel(emotion) : "", fm.review_thesis, fm.review_lesson, fm.trade_type, ...tags, ...own].map(str).join(" ").toLowerCase(),
			});
		} else if (typeof fm.tradoshi_day === "string" || (fm.tradoshi_day === true && typeof fm.date === "string")) {
			const day = typeof fm.tradoshi_day === "string" ? fm.tradoshi_day : str(fm.date);
			out.push({
				kind: "day",
				path: file.path,
				at: Date.parse(`${day}T23:59:00`) || 0,
				title: `${nt("day")} ${dateLabel(Date.parse(`${day}T12:00:00`), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}`,
				sub: typeof fm.trades === "number" ? `${fm.trades} trades` : "",
				pnl: typeof fm.pnl === "number" ? fm.pnl : null,
				currency: str(fm.currency) || "USD",
				hay: `${day} ${nt("day")}`.toLowerCase(),
			});
		}
	}
	return out.sort((a, b) => b.at - a.at);
}

export class NavView extends ItemView {
	private query = "";
	private resultsEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TradoshiPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return NAV_VIEW;
	}

	getDisplayText(): string {
		return nt("title");
	}

	getIcon(): string {
		return "tradoshi";
	}

	async onOpen(): Promise<void> {
		this.draw();
		let timer: number | null = null;
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				if (timer !== null) window.clearTimeout(timer);
				timer = window.setTimeout(() => this.drawResults(), 800);
			}),
		);
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private draw(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("tradoshi-nav");
		root.createDiv({ cls: "tradoshi-nav-title", text: nt("places") });
		const list = root.createDiv({ cls: "tradoshi-nav-places" });
		for (const p of allPlaces(this.plugin).filter((x) => x.id !== "navigation")) {
			const b = list.createEl("button", { cls: "tradoshi-nav-place" });
			setIcon(b.createSpan({ cls: "tradoshi-quick-icon" }), p.icon);
			b.createSpan({ text: p.label() });
			b.addEventListener("click", () => p.open());
		}
		const input = root.createEl("input", { cls: "tradoshi-nav-search", attr: { type: "search", placeholder: nt("search"), "aria-label": nt("search") } });
		input.value = this.query;
		input.addEventListener("input", () => {
			this.query = input.value;
			this.drawResults();
		});
		this.resultsEl = root.createDiv({ cls: "tradoshi-nav-results" });
		this.drawResults();
	}

	private drawResults(): void {
		const el = this.resultsEl;
		if (!el) return;
		el.empty();
		const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
		const all = entries(this.plugin);
		const found = words.length ? all.filter((e) => words.every((w) => e.hay.includes(w))) : all.filter((e) => e.kind === "trade");
		el.createDiv({ cls: "tradoshi-nav-title", text: words.length ? found.length === 1 ? nt("oneResult") : nt("results", { n: found.length }) : nt("recent") });
		if (!found.length) {
			el.createDiv({ cls: "tradoshi-muted tradoshi-small", text: nt("noResult") });
			return;
		}
		for (const e of found.slice(0, 60)) {
			const row = el.createEl("button", { cls: "tradoshi-nav-row" });
			const left = row.createDiv();
			left.createDiv({ cls: "tradoshi-strong", text: e.title });
			left.createDiv({ cls: "tradoshi-muted tradoshi-small", text: [e.kind === "trade" ? dateLabel(e.at, { day: "numeric", month: "short" }) : "", e.sub].filter(Boolean).join(" · ") });
			if (e.pnl !== null) row.createDiv({ cls: `tradoshi-num ${sign(e.pnl)}`, text: money(e.pnl, e.currency) });
			row.addEventListener("click", () => {
				const file = this.app.vault.getFileByPath(e.path);
				if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
			});
		}
	}
}

export async function openNav(plugin: TradoshiPlugin): Promise<void> {
	const existing = plugin.app.workspace.getLeavesOfType(NAV_VIEW)[0];
	const leaf = existing ?? plugin.app.workspace.getLeftLeaf(false);
	if (!leaf) return;
	if (!existing) await leaf.setViewState({ type: NAV_VIEW, active: true });
	await plugin.app.workspace.revealLeaf(leaf);
}

export const navModule: PluginModule = {
	id: "nav",
	load(plugin) {
		plugin.registerView(NAV_VIEW, (leaf) => new NavView(leaf, plugin));
		plugin.addCommand({ id: "open-navigation", name: nt("cmdOpen"), callback: () => void openNav(plugin) });
	},
	places: (plugin) => [
		{ id: "navigation", label: () => nt("cmdOpen"), icon: "panel-left", open: () => void openNav(plugin) },
		// Suggestions go to the Ideas section of the forum, where everyone can read them.
		{ id: "ideas", label: () => t("sIdeas"), icon: "lightbulb", open: () => window.open(ideasLink(language(), "nav_ideas")) },
	],
};
