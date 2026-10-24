// The plans of the Tradoshi pricing page, in order: each one includes the one before.

export type OfferCode = "gratuit" | "essentiel" | "pro" | "premium";
export type PaidOffer = Exclude<OfferCode, "gratuit">;

const RANK: Record<OfferCode, number> = { gratuit: 0, essentiel: 1, pro: 2, premium: 3 };

/** A plan code read from Tradoshi; anything unknown counts as the free plan. */
export const normalizeOffer = (code: unknown): OfferCode => (code === "essentiel" || code === "pro" || code === "premium" ? code : "gratuit");

/** The plan `code` includes what the plan `need` opens. */
export function includes(code: unknown, need: OfferCode): boolean {
	return RANK[normalizeOffer(code)] >= RANK[need];
}
