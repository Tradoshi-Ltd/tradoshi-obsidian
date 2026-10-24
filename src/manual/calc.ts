// Figures of a trade entered by hand. Pure: no Obsidian, so it can be tested.

export interface ManualInput {
	side: "long" | "short";
	entry: number | null;
	exit: number | null;
	volume: number | null;
	/** Value of one point for one unit of size (contract size, tick value…). 1 by default. */
	pointValue: number;
	stopLoss: number | null;
	commission: number;
	swap: number;
	/** P&L typed by the trader, which then wins over the computed one. */
	pnlTyped: number | null;
}

export interface ManualFigures {
	/** Net P&L, costs included; null when it can neither be computed nor was typed. */
	pnl: number | null;
	/** P&L before costs, from the prices. */
	gross: number | null;
	/** Amount lost had the stop been hit, before costs. */
	risk: number | null;
	/** Net P&L over the risk. */
	r: number | null;
}

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

export function figures(i: ManualInput): ManualFigures {
	const move = i.entry !== null && i.exit !== null ? (i.side === "long" ? i.exit - i.entry : i.entry - i.exit) : null;
	const gross = move !== null && i.volume !== null ? round(move * i.volume * i.pointValue) : null;
	const pnl = i.pnlTyped !== null ? round(i.pnlTyped) : gross !== null ? round(gross + i.commission + i.swap) : null;
	const stopDistance = i.entry !== null && i.stopLoss !== null ? (i.side === "long" ? i.entry - i.stopLoss : i.stopLoss - i.entry) : null;
	const risk = stopDistance !== null && stopDistance > 0 && i.volume !== null ? round(stopDistance * i.volume * i.pointValue) : null;
	const r = pnl !== null && risk ? round(pnl / risk) : null;
	return { pnl, gross, risk, r };
}

/** Offset, in minutes, of a time zone at an instant: UTC+2 gives 120. */
function offsetMinutes(utcMs: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(utcMs));
	const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
	const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
	return Math.round((wall - utcMs) / 60000);
}

/**
 * The UTC instant of a wall time "YYYY-MM-DDTHH:mm" read in a time zone, as ISO.
 * Twice, so a wall time next to a daylight saving change lands on the right offset.
 */
export function wallToUtc(wall: string, timeZone: string): string | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
	if (!m) return null;
	const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
	let utc = asUtc - offsetMinutes(asUtc, timeZone) * 60000;
	utc = asUtc - offsetMinutes(utc, timeZone) * 60000;
	return new Date(utc).toISOString();
}

/** A number typed in any of the usual ways: "1 234,5", "1,234.5", "-0.5". */
export function parseTyped(text: string): number | null {
	const s = text.trim().replace(/[\s\u00a0\u202f']/g, "");
	if (!s) return null;
	const lastComma = s.lastIndexOf(",");
	const lastDot = s.lastIndexOf(".");
	let normal = s;
	if (lastComma > lastDot) normal = s.replace(/\./g, "").replace(",", ".");
	else if (lastDot > lastComma) normal = s.replace(/,/g, "");
	const v = Number(normal);
	return Number.isFinite(v) ? v : null;
}

/** A short identity for a trade entered by hand, unique enough within one account. */
export function manualId(now: number = Date.now()): string {
	return `m${now.toString(36)}`;
}
