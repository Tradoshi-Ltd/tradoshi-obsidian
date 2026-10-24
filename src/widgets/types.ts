import type { App } from "obsidian";
import type { DashData } from "../journal-data";
import type TradoshiPlugin from "../main";
import type { DashTrade } from "../stats";

// A widget is one card of the dashboard. Each lives in its own file and is listed in
// `registry.ts`; the trader turns widgets on or off and orders them (Customize).

/** Width on the 12-column grid: full 12, wide 7, narrow 5, half 6, third 4. */
export type WidgetSize = "full" | "wide" | "narrow" | "half" | "third";

export interface WidgetContext {
	app: App;
	plugin: TradoshiPlugin;
	data: DashData;
	/** Trades of the selected account and filters, all time, oldest first. */
	all: DashTrade[];
	/** The same trades within the selected period. */
	trades: DashTrade[];
	/** Currency of the money figures: the one most trades of the period are in. */
	currency: string;
	/** End of the period: the latest close of a real journal, or today for the sample. */
	now: number;
	/** Days of the selected period, 0 for all time. */
	period: number;
	/** State a widget keeps while the dashboard stays open (a month shown, a sort…), by widget id. */
	state: Record<string, unknown>;
	redraw(): void;
	tip(e: MouseEvent, lines: string[]): void;
	hideTip(): void;
	openPath(path: string | null): Promise<void>;
	openDay(day: string): Promise<void>;
}

export interface Widget {
	id: string;
	title(): string;
	size: WidgetSize;
	/** Shown on a dashboard the trader has not customized yet. */
	defaultOn: boolean;
	/** Draws into the card. The card is empty; `cardTitle` gives the usual heading. */
	render(card: HTMLElement, ctx: WidgetContext): void;
}

/** The usual card heading, with an optional figure on the right. */
export function cardTitle(card: HTMLElement, text: string, extra?: string): HTMLElement {
	const h = card.createDiv({ cls: "tradoshi-card-title" });
	h.createSpan({ text });
	if (extra) h.createSpan({ cls: "tradoshi-card-extra", text: extra });
	return h;
}

/** The usual empty state of a card. */
export function emptyCard(card: HTMLElement, text: string): void {
	card.createEl("p", { cls: "tradoshi-empty", text });
}
