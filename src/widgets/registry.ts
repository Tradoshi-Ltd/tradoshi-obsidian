import { aumWidget, targetsWidget } from "../accounts/widgets";
import { ANALYTICS_WIDGETS } from "./analytics";
import { PROPFIRM_WIDGETS } from "../propfirm/widgets";
import { missedWidget } from "../tradelog/missed-widget";
import { CORE_WIDGETS } from "./core";
import { pinnedNoteWidget, positionSizeWidget, quickLinksWidget, unreviewedWidget } from "./tools";
import type { Widget } from "./types";

// Every widget the dashboard can show, in the default order. A new widget is added to
// this list, in its own file; the trader's own order and choices live in the settings
// (`layout`), and a widget missing from them is added at its default place.
export const WIDGETS: Widget[] = [
	quickLinksWidget,
	...CORE_WIDGETS,
	unreviewedWidget,
	...PROPFIRM_WIDGETS,
	...ANALYTICS_WIDGETS,
	aumWidget,
	targetsWidget,
	positionSizeWidget,
	missedWidget,
	pinnedNoteWidget,
];

export interface LayoutItem {
	id: string;
	on: boolean;
}

/** The trader's layout, completed with the widgets added since, and cleaned of removed ones. */
export function resolveLayout(saved: LayoutItem[]): { widget: Widget; on: boolean }[] {
	const byId = new Map(WIDGETS.map((w) => [w.id, w]));
	const out: { widget: Widget; on: boolean }[] = [];
	const seen = new Set<string>();
	for (const item of saved) {
		const widget = byId.get(item.id);
		if (!widget || seen.has(item.id)) continue;
		seen.add(item.id);
		out.push({ widget, on: item.on });
	}
	// New widgets go right after the widget that precedes them in the default order.
	WIDGETS.forEach((widget, i) => {
		if (seen.has(widget.id)) return;
		seen.add(widget.id);
		const before = WIDGETS.slice(0, i).reverse().find((w) => out.some((o) => o.widget.id === w.id));
		const at = before ? out.findIndex((o) => o.widget.id === before.id) + 1 : 0;
		out.splice(at, 0, { widget, on: widget.defaultOn });
	});
	return out;
}
