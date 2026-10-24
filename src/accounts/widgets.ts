import { amount, money, num, sign } from "../format";
import { cardTitle, emptyCard, type Widget } from "../widgets/types";
import { openAccounts } from "./index";
import { accountSettings } from "./settings";
import { accountFigures } from "./stats";
import { at } from "./text";
import { sparkline } from "./view";

/** Total of the balances of the accounts whose starting balance is set. */
export const aumWidget: Widget = {
	id: "aum",
	title: () => at("aum"),
	size: "narrow",
	defaultOn: false,
	render(card, ctx) {
		const rows = ctx.data.accounts
			.map((name) => ({ name, s: accountSettings(ctx.plugin, name, ctx.data.sample) }))
			.filter((r) => r.s.initial !== null && !r.s.hidden && r.s.type !== "demo" && r.s.type !== "backtest")
			.map((r) => ({ ...r, f: accountFigures(r.name, ctx.data.trades, r.s) }))
			.filter((r) => r.f.currency === ctx.currency);
		cardTitle(card, at("aum"), ctx.currency);
		if (!rows.length) {
			emptyCard(card, at("noInitial"));
			card.createEl("button", { text: at("openAccounts") }).addEventListener("click", () => void openAccounts(ctx.plugin));
			return;
		}
		const total = rows.reduce((s, r) => s + (r.f.balance ?? 0), 0);
		const start = rows.reduce((s, r) => s + (r.s.initial ?? 0), 0);
		const big = card.createDiv({ cls: "tradoshi-aum-total" });
		big.createSpan({ text: amount(total, ctx.currency) });
		big.createSpan({ cls: `tradoshi-aum-change ${sign(total - start)}`, text: ` ${money(total - start, ctx.currency)}${start ? ` (${num(((total - start) / start) * 100, 1)} %)` : ""}` });
		for (const r of rows) {
			const line = card.createDiv({ cls: "tradoshi-aum-row" });
			line.createSpan({ text: r.name });
			line.createSpan({ cls: "tradoshi-num", text: amount(r.f.balance ?? 0, ctx.currency) });
		}
		card.createEl("button", { cls: "tradoshi-link-button", text: at("openAccounts") }).addEventListener("click", () => void openAccounts(ctx.plugin));
	},
};

/** Progress of the accounts that have a profit target. */
export const targetsWidget: Widget = {
	id: "profit-targets",
	title: () => at("profitTargets"),
	size: "narrow",
	defaultOn: false,
	render(card, ctx) {
		cardTitle(card, at("profitTargets"));
		const rows = ctx.data.accounts
			.map((name) => ({ name, s: accountSettings(ctx.plugin, name, ctx.data.sample) }))
			.filter((r) => r.s.target !== null && !r.s.hidden)
			.map((r) => ({ ...r, f: accountFigures(r.name, ctx.data.trades, r.s) }))
			.sort((a, b) => b.f.net / (b.s.target ?? 1) - a.f.net / (a.s.target ?? 1));
		if (!rows.length) {
			emptyCard(card, at("noTargets"));
			return;
		}
		for (const r of rows) {
			const target = r.s.target ?? 0;
			const pct = target > 0 ? Math.max(0, Math.min(100, (r.f.net / target) * 100)) : 0;
			const row = card.createDiv({ cls: "tradoshi-target" });
			const head = row.createDiv({ cls: "tradoshi-aum-row" });
			head.createSpan({ text: r.name });
			head.createSpan({ cls: "tradoshi-num", text: `${num(pct, 0)} %` });
			row.createDiv({ cls: "tradoshi-target-track" }).createDiv({ cls: `tradoshi-target-fill${r.f.net >= target ? " is-done" : ""}` }).setCssProps({ "--w": `${pct}%` });
			row.createDiv({ cls: "tradoshi-small tradoshi-muted", text: r.f.net >= target ? at("targetReached") : at("targetLeft", { v: amount(target - r.f.net, r.f.currency) }) });
			sparkline(row, r.f.curve.map((p) => p.value), r.name);
		}
	},
};
