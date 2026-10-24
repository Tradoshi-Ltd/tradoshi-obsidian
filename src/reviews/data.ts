import { language } from "../i18n";
import type TradoshiPlugin from "../main";
import { defaultQuestions } from "./defaults";
import type { Question, TemplateId } from "./questions";

// What the review module keeps in the plugin data: the trader's own question sets
// (a set never edited follows the language of Obsidian) and the sections of the
// report card turned off.

export const REVIEWS_DATA = "reviews";

export type DaySection = "figures" | "curve" | "trades" | "plan" | "review" | "sessions";
export const DAY_SECTIONS: DaySection[] = ["figures", "plan", "curve", "trades", "review", "sessions"];

export interface ReviewsData {
	templates: Partial<Record<TemplateId, Question[]>>;
	hidden: DaySection[];
}

export function reviewsData(plugin: TradoshiPlugin): ReviewsData {
	const d = plugin.moduleData<Partial<ReviewsData>>(REVIEWS_DATA, {});
	return { templates: d.templates ?? {}, hidden: Array.isArray(d.hidden) ? d.hidden : [] };
}

export async function saveReviewsData(plugin: TradoshiPlugin, data: ReviewsData): Promise<void> {
	await plugin.saveModuleData(REVIEWS_DATA, data);
}

/** The questions of a set: the trader's, or the default ones in the language of Obsidian. */
export function questionsFor(plugin: TradoshiPlugin, id: TemplateId): Question[] {
	return reviewsData(plugin).templates[id] ?? defaultQuestions(id, language());
}

export function isCustomized(plugin: TradoshiPlugin, id: TemplateId): boolean {
	return !!reviewsData(plugin).templates[id];
}

export function sectionShown(plugin: TradoshiPlugin, s: DaySection): boolean {
	return !reviewsData(plugin).hidden.includes(s);
}
