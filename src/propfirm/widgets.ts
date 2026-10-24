import { amount } from "../format";
import { cardTitle, emptyCard, type Widget, type WidgetContext } from "../widgets/types";
import { ChallengeModal } from "./modals";
import { economics, evaluateChallenge, topAlerts, type Challenge, type ChallengeEval, type RuleResult } from "./rules";
import { openPropFirms, shownChallenges } from "./store";
import { tr } from "./texts";
import { alertRow, badge, dayLabel, economicsLine, ruleName, ruleRow, statusChip } from "./ui";

// Prop firm widgets of the dashboard: the challenges with their alerts first, and the
// room left before the loss limits. Rules apply to every trade of an account, so they
// read the whole journal, not the period or the filters of the dashboard.

function evaluations(ctx: WidgetContext): { evals: ChallengeEval[]; sample: boolean; all: Challenge[] } {
	const shown = shownChallenges(ctx.plugin, ctx.data);
	const evals = shown.challenges.filter((c) => !c.archived).map((c) => evaluateChallenge(c, ctx.data.trades, { today: shown.today }));
	return { evals, sample: shown.sample, all: shown.challenges };
}

function heading(card: HTMLElement, ctx: WidgetContext, title: string, sample: boolean): void {
	const head = cardTitle(card, title);
	const right = head.createSpan({ cls: "tradoshi-pf-head-right" });
	if (sample) right.createSpan({ cls: "tradoshi-card-extra", text: tr("example") });
	const open = right.createEl("button", { cls: "tradoshi-link-button tradoshi-pf-open", text: tr("openView") });
	open.addEventListener("click", () => void openPropFirms(ctx.plugin));
}

function createButton(card: HTMLElement, ctx: WidgetContext): void {
	card.createEl("button", { cls: "mod-cta", text: tr("create") }).addEventListener("click", () => new ChallengeModal(ctx.app, ctx.plugin, null).open());
}

export const challengesWidget: Widget = {
	id: "prop-challenges",
	title: () => tr("wChallenges"),
	size: "half",
	defaultOn: true,
	plan: "pro",
	render(card, ctx) {
		const { evals, sample, all } = evaluations(ctx);
		heading(card, ctx, tr("wChallenges"), sample);
		if (!evals.length) {
			emptyCard(card, tr("wEmpty"));
			return createButton(card, ctx);
		}
		const alerts = topAlerts(evals);
		if (alerts.length) {
			const box = card.createDiv({ cls: "tradoshi-pf-alerts is-compact" });
			for (const { ev, alert } of alerts) alertRow(box, ev, alert, () => void openPropFirms(ctx.plugin), true);
		}
		for (const ev of evals) {
			const row = card.createDiv({ cls: "tradoshi-pf-mini" });
			const head = row.createDiv({ cls: "tradoshi-pf-mini-head" });
			const name = head.createDiv({ cls: "tradoshi-pf-mini-name" });
			name.createSpan({ cls: "tradoshi-strong", text: ev.challenge.name });
			name.createSpan({ cls: "tradoshi-muted", text: ` · ${ev.current.phase.name}` });
			badge(head, ev);
			const rules = ev.current.rules.filter((r) => r.id === "profitTarget" || r.id === "maxLoss" || r.id === "dailyLoss");
			for (const r of rules) ruleRow(row, r, ev.challenge.currency, { compact: true });
			if (!rules.length) row.createDiv({ cls: "tradoshi-empty", text: tr("noRulesHint") });
		}
		for (const e of economics(all).filter((x) => x.cost > 0 || x.received > 0)) economicsLine(card, e);
	},
};

/** The room left before a limit, in large, with its gauge. */
function marginRow(parent: HTMLElement, label: string, r: RuleResult, cur: string, sub: string): void {
	const row = parent.createDiv({ cls: ["tradoshi-pf-margin", `is-${r.status}`] });
	const head = row.createDiv({ cls: "tradoshi-pf-rule-head" });
	head.createSpan({ cls: "tradoshi-pf-rule-name", text: label });
	statusChip(head, r.status, r.status === "violated" ? tr("sViolated") : r.status === "danger" ? tr("sDanger") : tr("sOk"));
	row.createDiv({ cls: "tradoshi-pf-margin-value", text: r.status === "violated" ? "–" : tr("roomLeft", { v: amount(r.remaining, cur) }) });
	const used = Math.round(Math.min(1, Math.max(0, r.ratio)) * 100);
	const track = row.createDiv({
		cls: "tradoshi-pf-track is-limit",
		attr: { role: "meter", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(used) },
	});
	track.createDiv({ cls: "tradoshi-pf-fill" }).setCssProps({ "--w": `${used}%` });
	track.createDiv({ cls: "tradoshi-pf-mark" });
	row.createDiv({ cls: "tradoshi-pf-sub", text: sub });
}

export const drawdownWidget: Widget = {
	id: "prop-drawdown",
	title: () => tr("wDrawdown"),
	size: "half",
	defaultOn: false,
	plan: "pro",
	render(card, ctx) {
		const { evals, sample, all } = evaluations(ctx);
		heading(card, ctx, tr("wDrawdown"), sample);
		const live = evals.filter((ev) => (ev.current.status === "active" || ev.current.status === "funded" || ev.current.status === "passed") && !ev.current.phase.outcome);
		if (!live.length) {
			emptyCard(card, all.length ? tr("wNoActive") : tr("wDrawdownEmpty"));
			return createButton(card, ctx);
		}
		for (const ev of live) {
			const cur = ev.challenge.currency;
			const box = card.createDiv({ cls: "tradoshi-pf-dd" });
			const head = box.createDiv({ cls: "tradoshi-pf-mini-head" });
			const name = head.createDiv({ cls: "tradoshi-pf-mini-name" });
			name.createSpan({ cls: "tradoshi-strong", text: ev.challenge.name });
			name.createSpan({ cls: "tradoshi-muted", text: ` · ${ev.current.phase.name}` });
			head.createSpan({ cls: "tradoshi-muted", text: tr("balanceIs", { v: amount(ev.current.balance, cur) }) });
			const max = ev.current.rules.find((r) => r.id === "maxLoss");
			const daily = ev.current.rules.find((r) => r.id === "dailyLoss");
			if (!max && !daily) {
				box.createDiv({ cls: "tradoshi-empty", text: tr("noLimits") });
				continue;
			}
			const grid = box.createDiv({ cls: "tradoshi-pf-dd-grid" });
			if (max) marginRow(grid, ruleName("maxLoss"), max, cur, max.status === "violated" && max.day ? tr("violatedOnLong", { d: dayLabel(max.day) }) : tr("ddMaxSub", { f: amount(max.level ?? 0, cur) }));
			if (daily) {
				const sub = daily.status === "violated" ? tr("ddTodayHit") : daily.level !== null ? tr("ddTodaySub", { f: amount(daily.level, cur) }) : "";
				marginRow(grid, tr("ddToday"), daily, cur, sub);
			}
		}
	},
};

export const PROPFIRM_WIDGETS: Widget[] = [challengesWidget, drawdownWidget];
