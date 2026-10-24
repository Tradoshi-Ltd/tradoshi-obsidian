import { Modal, Notice, type App } from "obsidian";
import { money, sign } from "../format";
import { tradesFromVault } from "../journal-data";
import type TradoshiPlugin from "../main";
import type { PluginModule } from "../modules";
import { DAY_CARD_BLOCK } from "../render";
import { mainCurrency } from "../stats";
import { DayCard } from "./day-card";
import { tradesIn } from "./figures";
import { PeriodCard } from "./period-card";
import { isDay, periodOf, REVIEW_BLOCK, shiftPeriod, type PeriodKind } from "./periods";
import { SectionsModal, TemplatesModal } from "./templates-modal";
import { rt } from "./text";
import { periodLabel } from "./ui";
import { dayNotes, dayOfNote, ensureDayNote, fmOf, markReviewed, openFile, openPeriod, reviewNotes, todayOf } from "./vault";

// The review module: the report card of each trading day, the reviews of the weeks,
// months, quarters and years, the questions of each, and their dashboard widgets.

export async function openToday(plugin: TradoshiPlugin): Promise<void> {
	await openFile(plugin.app, await ensureDayNote(plugin, todayOf(plugin)));
}

async function openCurrent(plugin: TradoshiPlugin, kind: PeriodKind, shift = 0): Promise<void> {
	await openPeriod(plugin, shiftPeriod(periodOf(kind, todayOf(plugin)), shift));
}

/** The window to open the review of any period: kind, a day in it, or one of the latest. */
class PeriodModal extends Modal {
	private kind: PeriodKind = "week";
	private day: string;

	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
	) {
		super(app);
		this.day = todayOf(plugin);
	}

	onOpen(): void {
		this.setTitle(rt("choosePeriod"));
		this.modalEl.addClass("tradoshi-pmodal");
		this.draw();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		const kinds = el.createDiv({ cls: "tradoshi-tq-tabs" });
		const names: Record<PeriodKind, string> = { day: rt("kindDay"), week: rt("kindWeek"), month: rt("kindMonth"), quarter: rt("kindQuarter"), year: rt("kindYear") };
		for (const k of ["day", "week", "month", "quarter", "year"] as PeriodKind[]) {
			const b = kinds.createEl("button", { cls: `tradoshi-chip${k === this.kind ? " is-active" : ""}`, text: names[k] });
			b.setAttr("aria-pressed", String(k === this.kind));
			b.addEventListener("click", () => {
				this.kind = k;
				this.draw();
			});
		}
		const row = el.createDiv({ cls: "tradoshi-tq-row" });
		row.createSpan({ text: rt("aDayIn") });
		const input = row.createEl("input", { attr: { type: "date", "aria-label": rt("aDayIn") } });
		input.value = this.day;
		const p = periodOf(this.kind, this.day);
		const go = row.createEl("button", { cls: "mod-cta", text: rt("openThis", { p: periodLabel(p) }) });
		input.addEventListener("change", () => {
			if (!isDay(input.value)) return;
			this.day = input.value;
			this.draw();
		});
		go.addEventListener("click", () => {
			this.close();
			void openPeriod(this.plugin, p);
		});

		// The latest periods, with their result and whether they are reviewed.
		el.createDiv({ cls: "tradoshi-rv-sub", text: rt("latest") });
		const trades = tradesFromVault(this.app);
		const days = dayNotes(this.app);
		const reviews = reviewNotes(this.app);
		const list = el.createDiv({ cls: "tradoshi-review-list" });
		const current = periodOf(this.kind, todayOf(this.plugin));
		for (let i = 0; i < 8; i++) {
			const q = shiftPeriod(current, -i);
			const ts = tradesIn(q, trades);
			const note = q.kind === "day" ? days.get(q.id) : reviews.get(q.id);
			const done = fmOf(this.app, note ?? null)?.review_done === true;
			const b = list.createEl("button", { cls: "tradoshi-review-row" });
			b.createSpan({ text: `${done ? "✓ " : ""}${periodLabel(q)}` });
			if (ts.length) {
				const c = mainCurrency(ts);
				const net = ts.filter((x) => x.currency === c).reduce((a, x) => a + x.pnl, 0);
				b.createSpan({ cls: `tradoshi-num ${sign(net)}`, text: money(net, c) });
			} else b.createSpan({ cls: "tradoshi-muted", text: note ? "" : "–" });
			b.addEventListener("click", () => {
				this.close();
				void openPeriod(this.plugin, q);
			});
		}
	}
}

export function openTemplates(plugin: TradoshiPlugin): void {
	new TemplatesModal(plugin.app, plugin).open();
}

export const reviewsModule: PluginModule = {
	id: "reviews",
	load(plugin) {
		plugin.registerMarkdownCodeBlockProcessor(DAY_CARD_BLOCK, (_source, el, ctx) => {
			ctx.addChild(new DayCard(el, plugin, ctx.sourcePath));
		});
		plugin.registerMarkdownCodeBlockProcessor(REVIEW_BLOCK, (source, el, ctx) => {
			ctx.addChild(new PeriodCard(el, plugin, ctx.sourcePath, source));
		});

		plugin.addCommand({ id: "open-today-report-card", name: rt("cmdToday"), callback: () => void openToday(plugin) });
		plugin.addCommand({ id: "open-week-review", name: rt("cmdWeek"), callback: () => void openCurrent(plugin, "week") });
		plugin.addCommand({ id: "open-last-week-review", name: rt("cmdLastWeek"), callback: () => void openCurrent(plugin, "week", -1) });
		plugin.addCommand({ id: "open-month-review", name: rt("cmdMonth"), callback: () => void openCurrent(plugin, "month") });
		plugin.addCommand({ id: "open-quarter-review", name: rt("cmdQuarter"), callback: () => void openCurrent(plugin, "quarter") });
		plugin.addCommand({ id: "open-year-review", name: rt("cmdYear"), callback: () => void openCurrent(plugin, "year") });
		plugin.addCommand({ id: "open-period-review", name: rt("cmdPeriod"), callback: () => new PeriodModal(plugin.app, plugin).open() });
		plugin.addCommand({ id: "edit-review-questions", name: rt("cmdQuestions"), callback: () => openTemplates(plugin) });
		plugin.addCommand({
			id: "toggle-reviewed",
			name: rt("cmdToggleReviewed"),
			checkCallback: (checking) => {
				const file = plugin.app.workspace.getActiveFile();
				const fm = fmOf(plugin.app, file);
				if (!file || !fm || (!dayOfNote(fm) && typeof fm.tradoshi_review !== "string")) return false;
				if (!checking) {
					const done = fm.review_done === true;
					void markReviewed(plugin.app, file, !done).then(() => new Notice(done ? rt("nUnreviewed") : rt("nReviewed")));
				}
				return true;
			},
		});
	},
	settings: (plugin) => [
		{
			type: "group",
			heading: rt("settingsHeading"),
			items: [
				{ name: rt("sQuestions"), desc: rt("sQuestionsDesc"), action: () => openTemplates(plugin) },
				{ name: rt("sSections"), desc: rt("sSectionsDesc"), action: () => new SectionsModal(plugin.app, plugin).open() },
			],
		},
	],
	places: (plugin) => [
		{ id: "today-report-card", label: () => rt("placeToday"), icon: "clipboard-check", open: () => void openToday(plugin) },
		{ id: "week-review", label: () => rt("placeWeek"), icon: "calendar-range", open: () => void openCurrent(plugin, "week") },
		{ id: "month-review", label: () => rt("placeMonth"), icon: "calendar-days", open: () => void openCurrent(plugin, "month") },
		{ id: "period-review", label: () => rt("placePeriod"), icon: "history", open: () => new PeriodModal(plugin.app, plugin).open() },
	],
};
