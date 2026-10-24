import { makeT } from "../i18n";
import { dateLabel, money, sign } from "../format";
import { cardTitle, emptyCard, type Widget } from "../widgets/types";
import { logTrades } from "./data";
import { openTradeLog } from "./view";

const mw = makeT({
	en: {
		title: "Missed trades",
		none: "No missed trade in the period. Add one by hand, type « Missed », when you let a setup go: it shows here with what it would have made.",
		would: "{n} missed · would have made {v}",
		reasons: "Why",
		noReason: "no reason written",
		openLog: "See them in the trade log",
	},
	fr: {
		title: "Trades ratés",
		none: "Aucun trade raté sur la période. Ajoute-en un à la main, type « Raté », quand tu laisses passer un setup : il s'affiche ici avec ce qu'il aurait rapporté.",
		would: "{n} ratés · ils auraient rapporté {v}",
		reasons: "Pourquoi",
		noReason: "sans raison écrite",
		openLog: "Les voir dans le journal des trades",
	},
	es: {
		title: "Operaciones perdidas",
		none: "Ninguna operación perdida en el periodo. Añade una a mano, tipo «Perdida», cuando dejes pasar un setup: aparece aquí con lo que habría dado.",
		would: "{n} perdidas · habrían dado {v}",
		reasons: "Por qué",
		noReason: "sin motivo escrito",
		openLog: "Verlas en el registro de operaciones",
	},
	pt: {
		title: "Trades perdidos",
		none: "Nenhum trade perdido no período. Adicione um manualmente, tipo «Perdido», quando deixar passar um setup: ele aparece aqui com o que teria rendido.",
		would: "{n} perdidos · teriam rendido {v}",
		reasons: "Por quê",
		noReason: "sem motivo escrito",
		openLog: "Ver no registro de trades",
	},
});

/** Trades the trader saw and did not take, over the period, with what they would have made. */
export const missedWidget: Widget = {
	id: "missed-trades",
	title: () => mw("title"),
	size: "narrow",
	defaultOn: false,
	render(card, ctx) {
		cardTitle(card, mw("title"));
		const from = ctx.trades.length ? Math.min(...ctx.trades.map((t) => t.at)) : ctx.now - 30 * 86400000;
		const missed = logTrades(ctx.app)
			.filter((t) => t.kind === "missed" && t.at >= from && t.at <= ctx.now + 86400000)
			.sort((a, b) => b.at - a.at);
		if (!missed.length) {
			emptyCard(card, mw("none"));
			return;
		}
		const same = missed.filter((t) => t.currency === ctx.currency);
		const total = same.reduce((s, t) => s + t.pnl, 0);
		card.createDiv({ cls: `tradoshi-strong ${sign(total)}`, text: mw("would", { n: missed.length, v: money(total, ctx.currency) }) });
		const list = card.createDiv({ cls: "tradoshi-review-list" });
		for (const t of missed.slice(0, 6)) {
			const row = list.createEl("button", { cls: "tradoshi-review-row" });
			const left = row.createDiv();
			left.createDiv({ text: `${dateLabel(t.at, { day: "2-digit", month: "2-digit" })} · ${t.symbol}` });
			left.createDiv({ cls: "tradoshi-muted tradoshi-small", text: t.missedReason ?? mw("noReason") });
			row.createSpan({ cls: `tradoshi-num ${sign(t.pnl)}`, text: money(t.pnl, t.currency) });
			row.addEventListener("click", () => void ctx.openPath(t.path));
		}
		card.createEl("button", { cls: "tradoshi-link-button", text: mw("openLog") }).addEventListener("click", () => void openTradeLog(ctx.plugin));
	},
};
