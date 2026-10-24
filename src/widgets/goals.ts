import { Modal, Setting, setIcon, type App } from "obsidian";
import { locale } from "../i18n";
import { amount, money, noonOf, sign } from "../format";
import type TradoshiPlugin from "../main";
import { dayKey, goalStatus, parseAmount, type Goal } from "../stats-advanced";
import { tr } from "./analytics-i18n";
import { allTrades, dayLong } from "./analytics-util";
import { drawGoalList } from "./goal-list-ui";
import { cardTitle, type Widget } from "./types";

// Goals: a result to reach in the month and a loss not to go beyond in a day, set in
// the widget itself and kept in the vault (module data "goals"), one pair per currency
// since the amounts mean nothing in another one.

const MODULE = "goals";
type GoalsData = Record<string, Goal>;

function goalOf(plugin: TradoshiPlugin, currency: string): Goal {
	return plugin.moduleData<GoalsData>(MODULE, {})[currency] ?? {};
}

class GoalsModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private readonly currency: string,
		private readonly onSaved: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(tr("goalsModalTitle"));
		const el = this.contentEl;
		const goal = goalOf(this.plugin, this.currency);
		let month = goal.month ? String(goal.month) : "";
		let dayLoss = goal.dayLoss ? String(goal.dayLoss) : "";
		el.createEl("p", { cls: "setting-item-description", text: tr("goalsModalHint", { c: this.currency }) });
		new Setting(el)
			.setName(tr("goalMonth"))
			.setDesc(tr("goalMonthDesc"))
			.addText((text) => {
				text.inputEl.inputMode = "decimal";
				text.setValue(month).onChange((v) => (month = v));
			});
		new Setting(el)
			.setName(tr("goalDay"))
			.setDesc(tr("goalDayDesc"))
			.addText((text) => {
				text.inputEl.inputMode = "decimal";
				text.setValue(dayLoss).onChange((v) => (dayLoss = v));
			});
		const error = el.createEl("p", { cls: "tradoshi-xgoal-error" });
		new Setting(el).addButton((b) =>
			b
				.setButtonText(tr("save"))
				.setCta()
				.onClick(() => {
					const m = parseAmount(month);
					const d = parseAmount(dayLoss);
					if (m === undefined || d === undefined) {
						error.setText(tr("invalidNumber"));
						return;
					}
					const all = { ...this.plugin.moduleData<GoalsData>(MODULE, {}) };
					if (m === null && d === null) delete all[this.currency];
					else all[this.currency] = { month: m, dayLoss: d };
					void this.plugin.saveModuleData(MODULE, all).then(() => {
						this.close();
						this.onSaved();
					});
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** A progress bar: `share` of the track filled, 0 to 1. */
function bar(parent: HTMLElement, share: number, tone: "is-gain" | "is-loss"): void {
	const track = parent.createDiv({ cls: "tradoshi-xgoal-track" });
	track.createDiv({ cls: `tradoshi-xgoal-fill ${tone}` }).setCssProps({ "--w": `${Math.max(0, Math.min(1, share)) * 100}%` });
}

export const goalsWidget: Widget = {
	id: "goals",
	title: () => tr("goalsTitle"),
	size: "half",
	defaultOn: false,
	render(card, ctx) {
		const c = ctx.currency;
		const head = cardTitle(card, tr("goalsTitle"));
		const open = (): void => new GoalsModal(ctx.app, ctx.plugin, c, () => ctx.plugin.refreshDashboards()).open();
		const gear = head.createEl("button", { cls: "clickable-icon tradoshi-xgear", attr: { "aria-label": tr("goalsSet") } });
		setIcon(gear, "settings");
		gear.addEventListener("click", open);

		const goal = goalOf(ctx.plugin, c);
		const today = dayKey(ctx.now);
		if (!goal.month && !goal.dayLoss) {
			card.createEl("p", { cls: "tradoshi-empty", text: tr("goalsEmpty", { c }) });
			card.createEl("button", { cls: "mod-cta", text: tr("goalsButton") }).addEventListener("click", open);
			drawGoalList(card, ctx, today);
			return;
		}
		const st = goalStatus(allTrades(ctx), goal, today);

		const month = card.createDiv({ cls: "tradoshi-xgoal" });
		const monthName = new Date(noonOf(today)).toLocaleDateString(locale(), { month: "long", year: "numeric" });
		month.createDiv({ cls: "tradoshi-xstat-label", text: `${tr("goalMonth")} · ${monthName}` });
		if (st.progress === null || !goal.month) {
			month.createDiv({ cls: "tradoshi-muted", text: tr("goalNoTarget") });
		} else {
			const line = month.createDiv({ cls: "tradoshi-xgoal-line" });
			line.createSpan({ cls: `tradoshi-strong ${sign(st.monthNet)}`, text: money(st.monthNet, c) });
			line.createSpan({ cls: "tradoshi-muted", text: ` / ${amount(goal.month, c)}` });
			bar(month, st.progress, "is-gain");
			month.createDiv({
				cls: "tradoshi-muted tradoshi-small",
				text: st.progress >= 1 ? tr("goalReached") : `${Math.round(Math.max(0, st.progress) * 100)} % · ${tr("goalLeft", { v: amount(st.remaining ?? 0, c) })}`,
			});
		}

		const day = card.createDiv({ cls: `tradoshi-xgoal${st.breached ? " is-alert" : ""}` });
		day.createDiv({ cls: "tradoshi-xstat-label", text: `${tr("goalToday")} · ${dayLong(today)}` });
		if (st.used === null || !goal.dayLoss) {
			day.createDiv({ cls: "tradoshi-muted", text: tr("goalNoLimit") });
		} else {
			const line = day.createDiv({ cls: "tradoshi-xgoal-line" });
			if (st.todayTrades) line.createSpan({ cls: `tradoshi-strong ${sign(st.todayNet)}`, text: money(st.todayNet, c) });
			else line.createSpan({ cls: "tradoshi-muted", text: tr("goalNoTradeToday") });
			line.createSpan({ cls: "tradoshi-muted", text: ` · ${tr("goalLimit", { v: amount(goal.dayLoss, c) })}` });
			bar(day, st.used, "is-loss");
			if (st.breached) {
				day.createDiv({ cls: "tradoshi-xgoal-alert", text: tr("goalBreached", { v: money(st.todayNet, c), limit: amount(goal.dayLoss, c) }) });
			} else if (st.todayNet < 0) {
				day.createDiv({ cls: "tradoshi-muted tradoshi-small", text: tr("goalLimitLeft", { v: amount(goal.dayLoss + st.todayNet, c) }) });
			}
			const n = st.breachedDays.length;
			if (n) card.createEl("p", { cls: "tradoshi-note", text: n === 1 ? tr("goalBreachedOne") : tr("goalBreachedDays", { n }) });
		}
		drawGoalList(card, ctx, today);
	},
};
