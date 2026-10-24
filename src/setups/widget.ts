import { money, num, sign } from "../format";
import { t, tradesLabel } from "../i18n";
import { chips } from "../widgets/analytics-charts";
import { cardTitle, emptyCard, type Widget } from "../widgets/types";
import { applyHue, hueDot } from "./chart";
import { EDGE_MIN_TRADES, huesByKey, rankRows, setupRows, sortValue, type SetupSort } from "./logic";
import { setupMetas } from "./sheets";
import { st } from "./text";
import { openSetups } from "./view";

// Dashboard widget: the setups of the period from the best to the worst, by expectancy
// or by result. Setups with too few trades to judge come after the others, marked.

const SHOWN = 10;

export const setupRankingWidget: Widget = {
	id: "setup-ranking",
	title: () => st("rankTitle"),
	size: "third",
	defaultOn: true,
	render(card, ctx) {
		const by: SetupSort = ctx.state["setup-ranking"] === "net" ? "net" : "expectancy";
		const head = cardTitle(card, st("rankTitle"));
		chips(
			head,
			[
				{ value: "expectancy", label: t("expectancy") },
				{ value: "net", label: t("net") },
			],
			by,
			(v) => {
				ctx.state["setup-ranking"] = v;
				ctx.redraw();
			},
			st("rankSort"),
		);
		const trades = ctx.trades.filter((x) => x.currency === ctx.currency);
		const metas = setupMetas(ctx.app, ctx.data.sample);
		const rows = rankRows(setupRows(trades, ctx.data.categories, metas), by, EDGE_MIN_TRADES);
		if (!rows.length) return emptyCard(card, st("noSetupPeriod"));
		// Colours are given on every setup known, so a setup keeps its colour whatever the period.
		const hues = huesByKey(
			setupRows(
				ctx.data.trades.filter((x) => x.currency === ctx.currency),
				ctx.data.categories,
				metas,
			),
		);
		const max = Math.max(...rows.map((r) => Math.abs(sortValue(r, by) ?? 0)), 1e-9);
		const list = card.createDiv({ cls: "tradoshi-su-rank" });
		rows.slice(0, SHOWN).forEach((r, i) => {
			const s = r.stats;
			const value = sortValue(r, by) ?? 0;
			const few = s.trades < EDGE_MIN_TRADES;
			const hue = hues.get(r.key) ?? { color: null, index: 0 };
			const row = list.createDiv({ cls: `tradoshi-su-rank-row${few ? " is-few" : ""}`, attr: { role: "button", tabindex: "0", "aria-label": `${st("openDetail")} ${r.name}` } });
			applyHue(row, hue);
			row.createSpan({ cls: "tradoshi-su-rank-n", text: String(i + 1) });
			const name = row.createDiv({ cls: "tradoshi-su-rank-name" });
			const line = name.createDiv({ cls: "tradoshi-su-name" });
			hueDot(line, hue);
			line.createSpan({ text: r.name });
			if (r.meta?.status === "paused") line.createSpan({ cls: "tradoshi-badge tradoshi-su-status is-paused", text: "‖" });
			name.createDiv({
				cls: "tradoshi-bar-sub",
				text: [tradesLabel(s.trades), s.winRate === null ? null : `${Math.round(s.winRate)} %`, few ? st("few") : null].filter(Boolean).join(" · "),
			});
			const track = row.createDiv({ cls: "tradoshi-bar-track" });
			track.createDiv({ cls: `tradoshi-bar ${value >= 0 ? "is-gain" : "is-loss"}` }).setCssProps({ "--w": `${Math.max(2, (Math.abs(value) / max) * 50)}%` });
			const figure = row.createDiv({ cls: "tradoshi-su-rank-value" });
			figure.createDiv({ cls: `tradoshi-strong ${sign(by === "net" ? s.net : (s.expectancy ?? 0))}`, text: by === "net" ? money(s.net, ctx.currency) : money(s.expectancy ?? 0, ctx.currency) });
			figure.createDiv({ cls: "tradoshi-bar-sub", text: by === "net" ? `${money(s.expectancy ?? 0, ctx.currency)}/${t("perTrade").split(" ").pop() ?? ""}` : money(s.net, ctx.currency) });
			const tip = [
				r.name,
				`${t("net")} : ${money(s.net, ctx.currency, 2)}`,
				`${t("expectancy")} : ${money(s.expectancy ?? 0, ctx.currency, 2)} ${t("perTrade")}`,
				`${t("winRate")} : ${s.winRate === null ? "–" : `${num(s.winRate, 1)} %`}`,
				`${t("profitFactor")} : ${s.profitFactor === null ? "–" : num(s.profitFactor)}`,
				`${t("avgR")} : ${s.avgR === null ? "–" : num(s.avgR)}`,
				tradesLabel(s.trades),
			];
			if (few) tip.push(st("fewTip", { n: EDGE_MIN_TRADES }));
			row.addEventListener("mousemove", (e) => ctx.tip(e, tip));
			row.addEventListener("mouseleave", () => ctx.hideTip());
			const open = (): void => void openSetups(ctx.plugin, { kind: "detail", key: r.key });
			row.addEventListener("click", open);
			row.addEventListener("keydown", (e) => {
				if (e.key === "Enter") open();
			});
		});
		const more = card.createEl("button", { cls: "tradoshi-link-button tradoshi-su-rank-more", text: rows.length > SHOWN ? st("seeAll", { n: rows.length }) : st("openInView") });
		more.addEventListener("click", () => void openSetups(ctx.plugin));
	},
};
