import { Modal, Setting, type App } from "obsidian";
import { makeT } from "../i18n";
import { amount, money, num } from "../format";
import { evaluateGoal, type GoalItem, type GoalMetric, type GoalPeriod } from "../goal-list";
import type TradoshiPlugin from "../main";
import { parseTyped } from "../manual/calc";
import type { WidgetContext } from "./types";

export const GOAL_LIST = "goal-list";

const gt = makeT({
	en: {
		mine: "My goals",
		add: "Add a goal",
		manage: "Goals",
		hint: "A measure over a day, a week or a month, at least or at most a target, on one account or all of them.",
		metric: "Measure",
		pnl: "Result",
		trades: "Number of trades",
		winRate: "Win rate (%)",
		avgR: "Average R",
		reviewed: "Trades reviewed (%)",
		period: "Period",
		day: "Each day",
		week: "Each week",
		month: "Each month",
		direction: "Goal",
		atLeast: "At least",
		atMost: "At most",
		target: "Target",
		account: "Account",
		allAccounts: "All accounts",
		save: "Add",
		remove: "Remove",
		none: "No goal of your own yet.",
		met: "reached",
		kept: "kept",
		broken: "went beyond",
		open: "in progress",
		invalid: "Enter a number for the target.",
		sentence: "{direction} {target} · {metric} · {period}",
	},
	fr: {
		mine: "Mes objectifs",
		add: "Ajouter un objectif",
		manage: "Objectifs",
		hint: "Une mesure sur un jour, une semaine ou un mois, au moins ou au plus une cible, sur un compte ou sur tous.",
		metric: "Mesure",
		pnl: "Résultat",
		trades: "Nombre de trades",
		winRate: "Taux de réussite (%)",
		avgR: "R moyen",
		reviewed: "Trades revus (%)",
		period: "Période",
		day: "Chaque jour",
		week: "Chaque semaine",
		month: "Chaque mois",
		direction: "Objectif",
		atLeast: "Au moins",
		atMost: "Au plus",
		target: "Cible",
		account: "Compte",
		allAccounts: "Tous les comptes",
		save: "Ajouter",
		remove: "Retirer",
		none: "Aucun objectif à toi pour l'instant.",
		met: "atteint",
		kept: "tenu",
		broken: "dépassé",
		open: "en cours",
		invalid: "Indique un nombre pour la cible.",
		sentence: "{direction} {target} · {metric} · {period}",
	},
	es: {
		mine: "Mis objetivos",
		add: "Añadir un objetivo",
		manage: "Objetivos",
		hint: "Una medida en un día, una semana o un mes, al menos o como máximo un objetivo, en una cuenta o en todas.",
		metric: "Medida",
		pnl: "Resultado",
		trades: "Número de operaciones",
		winRate: "Tasa de acierto (%)",
		avgR: "R medio",
		reviewed: "Operaciones revisadas (%)",
		period: "Periodo",
		day: "Cada día",
		week: "Cada semana",
		month: "Cada mes",
		direction: "Objetivo",
		atLeast: "Al menos",
		atMost: "Como máximo",
		target: "Meta",
		account: "Cuenta",
		allAccounts: "Todas las cuentas",
		save: "Añadir",
		remove: "Quitar",
		none: "Aún no tienes objetivos propios.",
		met: "alcanzado",
		kept: "cumplido",
		broken: "superado",
		open: "en curso",
		invalid: "Indica un número para la meta.",
		sentence: "{direction} {target} · {metric} · {period}",
	},
	pt: {
		mine: "Minhas metas",
		add: "Adicionar uma meta",
		manage: "Metas",
		hint: "Uma medida em um dia, uma semana ou um mês, no mínimo ou no máximo um alvo, em uma conta ou em todas.",
		metric: "Medida",
		pnl: "Resultado",
		trades: "Número de trades",
		winRate: "Taxa de acerto (%)",
		avgR: "R médio",
		reviewed: "Trades revisados (%)",
		period: "Período",
		day: "Cada dia",
		week: "Cada semana",
		month: "Cada mês",
		direction: "Meta",
		atLeast: "No mínimo",
		atMost: "No máximo",
		target: "Alvo",
		account: "Conta",
		allAccounts: "Todas as contas",
		save: "Adicionar",
		remove: "Remover",
		none: "Nenhuma meta sua ainda.",
		met: "atingida",
		kept: "mantida",
		broken: "ultrapassada",
		open: "em andamento",
		invalid: "Informe um número para o alvo.",
		sentence: "{direction} {target} · {metric} · {period}",
	},
});

export function goalItems(plugin: TradoshiPlugin): GoalItem[] {
	const v = plugin.moduleData<GoalItem[]>(GOAL_LIST, []);
	return Array.isArray(v) ? v : [];
}

const show = (metric: GoalMetric, v: number, currency: string): string =>
	metric === "pnl" ? amount(v, currency) : metric === "trades" ? String(Math.round(v)) : metric === "avgR" ? `${num(v)} R` : `${num(v, 0)} %`;

export function goalSentence(g: GoalItem, currency: string): string {
	return gt("sentence", { direction: gt(g.direction), target: show(g.metric, g.target, currency), metric: gt(g.metric).replace(/ \(%\)$/, ""), period: gt(g.period).toLowerCase() });
}

export class GoalListModal extends Modal {
	private draft: GoalItem = { id: "", metric: "trades", period: "day", direction: "atMost", target: 5, account: "all" };
	private targetText = "5";

	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private readonly accounts: string[],
		private readonly currency: string,
		private readonly onChange: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(gt("manage"));
		this.draw();
	}

	private async save(list: GoalItem[]): Promise<void> {
		await this.plugin.saveModuleData(GOAL_LIST, list);
		this.onChange();
		this.draw();
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		el.createEl("p", { cls: "setting-item-description", text: gt("hint") });
		const list = goalItems(this.plugin);
		if (!list.length) el.createEl("p", { cls: "tradoshi-muted", text: gt("none") });
		for (const g of list) {
			new Setting(el)
				.setName(goalSentence(g, this.currency))
				.setDesc(g.account === "all" ? gt("allAccounts") : g.account)
				.addExtraButton((b) =>
					b
						.setIcon("trash")
						.setTooltip(gt("remove"))
						.onClick(() => void this.save(list.filter((x) => x.id !== g.id))),
				);
		}
		new Setting(el).setName(gt("add")).setHeading();
		new Setting(el).setName(gt("metric")).addDropdown((d) =>
			d
				.addOptions({ pnl: gt("pnl"), trades: gt("trades"), winRate: gt("winRate"), avgR: gt("avgR"), reviewed: gt("reviewed") })
				.setValue(this.draft.metric)
				.onChange((v) => (this.draft.metric = v as GoalMetric)),
		);
		new Setting(el).setName(gt("period")).addDropdown((d) =>
			d
				.addOptions({ day: gt("day"), week: gt("week"), month: gt("month") })
				.setValue(this.draft.period)
				.onChange((v) => (this.draft.period = v as GoalPeriod)),
		);
		new Setting(el)
			.setName(gt("direction"))
			.addDropdown((d) =>
				d
					.addOptions({ atLeast: gt("atLeast"), atMost: gt("atMost") })
					.setValue(this.draft.direction)
					.onChange((v) => (this.draft.direction = v as GoalItem["direction"])),
			)
			.addText((t) => t.setPlaceholder(gt("target")).setValue(this.targetText).onChange((v) => (this.targetText = v)));
		new Setting(el).setName(gt("account")).addDropdown((d) => {
			d.addOption("all", gt("allAccounts"));
			for (const a of this.accounts) d.addOption(a, a);
			d.setValue(this.draft.account).onChange((v) => (this.draft.account = v));
		});
		const error = el.createEl("p", { cls: "tradoshi-xgoal-error" });
		new Setting(el).addButton((b) =>
			b
				.setButtonText(gt("save"))
				.setCta()
				.onClick(() => {
					const target = parseTyped(this.targetText);
					if (target === null) {
						error.setText(gt("invalid"));
						return;
					}
					void this.save([...list, { ...this.draft, target, id: `g${Date.now().toString(36)}` }]);
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** The trader's own goals, with where each stands today. */
export function drawGoalList(card: HTMLElement, ctx: WidgetContext, today: string): void {
	const list = goalItems(ctx.plugin);
	const sec = card.createDiv({ cls: "tradoshi-goal-list" });
	const head = sec.createDiv({ cls: "tradoshi-goal-list-head" });
	head.createSpan({ cls: "tradoshi-xstat-label", text: gt("mine") });
	head.createEl("button", { cls: "tradoshi-link-button", text: list.length ? gt("manage") : gt("add") }).addEventListener("click", () => {
		new GoalListModal(ctx.app, ctx.plugin, ctx.data.accounts, ctx.currency, () => ctx.plugin.refreshDashboards()).open();
	});
	for (const g of list) {
		const r = evaluateGoal(g, ctx.data.trades, today, ctx.currency);
		const row = sec.createDiv({ cls: "tradoshi-goal-row" });
		const line = row.createDiv({ cls: "tradoshi-aum-row" });
		line.createSpan({ text: goalSentence(g, ctx.currency) });
		const status = r.met === true ? (g.direction === "atMost" ? gt("kept") : gt("met")) : r.met === false ? gt("broken") : gt("open");
		line.createSpan({ cls: `tradoshi-small ${r.met === true ? "pos" : r.met === false ? "neg" : "tradoshi-muted"}`, text: `${r.value === null ? "–" : g.metric === "pnl" ? money(r.value, ctx.currency) : show(g.metric, r.value, ctx.currency)} · ${status}` });
		const track = row.createDiv({ cls: "tradoshi-xgoal-track" });
		const share = Math.max(0, Math.min(1, r.progress ?? 0));
		const tone = g.direction === "atMost" ? (r.met === false ? "is-loss" : share > 0.8 ? "is-loss" : "is-gain") : "is-gain";
		track.createDiv({ cls: `tradoshi-xgoal-fill ${tone}` }).setCssProps({ "--w": `${share * 100}%` });
		if (g.account !== "all") row.createDiv({ cls: "tradoshi-muted tradoshi-small", text: g.account });
	}
}
