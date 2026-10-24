// Grouping, sorting and date ranges of the trade log. Pure: no Obsidian, so it can be tested.

export type GroupMode = "none" | "day" | "week" | "month" | "quarter" | "year";
export type RangeMode = "all" | "week" | "month" | "quarter" | "year" | "custom";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Monday of the ISO week of a day "YYYY-MM-DD", as "YYYY-MM-DD". */
export function weekStart(day: string): string {
	const d = new Date(`${day}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The group a trading day belongs to, as a sortable key: "2026-10-20", "2026-W", "2026-10", "2026-Q4", "2026". */
export function groupKey(day: string, mode: GroupMode): string {
	switch (mode) {
		case "day":
			return day;
		case "week":
			return weekStart(day);
		case "month":
			return day.slice(0, 7);
		case "quarter":
			return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
		case "year":
			return day.slice(0, 4);
		default:
			return "";
	}
}

/** First and last day of a range ending today; null bounds are open. */
export function rangeOf(mode: RangeMode, today: string, custom: { from: string; to: string } = { from: "", to: "" }): { from: string | null; to: string | null } {
	const y = today.slice(0, 4);
	const m = Number(today.slice(5, 7));
	switch (mode) {
		case "week":
			return { from: weekStart(today), to: null };
		case "month":
			return { from: `${today.slice(0, 7)}-01`, to: null };
		case "quarter":
			return { from: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: null };
		case "year":
			return { from: `${y}-01-01`, to: null };
		case "custom":
			return { from: custom.from || null, to: custom.to || null };
		default:
			return { from: null, to: null };
	}
}

export function inRange(day: string, r: { from: string | null; to: string | null }): boolean {
	return (!r.from || day >= r.from) && (!r.to || day <= r.to);
}

export interface GroupTotals {
	trades: number;
	net: number;
	wins: number;
	losses: number;
}

export function totals(rows: { pnl: number }[]): GroupTotals {
	let net = 0, wins = 0, losses = 0;
	for (const r of rows) {
		net += r.pnl;
		if (r.pnl > 0) wins++;
		else if (r.pnl < 0) losses++;
	}
	return { trades: rows.length, net, wins, losses };
}

/** Sorts by a value; missing values (null) always go last, whatever the direction. */
export function sortBy<T>(rows: T[], value: (r: T) => number | string | null, dir: "asc" | "desc"): T[] {
	const k = dir === "asc" ? 1 : -1;
	return [...rows].sort((a, b) => {
		const va = value(a);
		const vb = value(b);
		if (va === null && vb === null) return 0;
		if (va === null) return 1;
		if (vb === null) return -1;
		if (typeof va === "number" && typeof vb === "number") return (va - vb) * k;
		return String(va).localeCompare(String(vb)) * k;
	});
}

/** Indices between two rows, both included, for a Shift+click selection. */
export function rangeBetween(a: number, b: number): number[] {
	const [lo, hi] = a <= b ? [a, b] : [b, a];
	return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}
