import { language, locale } from "./i18n";

// Number and date formatting shared by every view, in the trader's language. Pure.

/** CSS class for a signed figure: gain, loss or nothing. */
export const sign = (v: number): string => (v > 0 ? "pos" : v < 0 ? "neg" : "");

export function money(v: number, currency: string, digits = 0): string {
	try {
		return new Intl.NumberFormat(locale(), { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: digits, minimumFractionDigits: digits, signDisplay: "exceptZero" }).format(v);
	} catch {
		return `${v > 0 ? "+" : ""}${v.toFixed(digits)} ${currency}`;
	}
}

/** A money amount without sign, for limits and targets: "5 000 $". */
export function amount(v: number, currency: string, digits = 0): string {
	try {
		return new Intl.NumberFormat(locale(), { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
	} catch {
		return `${v.toFixed(digits)} ${currency}`;
	}
}

export function compact(v: number, currency: string): string {
	try {
		return new Intl.NumberFormat(locale(), { style: "currency", currency, currencyDisplay: "narrowSymbol", notation: "compact", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(v);
	} catch {
		return money(v, currency);
	}
}

/** A short amount without sign, for a balance: "230,8 k €". */
export function compactAmount(v: number, currency: string): string {
	try {
		return new Intl.NumberFormat(locale(), { style: "currency", currency, currencyDisplay: "narrowSymbol", notation: "compact", maximumFractionDigits: 1 }).format(v);
	} catch {
		return amount(v, currency);
	}
}

/** A short signed amount without currency, for calendar cells: "+1,5 k". */
export function compactNumber(v: number): string {
	return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: Math.abs(v) >= 1000 ? 1 : 0, signDisplay: "exceptZero" }).format(v);
}

export function num(v: number, digits = 2): string {
	return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

const NBSP = String.fromCharCode(160);

/** The percent sign as each language writes it: "48.4%" in English and Portuguese, "48,4 %" in French and Spanish. */
export function pctSign(): string {
	const l = language();
	return l === "fr" || l === "es" ? `${NBSP}%` : "%";
}

/** A colon followed by a space, as each language writes it: "Win rate: ", "Taux de réussite : ". */
export function colon(): string {
	return language() === "fr" ? `${NBSP}: ` : ": ";
}

export function percent(v: number, digits = 1): string {
	return `${num(v, digits)}${pctSign()}`;
}

export function dateLabel(ms: number, opts: Intl.DateTimeFormatOptions): string {
	return new Date(ms).toLocaleDateString(locale(), opts);
}

/** "2 h 05", "45 min", "3 d 4 h": a holding time. */
export function duration(ms: number): string {
	const min = Math.round(ms / 60000);
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	if (h < 48) return `${h} h ${String(min % 60).padStart(2, "0")}`;
	return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** The local day of a day key "YYYY-MM-DD", at noon, so time zones never move it. */
export const noonOf = (day: string): number => new Date(`${day}T12:00:00`).getTime();
