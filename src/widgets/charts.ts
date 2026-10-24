import { tradesLabel } from "../i18n";
import { compact, money, sign } from "../format";
import type { Group } from "../stats";
import type { WidgetContext } from "./types";

// Charts shared by the widgets, drawn in SVG with Obsidian's colours. Every chart
// has a hover tooltip; text uses the theme's text colours, never the series colour.

export interface LinePoint {
	at: number;
	value: number;
	/** Lines of the tooltip for this point. */
	tip: string[];
}

/**
 * A line over time with a shaded area down to zero, a zero line, four grid lines and
 * a crosshair. `area: "below"` shades under the line (drawdown).
 */
export function lineChart(
	card: HTMLElement,
	ctx: WidgetContext,
	points: LinePoint[],
	opts: { label: string; currency: string; height?: number; tone?: "accent" | "loss"; formatAxis?: (v: number) => string; firstLast?: (ms: number) => string },
): void {
	const W = 800, H = opts.height ?? 450, pl = 70, pr = 12, pt = 12, pb = 26;
	const values = [0, ...points.map((p) => p.value)];
	const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
	const x = (i: number): number => pl + (i / Math.max(points.length - 1, 1)) * (W - pl - pr);
	const y = (v: number): number => pt + (1 - (v - min) / span) * (H - pt - pb);
	const axis = opts.formatAxis ?? ((v: number) => compact(v, opts.currency));
	const svg = card.createSvg("svg", { cls: `tradoshi-chart${opts.tone === "loss" ? " is-loss" : ""}`, attr: { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label } });
	for (let i = 0; i <= 4; i++) {
		const v = min + (span * i) / 4;
		svg.createSvg("line", { cls: "tradoshi-grid", attr: { x1: pl, x2: W - pr, y1: y(v), y2: y(v) } });
		svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: pl - 8, y: y(v) + 4, "text-anchor": "end" } }).textContent = axis(v);
	}
	svg.createSvg("line", { cls: "tradoshi-zero", attr: { x1: pl, x2: W - pr, y1: y(0), y2: y(0) } });
	if (!points.length) return;
	const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
	svg.createSvg("path", { cls: "tradoshi-area", attr: { d: `${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z` } });
	svg.createSvg("path", { cls: "tradoshi-line", attr: { d: line } });
	if (opts.firstLast) {
		svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: pl, y: H - 6 } }).textContent = opts.firstLast(points[0].at);
		svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: W - pr, y: H - 6, "text-anchor": "end" } }).textContent = opts.firstLast(points[points.length - 1].at);
	}
	const cross = svg.createSvg("line", { cls: "tradoshi-cross", attr: { y1: pt, y2: H - pb } });
	const dot = svg.createSvg("circle", { cls: "tradoshi-dot", attr: { r: 5 } });
	const hit = svg.createSvg("rect", { cls: "tradoshi-hit", attr: { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb } });
	hit.addEventListener("mousemove", (e) => {
		const r = svg.getBoundingClientRect();
		const sx = ((e.clientX - r.left) / r.width) * W;
		const i = Math.max(0, Math.min(points.length - 1, Math.round(((sx - pl) / (W - pl - pr)) * (points.length - 1))));
		cross.setAttr("x1", x(i));
		cross.setAttr("x2", x(i));
		dot.setAttr("cx", x(i));
		dot.setAttr("cy", y(points[i].value));
		svg.addClass("is-hover");
		ctx.tip(e, points[i].tip);
	});
	hit.addEventListener("mouseleave", () => {
		svg.removeClass("is-hover");
		ctx.hideTip();
	});
}

export interface Column {
	label: string;
	value: number;
	/** Lines of the tooltip. */
	tip: string[];
	/** A column with nothing behind it is drawn empty, not as a zero bar. */
	empty?: boolean;
}

/** Vertical columns around a zero line, gains up and losses down (weekdays, hours, days). */
export function columns(card: HTMLElement, ctx: WidgetContext, cols: Column[], opts: { label: string; dense?: boolean }): void {
	const max = Math.max(...cols.map((c) => Math.abs(c.value)), 1);
	const chart = card.createDiv({ cls: `tradoshi-columns${opts.dense ? " is-dense" : ""}`, attr: { role: "img", "aria-label": opts.label } });
	chart.setCssProps({ "--n": String(cols.length) });
	for (const c of cols) {
		const col = chart.createDiv({ cls: "tradoshi-weekday" });
		const up = col.createDiv({ cls: "tradoshi-weekday-half is-up" });
		const down = col.createDiv({ cls: "tradoshi-weekday-half is-down" });
		if (!c.empty) {
			const bar = (c.value >= 0 ? up : down).createDiv({ cls: `tradoshi-weekday-bar ${c.value >= 0 ? "is-gain" : "is-loss"}` });
			bar.setCssProps({ "--h": `${Math.max(3, (Math.abs(c.value) / max) * 100)}%` });
		}
		col.createDiv({ cls: "tradoshi-weekday-label", text: c.label });
		col.addEventListener("mousemove", (e) => ctx.tip(e, c.tip));
		col.addEventListener("mouseleave", () => ctx.hideTip());
	}
}

/** Horizontal bars of results by group (setups, emotions, symbols, tags). */
export function groupBars(card: HTMLElement, groups: Group[], currency: string, perTrade: string): void {
	const max = Math.max(...groups.map((g) => Math.abs(g.net)), 1);
	for (const g of groups) {
		const row = card.createDiv({ cls: "tradoshi-bar-row" });
		const label = row.createDiv({ cls: "tradoshi-bar-label" });
		label.createDiv({ text: g.label });
		label.createDiv({
			cls: "tradoshi-bar-sub",
			text: `${tradesLabel(g.trades)}${g.winRate === null ? "" : ` · ${Math.round(g.winRate)} %`} · ${money(g.expectancy, currency)}/${perTrade}`,
		});
		const track = row.createDiv({ cls: "tradoshi-bar-track" });
		const bar = track.createDiv({ cls: `tradoshi-bar ${g.net >= 0 ? "is-gain" : "is-loss"}` });
		bar.setCssProps({ "--w": `${Math.max(2, (Math.abs(g.net) / max) * 50)}%` });
		row.createDiv({ cls: `tradoshi-bar-value ${sign(g.net)}`, text: money(g.net, currency) });
	}
}

/** A grid of figure tiles: label, value, small line under it. */
export function tiles(parent: HTMLElement, items: { label: string; value: string; sub?: string; tone?: string }[], cls = "tradoshi-kpis"): void {
	const grid = parent.createDiv({ cls });
	for (const it of items) {
		const c = grid.createDiv({ cls: "tradoshi-kpi" });
		c.createDiv({ cls: "tradoshi-kpi-label", text: it.label });
		c.createDiv({ cls: `tradoshi-kpi-value ${it.tone ?? ""}`, text: it.value });
		c.createDiv({ cls: "tradoshi-kpi-sub", text: it.sub ?? " " });
	}
}
