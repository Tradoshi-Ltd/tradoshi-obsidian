import { dateLabel, duration, noonOf } from "../format";
import { locale } from "../i18n";
import type { DashTrade } from "../stats";
import { tr } from "./analytics-i18n";
import type { WidgetContext } from "./types";

// Small helpers shared by the analytics widgets.

/** Trades of the period in the dashboard currency, oldest first. */
export function periodTrades(ctx: WidgetContext): DashTrade[] {
	return ctx.trades.filter((t) => t.currency === ctx.currency).sort((a, b) => a.at - b.at);
}

/** All the trades in the dashboard currency, oldest first. */
export function allTrades(ctx: WidgetContext): DashTrade[] {
	return ctx.all.filter((t) => t.currency === ctx.currency).sort((a, b) => a.at - b.at);
}

/** The year joins a date only when it is not the current one. */
function withYear(ms: number, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
	return new Date(ms).getFullYear() === new Date().getFullYear() ? o : { ...o, year: "numeric" };
}

/** "12 Oct" (or "12 Oct 2025") from a day key. */
export function dayShort(day: string): string {
	return dateShort(noonOf(day));
}

/** "Mon 12 Oct" from a day key. */
export function dayLong(day: string): string {
	const ms = noonOf(day);
	return dateLabel(ms, withYear(ms, { weekday: "short", day: "numeric", month: "short" }));
}

/** "12 Oct" (or "12 Oct 2025") from a moment. */
export function dateShort(ms: number): string {
	return dateLabel(ms, withYear(ms, { day: "numeric", month: "short" }));
}

/** A time span: "45 min", "5 h 10" under two days, then whole days. */
export function span(ms: number): string {
	return ms < 2 * 86400000 ? duration(ms) : tr("daysN", { n: Math.round(ms / 86400000) });
}

/** "Mon 12 Oct, 14:05" from a moment. */
export function dateTime(ms: number): string {
	return `${dateLabel(ms, withYear(ms, { weekday: "short", day: "numeric", month: "short" }))}, ${new Date(ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}`;
}
