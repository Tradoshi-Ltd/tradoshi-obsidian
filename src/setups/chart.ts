import { chartSize, niceTicks } from "../widgets/analytics-charts";
import type { Hue } from "./logic";

// The colour of each setup, and the chart that lays the curves of several setups over
// one another. Each setup keeps its own colour (the trader's, or one of the palette),
// which the shared charts cannot do: their colours carry gain, loss, long and short.

export interface Tipper {
	tip(e: MouseEvent, lines: string[]): void;
	hideTip(): void;
}

/** Gives an element the colour of a setup, as `--tradoshi-setup`. */
export function applyHue(el: HTMLElement | SVGElement, hue: Hue): void {
	el.addClass(`tradoshi-su-c${hue.index}`);
	if (hue.color) el.setCssProps({ "--tradoshi-setup": hue.color });
}

/** A small round mark in the colour of a setup. */
export function hueDot(parent: HTMLElement, hue: Hue): void {
	applyHue(parent.createSpan({ cls: "tradoshi-su-dot" }), hue);
}

export interface OverlaySeries {
	name: string;
	hue: Hue;
	/** One value per x, null where the setup has no trade yet (or no more). */
	values: (number | null)[];
}

/**
 * Cumulative curves of several setups on the same axes: by date (`time`, spaced by the
 * time between trades) or by trade number. Crosshair and tooltip on hover; a click on
 * the legend opens the setup.
 */
export function overlayChart(
	card: HTMLElement,
	tipper: Tipper,
	xs: number[],
	series: OverlaySeries[],
	opts: { label: string; axis: (v: number) => string; tip: (i: number) => string[]; time: boolean; firstLast?: [string, string]; ratio?: number; open?: (k: number) => void },
): void {
	const { W, H } = chartSize(card, opts.ratio ?? 0.4);
	const pl = 64, pr = 10, pt = 10, pb = opts.firstLast ? 24 : 8;
	const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
	const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
	const min = ticks[0];
	const max = ticks[ticks.length - 1];
	const y = (v: number): number => pt + (1 - (v - min) / (max - min || 1)) * (H - pt - pb);
	const t0 = xs[0] ?? 0;
	const tSpan = (xs[xs.length - 1] ?? 0) - t0 || 1;
	const x = (i: number): number => pl + (opts.time ? (xs[i] - t0) / tSpan : i / Math.max(xs.length - 1, 1)) * (W - pl - pr);
	const svg = card.createSvg("svg", { cls: ["tradoshi-chart", "tradoshi-su-overlay"], attr: { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label } });
	for (const v of ticks) {
		svg.createSvg("line", { cls: "tradoshi-grid", attr: { x1: pl, x2: W - pr, y1: y(v), y2: y(v) } });
		svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: pl - 8, y: y(v) + 4, "text-anchor": "end" } }).textContent = opts.axis(v);
	}
	if (min < 0 && max > 0) svg.createSvg("line", { cls: "tradoshi-zero", attr: { x1: pl, x2: W - pr, y1: y(0), y2: y(0) } });
	for (const s of series) {
		let d = "";
		let pen = false;
		let drawn = 0;
		s.values.forEach((v, i) => {
			if (v === null) {
				pen = false;
				return;
			}
			d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
			pen = true;
			drawn++;
		});
		if (drawn > 1) applyHue(svg.createSvg("path", { cls: "tradoshi-su-line", attr: { d } }), s.hue);
		const only = s.values.findIndex((v) => v !== null);
		if (drawn === 1) applyHue(svg.createSvg("circle", { cls: "tradoshi-su-point", attr: { r: 4, cx: x(only), cy: y(s.values[only] ?? 0) } }), s.hue);
	}
	if (opts.firstLast) {
		svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: pl, y: H - 6 } }).textContent = opts.firstLast[0];
		svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: W - pr, y: H - 6, "text-anchor": "end" } }).textContent = opts.firstLast[1];
	}
	const cross = svg.createSvg("line", { cls: "tradoshi-cross", attr: { y1: pt, y2: H - pb } });
	const dots = series.map((s) => {
		const dot = svg.createSvg("circle", { cls: "tradoshi-su-hover", attr: { r: 4 } });
		applyHue(dot, s.hue);
		return dot;
	});
	const hit = svg.createSvg("rect", { cls: "tradoshi-hit", attr: { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb } });
	hit.addEventListener("mousemove", (e) => {
		if (!xs.length) return;
		const r = svg.getBoundingClientRect();
		const sx = ((e.clientX - r.left) / r.width) * W;
		let i = 0;
		for (let k = 1; k < xs.length; k++) if (Math.abs(x(k) - sx) < Math.abs(x(i) - sx)) i = k;
		cross.setAttr("x1", x(i));
		cross.setAttr("x2", x(i));
		series.forEach((s, k) => {
			const v = s.values[i];
			dots[k].toggleClass("is-off", v === null);
			if (v !== null) {
				dots[k].setAttr("cx", x(i));
				dots[k].setAttr("cy", y(v));
			}
		});
		svg.addClass("is-hover");
		tipper.tip(e, opts.tip(i));
	});
	hit.addEventListener("mouseleave", () => {
		svg.removeClass("is-hover");
		tipper.hideTip();
	});
	const legend = card.createDiv({ cls: "tradoshi-legend" });
	series.forEach((s, k) => {
		const item = legend.createEl(opts.open ? "button" : "span", { cls: "tradoshi-legend-item tradoshi-su-legend" });
		applyHue(item.createSpan({ cls: "tradoshi-su-swatch" }), s.hue);
		item.createSpan({ text: s.name });
		if (opts.open) item.addEventListener("click", () => opts.open?.(k));
	});
}
