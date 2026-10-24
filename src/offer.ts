import { Modal } from "obsidian";
import { makeT } from "./i18n";
import { includes, normalizeOffer, type OfferCode, type PaidOffer } from "./offer-rule";
import type TradoshiPlugin from "./main";
import { appLink } from "./render";
import { renderContext } from "./sync";

// The plugin opens the features of the Tradoshi pricing page by the plan of the account,
// read at each sync: prop firm challenges with Pro, live session with Premium, discipline,
// goals and the review questions with Essential. Before an account is connected, the
// sample journal shows them, nothing is written.

export { normalizeOffer, type OfferCode, type PaidOffer };

/** Views that draw a paid feature listen here, to redraw when the plan changes. */
export const offerEvents = new Set<() => void>();

export interface OfferState {
	code: OfferCode;
	trial: boolean;
	until: string | null;
	/** When the plan was last read from Tradoshi. */
	at: string;
}

const ot = makeT({
	en: {
		essentiel: "Essential",
		pro: "Pro",
		premium: "Premium",
		locked: "This feature is part of the Tradoshi {plan} plan, as on the pricing page.",
		lockedHint: "Your journal, your notes and the free features stay as they are.",
		seePlans: "See the plans",
		changed: "Just changed your plan? Sync to update it here.",
		sync: "Sync",
		connect: "Connect my free account",
		connectFirst: "This feature needs a Tradoshi account with the {plan} plan. Start with your free account.",
	},
	fr: {
		essentiel: "Essentiel",
		pro: "Pro",
		premium: "Premium",
		locked: "Cette fonction fait partie de l'offre {plan} de Tradoshi, comme sur la page Tarifs.",
		lockedHint: "Ton journal, tes notes et les fonctions gratuites restent comme ils sont.",
		seePlans: "Voir les offres",
		changed: "Tu viens de changer d'offre ? Synchronise pour la mettre à jour ici.",
		sync: "Synchroniser",
		connect: "Connecter mon compte gratuit",
		connectFirst: "Cette fonction demande un compte Tradoshi avec l'offre {plan}. Commence par ton compte gratuit.",
	},
	es: {
		essentiel: "Esencial",
		pro: "Pro",
		premium: "Premium",
		locked: "Esta función forma parte del plan {plan} de Tradoshi, como en la página de precios.",
		lockedHint: "Tu diario, tus notas y las funciones gratuitas siguen como están.",
		seePlans: "Ver los planes",
		changed: "¿Acabas de cambiar de plan? Sincroniza para actualizarlo aquí.",
		sync: "Sincronizar",
		connect: "Conectar mi cuenta gratuita",
		connectFirst: "Esta función requiere una cuenta de Tradoshi con el plan {plan}. Empieza por tu cuenta gratuita.",
	},
	pt: {
		essentiel: "Essencial",
		pro: "Pro",
		premium: "Premium",
		locked: "Esta função faz parte do plano {plan} da Tradoshi, como na página de preços.",
		lockedHint: "Seu diário, suas notas e as funções gratuitas continuam como estão.",
		seePlans: "Ver os planos",
		changed: "Acabou de mudar de plano? Sincronize para atualizá-lo aqui.",
		sync: "Sincronizar",
		connect: "Conectar minha conta gratuita",
		connectFirst: "Esta função exige uma conta da Tradoshi com o plano {plan}. Comece pela sua conta gratuita.",
	},
});

/** The connected account has this plan or a higher one, as last read (free when never read). */
export function allows(plugin: TradoshiPlugin, need: OfferCode): boolean {
	return plugin.isConnected() && includes(plugin.settings.offer?.code, need);
}

/**
 * True when the feature can be shown: the account has the plan, or no account is
 * connected and the sample journal stands in (no trade in the vault, nothing written).
 */
export function showable(plugin: TradoshiPlugin, need: OfferCode): boolean {
	return allows(plugin, need) || (!plugin.isConnected() && plugin.tradeNoteCount() === 0);
}

export function planName(need: PaidOffer): string {
	return ot(need);
}

/** The same panel in a window, for a command that has no view of its own. */
export function openLock(plugin: TradoshiPlugin, need: PaidOffer, feature: string): void {
	const modal = new Modal(plugin.app);
	modal.setTitle(feature);
	lockPanel(modal.contentEl, plugin, need);
	modal.open();
}

/**
 * The panel shown in place of a feature the plan does not include, under the heading
 * that names the feature. Compact in a dashboard card: one line and one button.
 */
export function lockPanel(el: HTMLElement, plugin: TradoshiPlugin, need: PaidOffer, compact = false): void {
	const box = el.createDiv({ cls: compact ? "tradoshi-lock is-compact" : "tradoshi-lock" });
	const connected = plugin.isConnected();
	box.createEl("p", { cls: "tradoshi-strong", text: ot(connected ? "locked" : "connectFirst", { plan: ot(need) }) });
	if (connected && !compact) box.createEl("p", { cls: "tradoshi-muted tradoshi-small", text: ot("lockedHint") });
	const buttons = box.createDiv({ cls: "tradoshi-sample-buttons" });
	if (connected) {
		buttons.createEl("button", { cls: "mod-cta", text: ot("seePlans") }).addEventListener("click", () => window.open(appLink(renderContext(plugin.settings), `plan_${need}`, "", "abonnement=1")));
		if (compact) return;
		buttons.createEl("button", { text: ot("sync") }).addEventListener("click", () => void plugin.sync(true));
		box.createEl("p", { cls: "tradoshi-muted tradoshi-small", text: ot("changed") });
	} else {
		buttons.createEl("button", { cls: "mod-cta", text: ot("connect") }).addEventListener("click", () => plugin.connect(`plan_${need}`));
	}
}
