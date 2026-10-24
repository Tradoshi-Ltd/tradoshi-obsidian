import { setIcon } from "obsidian";
import { amount, dateLabel, money, noonOf, num, sign } from "../format";
import type { Alert, ChallengeEval, DrawdownMode, Economics, Phase, RuleId, RuleResult, RuleStatus } from "./rules";
import { limitAmount } from "./rules";
import { tr } from "./texts";

// Pieces shared by the prop firm view and its widgets: rule gauges, status badges,
// alert lines and the cost against payouts. A state is always said in words, with an
// icon, never by its colour alone.

export interface Tipper {
	tip(e: MouseEvent, lines: string[]): void;
	hideTip(): void;
}

export const dayLabel = (day: string): string => dateLabel(noonOf(day), { day: "numeric", month: "short" });
export const dayLong = (day: string): string => dateLabel(noonOf(day), { weekday: "short", day: "numeric", month: "long", year: "numeric" });

const ICON: Record<RuleStatus, string> = { met: "check", ok: "check", pending: "clock", danger: "alert-triangle", blocked: "alert-triangle", violated: "x" };

export function ruleName(id: RuleId): string {
	return {
		profitTarget: tr("rTarget"),
		maxLoss: tr("rMaxLoss"),
		dailyLoss: tr("rDailyLoss"),
		minDays: tr("rMinDays"),
		maxDays: tr("rMaxDays"),
		consistency: tr("rConsistency"),
	}[id];
}

export function modeLabel(mode: DrawdownMode): string {
	return { static: tr("mStatic"), eod: tr("mEod"), intraday: tr("mIntraday") }[mode];
}

function statusText(r: RuleResult): string {
	switch (r.status) {
		case "met":
			return r.id === "profitTarget" && r.day ? tr("sMetOn", { d: dayLabel(r.day) }) : tr("sMet");
		case "pending":
			return tr("sPending");
		case "ok":
			return tr("sOk");
		case "danger":
			return tr("sDanger");
		case "blocked":
			return tr("sBlocked");
		case "violated":
			if (r.id === "maxDays") return r.day ? tr("sTimeUpOn", { d: dayLabel(r.day) }) : tr("sViolated");
			return r.day ? tr("sViolatedOn", { d: dayLabel(r.day) }) : tr("sViolated");
	}
}

/** The figure of a rule against its limit, and one line on what it means now. */
export function ruleFigures(r: RuleResult, cur: string): { main: string; sub: string } {
	switch (r.id) {
		case "profitTarget":
			return {
				main: `${money(r.value, cur)} / ${amount(r.limit, cur)}`,
				sub: r.status === "met" ? tr("targetLevel", { v: amount(r.level ?? 0, cur) }) : tr("leftToTarget", { v: amount(r.remaining, cur) }),
			};
		case "maxLoss":
			return {
				main: tr("usedOf", { v: amount(r.value, cur), l: amount(r.limit, cur) }),
				sub: tr("floorRoom", { f: amount(r.level ?? 0, cur), r: amount(r.remaining, cur) }),
			};
		case "dailyLoss":
			return {
				main: tr("usedOf", { v: amount(r.value, cur), l: amount(r.limit, cur) }),
				sub:
					r.status === "violated"
						? ""
						: r.level !== null
							? tr("dailyFloor", { f: amount(r.level, cur), r: amount(r.remaining, cur) })
							: r.hits
								? tr("dailyHits", { n: r.hits })
								: tr("worstDay"),
			};
		case "minDays":
			return { main: `${r.value} / ${r.limit}`, sub: r.remaining ? tr("daysLeft", { n: r.remaining }) : "" };
		case "maxDays":
			return { main: tr("daysOf", { v: r.value, l: r.limit }), sub: r.status === "violated" || !r.day ? "" : tr("until", { d: dayLabel(r.day) }) };
		case "consistency":
			return {
				main: r.status === "pending" ? tr("consistencyPending") : tr("bestDayShare", { v: num(r.value, 0), l: num(r.limit, 0) }),
				sub: r.needed !== null && r.remaining > 0 ? tr("consistencyNeeded", { n: amount(r.needed, cur), r: amount(r.remaining, cur) }) : "",
			};
	}
}

/** One rule: name and state on a line, then a gauge, then the figures. */
export function ruleRow(parent: HTMLElement, r: RuleResult, cur: string, opts: { mode?: DrawdownMode; compact?: boolean } = {}): void {
	const row = parent.createDiv({ cls: ["tradoshi-pf-rule", `is-${r.status}`] });
	const head = row.createDiv({ cls: "tradoshi-pf-rule-head" });
	const name = ruleName(r.id);
	head.createSpan({ cls: "tradoshi-pf-rule-name", text: r.id === "maxLoss" && opts.mode && !opts.compact ? `${name} · ${modeLabel(opts.mode)}` : name });
	statusChip(head, r.status, statusText(r));
	const target = r.id === "profitTarget" || r.id === "minDays";
	const filled = Math.round(Math.min(1, Math.max(0, r.ratio)) * 100);
	const track = row.createDiv({
		cls: ["tradoshi-pf-track", target ? "is-target" : "is-limit"],
		attr: { role: "meter", "aria-label": name, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(filled) },
	});
	track.createDiv({ cls: "tradoshi-pf-fill" }).setCssProps({ "--w": `${filled}%` });
	if (!target) track.createDiv({ cls: "tradoshi-pf-mark" });
	const f = ruleFigures(r, cur);
	const figs = row.createDiv({ cls: "tradoshi-pf-rule-figs" });
	figs.createSpan({ cls: "tradoshi-pf-main", text: f.main });
	if (f.sub && !opts.compact) figs.createSpan({ cls: "tradoshi-pf-sub", text: f.sub });
}

export function statusChip(parent: HTMLElement, status: RuleStatus, text: string): HTMLElement {
	const chip = parent.createSpan({ cls: ["tradoshi-pf-status", `is-${status}`] });
	setIcon(chip.createSpan({ cls: "tradoshi-pf-icon" }), ICON[status]);
	chip.createSpan({ text });
	return chip;
}

/** The state of a challenge in a few words: "In progress", "Target reached", "Failed"… */
export function stateOf(ev: ChallengeEval): { key: string; text: string } {
	const cur = ev.current;
	if (ev.challenge.archived) return { key: "archived", text: tr("stArchived") };
	if (cur.status === "passed" && cur.phase.outcome !== "passed") return { key: "reached", text: tr("stReached") };
	if (cur.status === "passed" && ev.challenge.current === ev.challenge.phases.length - 1) return { key: "passed", text: tr("stCompleted") };
	return {
		key: cur.status,
		text: { upcoming: tr("stUpcoming"), active: tr("stActive"), passed: tr("stPassed"), failed: tr("stFailed"), funded: tr("stFunded") }[cur.status],
	};
}

export function badge(parent: HTMLElement, ev: ChallengeEval): void {
	const s = stateOf(ev);
	parent.createSpan({ cls: ["tradoshi-pf-badge", `is-${s.key}`], text: s.text });
}

export function alertIcon(a: Alert): string {
	return { failed: "x", danger: "alert-triangle", blocked: "alert-triangle", passed: "check", payout: "check" }[a.kind];
}

export function alertText(ev: ChallengeEval, a: Alert): string {
	const cur = ev.challenge.currency;
	const next = ev.challenge.phases[ev.challenge.current + 1];
	switch (a.kind) {
		case "failed":
			return tr("aFailed", { rule: a.rule ? ruleName(a.rule) : "", d: a.day ? dayLabel(a.day) : "" });
		case "danger":
			return tr("aDanger", { rule: a.rule ? ruleName(a.rule) : "", p: num((a.ratio ?? 0) * 100, 0) });
		case "blocked":
			return tr("aBlocked", { v: amount(a.amount ?? 0, cur) });
		case "passed":
			return next ? tr("aPassed", { next: next.name }) : tr("aPassedLast");
		case "payout":
			return tr("aPayout", { v: amount(a.amount ?? 0, cur) });
	}
}

/** A line that runs the alert's action, or opens the challenge. */
export function alertRow(parent: HTMLElement, ev: ChallengeEval, a: Alert, onClick: (() => void) | null, withName: boolean): HTMLElement {
	const row = parent.createDiv({ cls: ["tradoshi-pf-alert", `is-${a.kind}`] });
	setIcon(row.createSpan({ cls: "tradoshi-pf-icon" }), alertIcon(a));
	const text = row.createSpan({ cls: "tradoshi-pf-alert-text" });
	if (withName) text.createSpan({ cls: "tradoshi-strong", text: `${ev.challenge.name} · ` });
	text.appendText(alertText(ev, a));
	if (onClick) {
		row.addClass("is-link");
		row.setAttr("tabindex", "0");
		row.setAttr("role", "button");
		row.addEventListener("click", onClick);
		row.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onClick();
			}
		});
	}
	return row;
}

/** "+48 %", "Break-even" or "–" when no cost was given. */
export function roiText(e: { cost: number; net: number; roi: number | null }): string {
	if (e.roi === null) return "–";
	if (Math.abs(e.net) < 0.5) return tr("breakEven");
	return `${e.roi > 0 ? "+" : ""}${num(e.roi, 0)} %`;
}

/** Cost, payouts, net and return of the evaluations, in one currency. */
export function economicsLine(parent: HTMLElement, e: Economics): void {
	const line = parent.createDiv({ cls: "tradoshi-pf-eco" });
	const part = (label: string, value: string, tone = ""): void => {
		const p = line.createSpan({ cls: "tradoshi-pf-eco-part" });
		p.createSpan({ cls: "tradoshi-muted", text: `${label} ` });
		p.createSpan({ cls: ["tradoshi-strong", ...(tone ? [tone] : [])], text: value });
	};
	part(tr("ecoCost"), amount(e.cost, e.currency));
	part(tr("ecoReceived"), amount(e.received, e.currency));
	part(tr("ecoNet"), money(e.net, e.currency), sign(e.net));
	part(tr("ecoRoi"), roiText(e), e.roi === null ? "" : sign(e.net));
}

/** The rules of a phase in one line: "Target 10 % · Max loss 10 % static · Daily 5 % · 4 days min". */
export function phaseSummary(p: Phase, size: number, cur: string): string {
	const r = p.rules;
	const lim = (l: { value: number; unit: "amount" | "percent" } | null): string => {
		if (!l) return "";
		return l.unit === "percent" ? `${num(l.value, l.value % 1 ? 1 : 0)} %` : amount(limitAmount(l, size) ?? 0, cur);
	};
	const parts: string[] = [];
	if (r.profitTarget) parts.push(`${tr("rTarget")} ${lim(r.profitTarget)}`);
	if (r.maxLoss) parts.push(`${tr("rMaxLoss")} ${lim(r.maxLoss)} (${modeLabel(r.maxLossMode).toLowerCase()})`);
	if (r.dailyLoss) parts.push(`${tr("rDailyLoss")} ${lim(r.dailyLoss)}`);
	if (r.minDays) parts.push(tr("minDaysShort", { n: r.minDays }));
	if (r.maxDays) parts.push(tr("maxDaysShort", { n: r.maxDays }));
	if (r.consistency) parts.push(`${tr("rConsistency")} ${num(r.consistency, 0)} %`);
	if (p.funded && p.payout?.split) parts.push(tr("splitShort", { n: num(p.payout.split, 0) }));
	return parts.length ? parts.join(" · ") : tr("noRules");
}
