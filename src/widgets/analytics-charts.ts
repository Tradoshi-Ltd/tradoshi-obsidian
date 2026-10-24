import type { WidgetContext } from "./types";

// Charts of the analytics widgets, drawn in SVG with Obsidian's colours. They are
// sized on the card when drawn, so their text stays readable on a narrow pane as on
// a wide one. Every chart has a hover tooltip.

/** Width and height of a chart in its card, in pixels at drawing time. */
export function chartSize(card: HTMLElement, ratio: number, minH = 150, maxH = 320): { W: number; H: number } {
	const inner = card.clientWidth ? card.clientWidth - 32 : 640;
	const W = Math.round(Math.max(280, Math.min(1200, inner)));
	return { W, H: Math.round(Math.max(minH, Math.min(maxH, W * ratio))) };
}

/**
 * Round grid values covering `min` to `max`: the smallest step of 1, 2, 2.5 or 5 times
 * a power of ten that needs at most `most` values, so the axis reads 0, 500, 1 000
 * rather than 0, 433.6, 867.2. When the range holds zero, zero is one of them.
 */
export function niceTicks(min: number, max: number, most = 7): number[] {
	if (!(max > min)) max = min + 1;
	const mag = 10 ** Math.floor(Math.log10((max - min) / most));
	for (const k of [1, 2, 2.5, 5, 10, 20, 25, 50, 100]) {
		const step = k * mag;
		const lo = Math.floor(min / step + 1e-9);
		const hi = Math.ceil(max / step - 1e-9);
		if (hi - lo + 1 > most) continue;
		const out: number[] = [];
		for (let i = lo; i <= hi; i++) out.push(Number((i * step).toPrecision(12)) || 0);
		return out;
	}
	return [min, max];
}

/** Grid lines with their labels at the given values, and the zero line when it is in range. */
function grid(svg: SVGSVGElement, W: number, pl: number, pr: number, ticks: number[], y: (v: number) => number, axis: (v: number) => string): void {
	for (const v of ticks) {
		svg.createSvg("line", { cls: "tradoshi-grid", attr: { x1: pl, x2: W - pr, y1: y(v), y2: y(v) } });
		svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: pl - 8, y: y(v) + 4, "text-anchor": "end" } }).textContent = axis(v);
	}
	if (ticks[0] < 0 && ticks[ticks.length - 1] > 0) svg.createSvg("line", { cls: "tradoshi-zero", attr: { x1: pl, x2: W - pr, y1: y(0), y2: y(0) } });
}

function firstLastLabels(svg: SVGSVGElement, W: number, H: number, pl: number, pr: number, labels?: [string, string]): void {
	if (!labels) return;
	svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: pl, y: H - 6 } }).textContent = labels[0];
	svg.createSvg("text", { cls: "tradoshi-axis", attr: { x: W - pr, y: H - 6, "text-anchor": "end" } }).textContent = labels[1];
}

export interface Bar {
	value: number;
	/** Lines of the tooltip. */
	tip: string[];
	/** What a click on the bar opens. */
	open?: () => void;
}

/**
 * Vertical bars around a zero line, gains up and losses down: one per day or per trade.
 * Holds hundreds of bars; the hovered one is outlined, a click opens what it stands for.
 */
export function svgBars(card: HTMLElement, ctx: WidgetContext, bars: Bar[], opts: { label: string; axis: (v: number) => string; ratio?: number; firstLast?: [string, string] }): void {
	const { W, H } = chartSize(card, opts.ratio ?? 0.42);
	const pl = 64, pr = 8, pt = 10, pb = opts.firstLast ? 24 : 8;
	const ticks = niceTicks(Math.min(0, ...bars.map((b) => b.value)), Math.max(0, ...bars.map((b) => b.value)));
	const min = ticks[0];
	const span = ticks[ticks.length - 1] - min;
	const y = (v: number): number => pt + (1 - (v - min) / span) * (H - pt - pb);
	const svg = card.createSvg("svg", { cls: ["tradoshi-chart", "tradoshi-xbars"], attr: { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label } });
	grid(svg, W, pl, pr, ticks, y, opts.axis);
	const step = (W - pl - pr) / Math.max(bars.length, 1);
	const gap = step > 6 ? Math.min(step * 0.25, 6) : 0;
	const rects = bars.map((b, i) => {
		const top = y(Math.max(0, b.value));
		const h = Math.max(1, Math.abs(y(b.value) - y(0)));
		return svg.createSvg("rect", {
			cls: ["tradoshi-xbar", b.value >= 0 ? "is-gain" : "is-loss"],
			attr: { x: pl + i * step + gap / 2, y: top, width: Math.max(0.6, step - gap), height: h, rx: step > 8 ? 2 : 0 },
		});
	});
	firstLastLabels(svg, W, H, pl, pr, opts.firstLast);
	const hit = svg.createSvg("rect", { cls: "tradoshi-hit", attr: { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb } });
	if (bars.some((b) => b.open)) hit.addClass("is-clickable");
	let hovered = -1;
	const indexAt = (e: MouseEvent): number => {
		const r = svg.getBoundingClientRect();
		const sx = ((e.clientX - r.left) / r.width) * W;
		return Math.max(0, Math.min(bars.length - 1, Math.floor((sx - pl) / step)));
	};
	hit.addEventListener("mousemove", (e) => {
		if (!bars.length) return;
		const i = indexAt(e);
		if (i !== hovered) {
			rects[hovered]?.removeClass("is-hover");
			rects[i]?.addClass("is-hover");
			hovered = i;
		}
		ctx.tip(e, bars[i].tip);
	});
	hit.addEventListener("mouseleave", () => {
		rects[hovered]?.removeClass("is-hover");
		hovered = -1;
		ctx.hideTip();
	});
	hit.addEventListener("click", (e) => {
		if (bars.length) bars[indexAt(e)].open?.();
	});
}

export interface Series {
	name: string;
	/** Colour of the line: gain, loss, accent, or the two sides of a trade. */
	tone: "gain" | "loss" | "accent" | "long" | "short";
	/** One value per x, null for a gap. */
	values: (number | null)[];
	dashed?: boolean;
}

/**
 * Several lines over the same x values: trade numbers, or times (`time: true`, spaced
 * by the time between them). Optional fixed range and dashed reference lines.
 */
export function multiLine(
	card: HTMLElement,
	ctx: WidgetContext,
	xs: number[],
	series: Series[],
	opts: {
		label: string;
		axis: (v: number) => string;
		tip: (i: number) => string[];
		time?: boolean;
		range?: [number, number];
		refs?: { value: number; label: string }[];
		ratio?: number;
		firstLast?: [string, string];
	},
): void {
	const { W, H } = chartSize(card, opts.ratio ?? 0.42);
	const pl = 64, pr = 8, pt = 10, pb = opts.firstLast ? 24 : 8;
	const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
	const range = opts.range;
	const ticks = range ? [0, 1, 2, 3, 4].map((i) => range[0] + ((range[1] - range[0]) * i) / 4) : niceTicks(Math.min(0, ...all), Math.max(0, ...all));
	const min = ticks[0];
	const max = ticks[ticks.length - 1];
	const y = (v: number): number => pt + (1 - (v - min) / (max - min || 1)) * (H - pt - pb);
	const t0 = xs[0] ?? 0;
	const tSpan = (xs[xs.length - 1] ?? 0) - t0 || 1;
	const x = (i: number): number => pl + (opts.time ? (xs[i] - t0) / tSpan : i / Math.max(xs.length - 1, 1)) * (W - pl - pr);
	const svg = card.createSvg("svg", { cls: ["tradoshi-chart", "tradoshi-xlines"], attr: { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label } });
	grid(svg, W, pl, pr, ticks, y, opts.axis);
	for (const r of opts.refs ?? []) {
		svg.createSvg("line", { cls: "tradoshi-xref", attr: { x1: pl, x2: W - pr, y1: y(r.value), y2: y(r.value) } });
		svg.createSvg("text", { cls: ["tradoshi-axis", "tradoshi-xref-label"], attr: { x: W - pr - 4, y: y(r.value) - 5, "text-anchor": "end" } }).textContent = r.label;
	}
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
		const cls = ["tradoshi-xline", `is-${s.tone}`];
		if (s.dashed) cls.push("is-dashed");
		if (drawn > 1) svg.createSvg("path", { cls, attr: { d } });
		// A single point has no line to draw: it is shown as a dot.
		const only = s.values.findIndex((v) => v !== null);
		if (drawn === 1) svg.createSvg("circle", { cls: ["tradoshi-xpoint", `is-${s.tone}`], attr: { r: 4, cx: x(only), cy: y(s.values[only] ?? 0) } });
	}
	firstLastLabels(svg, W, H, pl, pr, opts.firstLast);
	const cross = svg.createSvg("line", { cls: "tradoshi-cross", attr: { y1: pt, y2: H - pb } });
	const dots = series.map((s) => svg.createSvg("circle", { cls: ["tradoshi-xdot", `is-${s.tone}`], attr: { r: 4 } }));
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
		ctx.tip(e, opts.tip(i));
	});
	hit.addEventListener("mouseleave", () => {
		svg.removeClass("is-hover");
		ctx.hideTip();
	});
	const legend = card.createDiv({ cls: "tradoshi-legend" });
	for (const s of series) {
		const item = legend.createSpan({ cls: "tradoshi-legend-item" });
		item.createSpan({ cls: `tradoshi-legend-swatch is-${s.tone}${s.dashed ? " is-dashed" : ""}` });
		item.createSpan({ text: s.name });
	}
}

export interface InfoTile {
	label: string;
	value: string;
	sub?: string;
	tone?: string;
	/** How the figure is computed, shown on hover. */
	info?: string[];
}

/** Figure tiles like the key figures, each one explaining itself on hover. */
export function infoTiles(parent: HTMLElement, ctx: WidgetContext, items: InfoTile[]): void {
	const grid = parent.createDiv({ cls: "tradoshi-xtiles" });
	for (const it of items) {
		const c = grid.createDiv({ cls: "tradoshi-kpi tradoshi-xtile" });
		c.createDiv({ cls: "tradoshi-kpi-label", text: it.label });
		c.createDiv({ cls: `tradoshi-kpi-value ${it.tone ?? ""}`, text: it.value });
		c.createDiv({ cls: "tradoshi-kpi-sub", text: it.sub ?? " " });
		if (it.info?.length) {
			const lines = [`${it.label} : ${it.value}`, ...it.info];
			c.addEventListener("mousemove", (e) => ctx.tip(e, lines));
			c.addEventListener("mouseleave", () => ctx.hideTip());
		}
	}
}

/** A row of small chips to pick one value (a window, a mode), kept by the caller. */
export function chips<V extends string | number>(parent: HTMLElement, options: { value: V; label: string }[], current: V, pick: (v: V) => void, label: string): void {
	const box = parent.createSpan({ cls: "tradoshi-xchips", attr: { role: "group", "aria-label": label } });
	for (const o of options) {
		const b = box.createEl("button", { cls: `tradoshi-xchip${o.value === current ? " is-active" : ""}`, text: o.label });
		b.setAttr("aria-pressed", String(o.value === current));
		b.addEventListener("click", () => pick(o.value));
	}
}
