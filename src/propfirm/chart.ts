import { amount, colon, dateLabel, money, noonOf } from "../format";
import { locale } from "../i18n";
import type { Challenge, PhaseEval } from "./rules";
import { tr } from "./texts";
import { dayLabel, type Tipper } from "./ui";

// Balance of one phase with the lines that matter: the max loss level as it moved, the
// profit target and the starting balance. Drawn in SVG with the theme's colours, with
// a tooltip on every point. `createSvg` takes one class or an array, never a string
// with spaces.

const W = 640;

export function balanceChart(parent: HTMLElement, tipper: Tipper, c: Challenge, pe: PhaseEval, opts: { height?: number } = {}): void {
	const points = pe.curve;
	if (!points.length) return;
	const cur = c.currency;
	const H = opts.height ?? 260;
	const pl = 70, pr = 10, pt = 14, pb = 24;
	const target = pe.rules.find((r) => r.id === "profitTarget")?.level ?? null;
	const values = [c.size, ...points.map((p) => p.balance)];
	for (const p of points) if (p.floor !== null) values.push(p.floor);
	if (target !== null) values.push(target);
	let min = Math.min(...values);
	let max = Math.max(...values);
	const padY = (max - min || c.size * 0.02 || 1) * 0.08;
	min -= padY;
	max += padY;
	const span = max - min || 1;
	// The axis carries numbers only, the currency is in the tooltip: "101.6K", or "49 850" on a narrow range.
	const axisFormat = new Intl.NumberFormat(locale(), max >= 10000 && span >= 2000 ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 0 });
	const n = points.length;
	const x = (i: number): number => pl + (n > 1 ? (i / (n - 1)) * (W - pl - pr) : (W - pl - pr) / 2);
	const y = (v: number): number => pt + (1 - (v - min) / span) * (H - pt - pb);

	const label = tr("balanceOf", { phase: pe.phase.name });
	const svg = parent.createSvg("svg", { cls: "tradoshi-pf-chart", attr: { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label } });
	for (let i = 0; i <= 4; i++) {
		const v = min + (span * i) / 4;
		svg.createSvg("line", { cls: "tradoshi-pf-grid", attr: { x1: pl, x2: W - pr, y1: y(v), y2: y(v) } });
		svg.createSvg("text", { cls: "tradoshi-pf-axis", attr: { x: pl - 6, y: y(v) + 4, "text-anchor": "end" } }).textContent = axisFormat.format(v);
	}

	const hline = (v: number, cls: string, text: string): void => {
		svg.createSvg("line", { cls, attr: { x1: pl, x2: W - pr, y1: y(v), y2: y(v) } });
		svg.createSvg("text", { cls: ["tradoshi-pf-line-label", cls], attr: { x: W - pr - 4, y: y(v) - 5, "text-anchor": "end" } }).textContent = text;
	};
	hline(c.size, "tradoshi-pf-start", tr("chartStart"));
	if (target !== null) hline(target, "tradoshi-pf-target", tr("chartTarget"));

	// The max loss level, in steps: it only moves when the trailing rule raises it.
	const floors = points.map((p, i) => ({ i, v: p.floor })).filter((p): p is { i: number; v: number } => p.v !== null);
	if (floors.length) {
		let d = `M${x(floors[0].i).toFixed(1)},${y(floors[0].v).toFixed(1)}`;
		for (let k = 1; k < floors.length; k++) d += `H${x(floors[k].i).toFixed(1)}V${y(floors[k].v).toFixed(1)}`;
		if (n === 1) d += `H${(W - pr).toFixed(1)}`;
		svg.createSvg("path", { cls: "tradoshi-pf-floor", attr: { d } });
		const last = floors[floors.length - 1].v;
		svg.createSvg("text", { cls: ["tradoshi-pf-line-label", "tradoshi-pf-floor-label"], attr: { x: W - pr - 4, y: y(last) + 14, "text-anchor": "end" } }).textContent = tr("chartFloor");
	}

	const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join("");
	svg.createSvg("path", { cls: "tradoshi-pf-balance", attr: { d: n === 1 ? `${line}H${W - pr}` : line } });

	points.forEach((p, i) => {
		if (p.payout) svg.createSvg("circle", { cls: "tradoshi-pf-payout", attr: { cx: x(i), cy: y(p.balance), r: 5 } });
	});
	if (pe.failedOn) {
		const i = points.findIndex((p) => p.day === pe.failedOn && p.floor !== null && p.balance < p.floor);
		const at = i >= 0 ? i : points.findIndex((p) => p.day === pe.failedOn && p.trade);
		if (at >= 0) svg.createSvg("circle", { cls: "tradoshi-pf-breach", attr: { cx: x(at), cy: y(points[at].balance), r: 6 } });
	}

	const first = points[0].day;
	const lastDay = points[n - 1].day;
	svg.createSvg("text", { cls: "tradoshi-pf-axis", attr: { x: pl, y: H - 6 } }).textContent = dayLabel(first);
	if (lastDay !== first) svg.createSvg("text", { cls: "tradoshi-pf-axis", attr: { x: W - pr, y: H - 6, "text-anchor": "end" } }).textContent = dayLabel(lastDay);

	const cross = svg.createSvg("line", { cls: "tradoshi-pf-cross", attr: { y1: pt, y2: H - pb } });
	const dot = svg.createSvg("circle", { cls: "tradoshi-pf-dot", attr: { r: 4.5 } });
	const hit = svg.createSvg("rect", { cls: "tradoshi-pf-hit", attr: { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb } });
	hit.addEventListener("mousemove", (e) => {
		const r = svg.getBoundingClientRect();
		const sx = ((e.clientX - r.left) / r.width) * W;
		const i = n > 1 ? Math.max(0, Math.min(n - 1, Math.round(((sx - pl) / (W - pl - pr)) * (n - 1)))) : 0;
		const p = points[i];
		cross.setAttr("x1", x(i));
		cross.setAttr("x2", x(i));
		dot.setAttr("cx", x(i));
		dot.setAttr("cy", y(p.balance));
		svg.addClass("is-hover");
		const lines = [dateLabel(noonOf(p.day), { weekday: "short", day: "numeric", month: "short" })];
		if (p.trade) lines.push(`${p.trade.symbol}${colon()}${money(p.trade.pnl, cur, 2)}`);
		else if (p.payout) lines.push(tr("tipPayout", { v: amount(p.payout.amount, cur) }));
		else lines.push(tr("tipStart"));
		lines.push(tr("tipBalance", { v: amount(p.balance, cur, 2) }));
		if (p.floor !== null) lines.push(tr("tipFloor", { f: amount(p.floor, cur), r: amount(Math.max(0, p.balance - p.floor), cur) }));
		tipper.tip(e, lines);
	});
	hit.addEventListener("mouseleave", () => {
		svg.removeClass("is-hover");
		tipper.hideTip();
	});
}
