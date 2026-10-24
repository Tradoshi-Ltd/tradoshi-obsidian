import { SCALE_MAX, visibleQuestions, type Question } from "./questions";
import { rt } from "./text";

// The questions of a review drawn as a form. Each answer is saved as soon as it is
// given (a click, or leaving a text field), in the note's `review_*` properties.

export type Answer = string | number | boolean;

/** An answer as the trader reads it: "Yes", "4 / 5", the text. */
export function answerText(q: Question, value: Answer | null | undefined): string {
	if (value === undefined || value === null || value === "") return "–";
	if (q.kind === "yesno") return value === true ? rt("yes") : value === false ? rt("no") : String(value);
	if (q.kind === "scale") return `${String(value)} / ${SCALE_MAX}`;
	return String(value);
}

/**
 * Draws the questions to ask given the answers so far. A follow-up question appears
 * once its parent gets the answer it waits for. `save` receives null to clear an answer.
 */
export function questionForm(
	parent: HTMLElement,
	questions: Question[],
	answers: Record<string, Answer>,
	save: (q: Question, value: Answer | null) => void,
	opts: { readOnly?: boolean; empty?: string } = {},
): void {
	const asked = visibleQuestions(questions, answers);
	if (!asked.length) {
		parent.createDiv({ cls: "tradoshi-muted tradoshi-small", text: opts.empty ?? rt("noQuestions") });
		return;
	}
	const form = parent.createDiv({ cls: "tradoshi-qform" });
	for (const q of asked) {
		const field = form.createDiv({ cls: `tradoshi-q${q.showWhen ? " is-follow" : ""}` });
		field.createDiv({ cls: "tradoshi-q-label", text: q.text });
		const value = answers[q.id];
		if (opts.readOnly) {
			field.createDiv({ cls: "tradoshi-q-answer", text: answerText(q, value) });
			continue;
		}
		if (q.kind === "text") {
			const area = field.createEl("textarea", { attr: { rows: 2, placeholder: q.hint ?? "", "aria-label": q.text } });
			area.value = value === undefined ? "" : String(value);
			area.addEventListener("change", () => save(q, area.value.trim() || null));
			continue;
		}
		const choices: { label: string; value: Answer }[] =
			q.kind === "yesno"
				? [
						{ label: rt("yes"), value: true },
						{ label: rt("no"), value: false },
					]
				: q.kind === "scale"
					? Array.from({ length: SCALE_MAX }, (_, i) => ({ label: String(i + 1), value: i + 1 }))
					: (q.options ?? []).filter((o) => o.trim()).map((o) => ({ label: o, value: o }));
		// An answer given before the choices changed is still shown, and can be cleared.
		if (q.kind === "choice" && typeof value === "string" && !choices.some((c) => c.value === value)) choices.push({ label: value, value });
		const group = field.createDiv({ cls: `tradoshi-q-choices${q.kind === "scale" ? " is-scale" : ""}`, attr: { role: "group", "aria-label": q.text } });
		for (const c of choices) {
			const on = value === c.value;
			const b = group.createEl("button", { cls: `tradoshi-q-choice${on ? " is-active" : ""}`, text: c.label });
			b.setAttr("aria-pressed", String(on));
			b.addEventListener("click", () => save(q, on ? null : c.value));
		}
	}
}
