import { dateLabel, noonOf } from "../format";
import { locale } from "../i18n";
import type TradoshiPlugin from "../main";
import { zoned } from "../render";
import { isoWeek, type Period } from "./periods";
import { rt } from "./text";

// Small pieces shared by the report card, the period reviews and their widgets.

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Tuesday 20 October 2026", "Week 43 · 19 – 25 Oct 2026", "October 2026", "Q4 2026", "2026". */
export function periodLabel(p: Period): string {
	const y = Number(p.start.slice(0, 4));
	switch (p.kind) {
		case "day":
			return cap(dateLabel(noonOf(p.id), { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
		case "week": {
			const from = dateLabel(noonOf(p.start), { day: "numeric", month: "short" });
			const to = dateLabel(noonOf(p.end), { day: "numeric", month: "short", year: "numeric" });
			return rt("weekLabel", { n: isoWeek(p.start).week, from, to });
		}
		case "month":
			return cap(new Date(y, Number(p.start.slice(5, 7)) - 1, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" }));
		case "quarter":
			return rt("quarterLabel", { q: p.id.slice(-1), y });
		case "year":
			return String(y);
	}
}

/** "Mon 20", "W43", "Oct", "Q4", "2026": a period in a table row or a button. */
export function periodShort(p: Period): string {
	switch (p.kind) {
		case "day":
			return cap(dateLabel(noonOf(p.id), { weekday: "short", day: "numeric", month: "short" }));
		case "week":
			return rt("weekShort", { n: isoWeek(p.start).week });
		case "month":
			return cap(new Date(Number(p.start.slice(0, 4)), Number(p.start.slice(5, 7)) - 1, 1).toLocaleDateString(locale(), { month: "short", year: "numeric" }));
		case "quarter":
			return rt("quarterLabel", { q: p.id.slice(-1), y: p.id.slice(0, 4) });
		case "year":
			return p.id;
	}
}

/** "W43 · 19 Oct – 25 Oct": a week in a short list. */
export function weekRange(p: Period): string {
	const d = (day: string): string => dateLabel(noonOf(day), { day: "numeric", month: "short" });
	return `${periodShort(p)} · ${d(p.start)} – ${d(p.end)}`;
}

/** The review of a kind: "Weekly review", "Monthly review"… */
export function reviewTitle(kind: Period["kind"]): string {
	return kind === "day" ? rt("dayCard") : kind === "week" ? rt("weekReview") : kind === "month" ? rt("monthReview") : kind === "quarter" ? rt("quarterReview") : rt("yearReview");
}

/** Wall-clock time "HH:MM" of a moment in the journal time zone. */
export function timeOf(plugin: TradoshiPlugin, ms: number): string {
	try {
		return zoned(ms, plugin.settings.timeZone || "UTC").time;
	} catch {
		return new Date(ms).toTimeString().slice(0, 5);
	}
}

/** A tooltip inside a card: the card is its positioning parent. */
export function cardTip(root: HTMLElement): { tip(e: MouseEvent, lines: string[]): void; hideTip(): void } {
	const el = root.createDiv({ cls: "tradoshi-tip" });
	return {
		tip(e, lines) {
			el.empty();
			for (const l of lines) el.createDiv({ text: l });
			const box = root.getBoundingClientRect();
			el.setCssProps({ "--x": `${e.clientX - box.left + 14}px`, "--y": `${e.clientY - box.top + 14}px` });
			el.addClass("is-visible");
		},
		hideTip() {
			el.removeClass("is-visible");
		},
	};
}

/** A titled section of a card. */
export function section(parent: HTMLElement, title: string, extra?: string, cls = ""): HTMLElement {
	const sec = parent.createDiv({ cls: `tradoshi-rv-section ${cls}`.trim() });
	const head = sec.createDiv({ cls: "tradoshi-rv-section-title" });
	head.createSpan({ text: title });
	if (extra) head.createSpan({ cls: "tradoshi-card-extra", text: extra });
	return sec;
}

/** True while the trader types in a field of the card: a redraw would take the field away. */
export function typingIn(root: HTMLElement): boolean {
	const active = root.ownerDocument.activeElement;
	return !!active && root.contains(active) && active.matches("input, textarea, select");
}
