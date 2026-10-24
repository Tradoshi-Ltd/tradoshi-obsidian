import { Modal, Notice, type App } from "obsidian";
import { language } from "../i18n";
import type TradoshiPlugin from "../main";
import { DAY_SECTIONS, reviewsData, saveReviewsData, type DaySection } from "./data";
import { defaultQuestions } from "./defaults";
import {
	cloneQuestions,
	conditionValues,
	dependents,
	propertyOf,
	slugId,
	TEMPLATE_IDS,
	validateTemplate,
	type Question,
	type QuestionKind,
	type TemplateId,
	type TemplateIssueKind,
} from "./questions";
import { rt } from "./text";

// The window where the trader writes his own review questions, set by set: the plan
// before the session, the review after it, the quick review of a winning, losing or
// break-even trade, and the reviews of a week, a month, a quarter and a year.

/** The sets whose answers can come back in the next review. */
const CARRY_SETS = new Set<TemplateId>(["post", "week", "month", "quarter", "year"]);

export function templateName(id: TemplateId): string {
	const names: Record<TemplateId, string> = {
		pre: rt("tplPre"),
		post: rt("tplPost"),
		win: rt("tplWin"),
		loss: rt("tplLoss"),
		even: rt("tplEven"),
		week: rt("tplWeek"),
		month: rt("tplMonth"),
		quarter: rt("tplQuarter"),
		year: rt("tplYear"),
	};
	return names[id];
}

function issueText(kind: TemplateIssueKind): string {
	const texts: Record<TemplateIssueKind, string> = {
		"id-invalid": rt("issueIdInvalid"),
		"id-reserved": rt("issueIdReserved"),
		"id-duplicate": rt("issueIdDuplicate"),
		"text-missing": rt("issueText"),
		"options-missing": rt("issueOptions"),
		"option-duplicate": rt("issueOptionDuplicate"),
		"parent-missing": rt("issueParentMissing"),
		"parent-after": rt("issueParentAfter"),
		"parent-kind": rt("issueParentKind"),
		"parent-value": rt("issueParentValue"),
		loop: rt("issueLoop"),
	};
	return texts[kind];
}

export class TemplatesModal extends Modal {
	private draft: Record<TemplateId, Question[]>;
	/** Sets changed in this window: only those are saved as the trader's own. */
	private touched = new Set<TemplateId>();
	/** Questions added in this window: their property name still follows their text. */
	private fresh = new Set<Question>();

	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private tab: TemplateId = "post",
		private readonly onSaved: () => void = () => undefined,
	) {
		super(app);
		const saved = reviewsData(plugin).templates;
		this.draft = Object.fromEntries(TEMPLATE_IDS.map((id) => [id, cloneQuestions(saved[id] ?? defaultQuestions(id, language()))])) as Record<TemplateId, Question[]>;
	}

	onOpen(): void {
		this.modalEl.addClass("tradoshi-tmodal");
		this.setTitle(rt("templatesTitle"));
		this.draw();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private change(): void {
		this.touched.add(this.tab);
	}

	private draw(): void {
		const el = this.contentEl;
		const scroll = el.querySelector(".tradoshi-tq-list")?.scrollTop ?? 0;
		el.empty();
		el.createEl("p", { cls: "tradoshi-muted", text: rt("templatesHint") });
		const tabs = el.createDiv({ cls: "tradoshi-tq-tabs", attr: { role: "tablist" } });
		for (const id of TEMPLATE_IDS) {
			const b = tabs.createEl("button", { cls: `tradoshi-chip${id === this.tab ? " is-active" : ""}`, text: templateName(id), attr: { role: "tab", "aria-selected": String(id === this.tab), "data-tab": id } });
			b.addEventListener("click", () => {
				this.tab = id;
				this.draw();
			});
		}
		const questions = this.draft[this.tab];
		const list = el.createDiv({ cls: "tradoshi-tq-list" });
		if (!questions.length) list.createDiv({ cls: "tradoshi-muted", text: rt("noQuestions") });
		questions.forEach((q, i) => this.drawQuestion(list, questions, q, i));
		list.scrollTop = scroll;
		this.refreshIssues();

		const add = el.createDiv({ cls: "tradoshi-tq-add" });
		add.createEl("button", { text: `+ ${rt("addQuestion")}` }).addEventListener("click", () => {
			const q: Question = { id: slugId(rt("newQuestion"), questions.map((x) => x.id)), text: "", kind: "text" };
			questions.push(q);
			this.fresh.add(q);
			this.change();
			this.draw();
			const inputs = this.contentEl.querySelectorAll<HTMLInputElement>(".tradoshi-tq-text");
			inputs[inputs.length - 1]?.focus();
		});
		add.createEl("button", { text: rt("resetSet") }).addEventListener("click", () => {
			this.draft[this.tab] = defaultQuestions(this.tab, language());
			this.change();
			this.draw();
		});

		const foot = el.createDiv({ cls: "tradoshi-tq-foot" });
		foot.createEl("button", { text: rt("cancel") }).addEventListener("click", () => this.close());
		foot.createEl("button", { cls: "mod-cta", text: rt("save") }).addEventListener("click", () => void this.save());
	}

	/**
	 * The problems of each question and the warning on each tab, updated in place: a text
	 * edit never redraws the form, so the field the trader moves to keeps its focus.
	 */
	private refreshIssues(): void {
		const el = this.contentEl;
		el.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => {
			const id = b.getAttribute("data-tab") as TemplateId;
			b.setText(`${templateName(id)}${validateTemplate(this.draft[id]).length ? " ⚠" : ""}`);
		});
		const issues = validateTemplate(this.draft[this.tab]);
		el.querySelectorAll<HTMLElement>(".tradoshi-tq").forEach((card, i) => {
			const problems: TemplateIssueKind[] = issues.filter((x) => x.index === i).map((x) => x.kind);
			card.toggleClass("has-issue", problems.length > 0);
			const box = card.querySelector<HTMLElement>(".tradoshi-tq-issues");
			if (!box) return;
			box.empty();
			for (const p of problems) box.createDiv({ cls: "tradoshi-tq-issue", text: issueText(p) });
			const q = this.draft[this.tab][i];
			card.querySelector<HTMLElement>(".tradoshi-tq-prop")?.setText(q ? propertyOf(q.id) : "");
		});
	}

	private drawQuestion(list: HTMLElement, questions: Question[], q: Question, i: number): void {
		const card = list.createDiv({ cls: "tradoshi-tq" });
		const top = card.createDiv({ cls: "tradoshi-tq-row" });
		const text = top.createEl("input", { cls: "tradoshi-tq-text", attr: { type: "text", placeholder: rt("questionText"), "aria-label": rt("questionText") } });
		text.value = q.text;
		text.addEventListener("change", () => {
			q.text = text.value.trim();
			if (this.fresh.has(q) && q.text) q.id = slugId(q.text, questions.filter((x) => x !== q).map((x) => x.id));
			this.change();
			this.refreshIssues();
		});
		const kind = top.createEl("select", { cls: "dropdown", attr: { "aria-label": rt("answerKind") } });
		const kinds: [QuestionKind, string][] = [
			["text", rt("kindText")],
			["yesno", rt("kindYesNo")],
			["scale", rt("kindScale")],
			["choice", rt("kindChoice")],
		];
		for (const [v, label] of kinds) kind.createEl("option", { value: v, text: label });
		kind.value = q.kind;
		kind.addEventListener("change", () => {
			q.kind = kind.value as QuestionKind;
			if (q.kind === "choice" && !q.options?.length) q.options = [rt("optionA"), rt("optionB")];
			this.change();
			this.draw();
		});

		if (q.kind === "choice") {
			const opts = card.createEl("input", { cls: "tradoshi-tq-wide", attr: { type: "text", placeholder: rt("optionsHint"), "aria-label": rt("options") } });
			opts.value = (q.options ?? []).join(", ");
			opts.addEventListener("change", () => {
				q.options = opts.value.split(",").map((o) => o.trim()).filter(Boolean);
				this.change();
				this.refreshIssues();
			});
		}
		if (q.kind === "text") {
			const hint = card.createEl("input", { cls: "tradoshi-tq-wide", attr: { type: "text", placeholder: rt("hintPlaceholder"), "aria-label": rt("hintPlaceholder") } });
			hint.value = q.hint ?? "";
			hint.addEventListener("change", () => {
				q.hint = hint.value.trim() || undefined;
				this.change();
			});
		}

		// Asked only after a given answer to an earlier question.
		const cond = card.createDiv({ cls: "tradoshi-tq-row tradoshi-tq-cond" });
		cond.createSpan({ cls: "tradoshi-muted", text: rt("askedWhen") });
		const parents = questions.slice(0, i).filter((x) => x.kind === "yesno" || x.kind === "choice");
		const parentSel = cond.createEl("select", { cls: "dropdown", attr: { "aria-label": rt("askedWhen") } });
		parentSel.createEl("option", { value: "", text: rt("always") });
		for (const p of parents) parentSel.createEl("option", { value: p.id, text: p.text || p.id });
		if (q.showWhen && !parents.some((p) => p.id === q.showWhen?.id)) parentSel.createEl("option", { value: q.showWhen.id, text: q.showWhen.id });
		parentSel.value = q.showWhen?.id ?? "";
		parentSel.addEventListener("change", () => {
			const parent = questions.find((x) => x.id === parentSel.value);
			q.showWhen = parent ? { id: parent.id, value: conditionValues(parent)[0] ?? "" } : undefined;
			this.change();
			this.draw();
		});
		if (q.showWhen) {
			const parent = questions.find((x) => x.id === q.showWhen?.id);
			const valueSel = cond.createEl("select", { cls: "dropdown", attr: { "aria-label": rt("answerIs") } });
			for (const v of parent ? conditionValues(parent) : []) valueSel.createEl("option", { value: v, text: v === "yes" && parent?.kind === "yesno" ? rt("yes") : v === "no" && parent?.kind === "yesno" ? rt("no") : v });
			valueSel.value = q.showWhen.value;
			valueSel.addEventListener("change", () => {
				if (q.showWhen) q.showWhen.value = valueSel.value;
				this.change();
				this.draw();
			});
		}

		const foot = card.createDiv({ cls: "tradoshi-tq-row tradoshi-tq-meta" });
		if (CARRY_SETS.has(this.tab)) {
			const label = foot.createEl("label", { cls: "tradoshi-tq-carry" });
			const box = label.createEl("input", { attr: { type: "checkbox" } });
			box.checked = q.carry === true;
			label.appendText(` ${rt("carry")}`);
			box.addEventListener("change", () => {
				q.carry = box.checked || undefined;
				this.change();
			});
		}
		foot.createSpan({ cls: "tradoshi-muted tradoshi-tq-prop", text: propertyOf(q.id), attr: { "aria-label": rt("propertyHint") } });
		const move = (delta: number): void => {
			const j = i + delta;
			if (j < 0 || j >= questions.length) return;
			[questions[i], questions[j]] = [questions[j], questions[i]];
			this.change();
			this.draw();
		};
		const up = foot.createEl("button", { cls: "clickable-icon", text: "↑", attr: { "aria-label": rt("moveUp") } });
		up.disabled = i === 0;
		up.addEventListener("click", () => move(-1));
		const down = foot.createEl("button", { cls: "clickable-icon", text: "↓", attr: { "aria-label": rt("moveDown") } });
		down.disabled = i === questions.length - 1;
		down.addEventListener("click", () => move(1));
		foot.createEl("button", { cls: "clickable-icon", text: "✕", attr: { "aria-label": rt("removeQuestion") } }).addEventListener("click", () => {
			// Follow-up questions stay, asked every time: nothing the trader wrote is lost.
			for (const id of dependents(questions, q.id)) {
				const dep = questions.find((x) => x.id === id);
				if (dep?.showWhen?.id === q.id) dep.showWhen = undefined;
			}
			questions.splice(i, 1);
			this.change();
			this.draw();
		});
		card.createDiv({ cls: "tradoshi-tq-issues" });
	}

	private async save(): Promise<void> {
		const broken = TEMPLATE_IDS.find((id) => validateTemplate(this.draft[id]).length);
		if (broken) {
			this.tab = broken;
			this.draw();
			new Notice(rt("fixFirst"));
			return;
		}
		const data = reviewsData(this.plugin);
		for (const id of this.touched) data.templates[id] = cloneQuestions(this.draft[id]);
		await saveReviewsData(this.plugin, data);
		new Notice(rt("questionsSaved"));
		this.onSaved();
		this.close();
	}
}

export class SectionsModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(rt("sectionsTitle"));
		this.contentEl.createEl("p", { cls: "tradoshi-muted", text: rt("sectionsHint") });
		const names: Record<DaySection, string> = {
			figures: rt("secFigures"),
			plan: rt("plan"),
			curve: rt("intraday"),
			trades: rt("secTrades"),
			review: rt("postReview"),
			sessions: rt("sessions"),
		};
		for (const s of DAY_SECTIONS) {
			const label = this.contentEl.createEl("label", { cls: "tradoshi-tq-section" });
			const box = label.createEl("input", { attr: { type: "checkbox" } });
			box.checked = !reviewsData(this.plugin).hidden.includes(s);
			label.appendText(` ${names[s]}`);
			box.addEventListener("change", () => {
				const data = reviewsData(this.plugin);
				data.hidden = box.checked ? data.hidden.filter((x) => x !== s) : [...data.hidden, s];
				void saveReviewsData(this.plugin, data);
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
