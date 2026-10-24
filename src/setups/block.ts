import { debounce, MarkdownRenderChild } from "obsidian";
import { sparkline } from "../accounts/view";
import { amount, money, num, sign } from "../format";
import { t } from "../i18n";
import { loadDashData } from "../journal-data";
import type TradoshiPlugin from "../main";
import { mainCurrency } from "../stats";
import { executionGap, metaFromProperties, norm, setupRows } from "./logic";
import { EditSetupModal } from "./modals";
import { setupMetas } from "./sheets";
import { st, statusLabel } from "./text";
import { openSetups } from "./view";

// The figures of a setup at the top of its sheet (the `tradoshi-setup` block): all its
// history, read from the trade notes, so the sheet shows how the setup does while the
// trader writes its playbook. Redrawn when the trades or the sheet change.

const pct = (v: number | null): string => (v === null ? "–" : `${num(v, 1)} %`);

export class SetupBlock extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly plugin: TradoshiPlugin,
		private readonly sourcePath: string,
	) {
		super(containerEl);
	}

	onload(): void {
		this.render();
		const later = debounce(() => this.render(), 1500, true);
		this.registerEvent(
			this.plugin.app.metadataCache.on("changed", (file, _data, cache) => {
				if (file.path === this.sourcePath || typeof cache.frontmatter?.tradoshi_id === "string") later();
			}),
		);
	}

	private render(): void {
		const app = this.plugin.app;
		const root = this.containerEl;
		root.empty();
		root.addClass("tradoshi-su-block");
		const file = app.vault.getFileByPath(this.sourcePath);
		const meta = file ? metaFromProperties(app.metadataCache.getFileCache(file)?.frontmatter, file.path, file.basename) : null;
		if (!file || !meta) {
			root.createEl("p", { cls: "tradoshi-empty", text: st("blockNotSheet") });
			return;
		}
		const data = loadDashData(app, this.plugin.isConnected(), this.plugin.tagCategories());
		const metas = setupMetas(app, data.sample);
		const currency = mainCurrency(data.trades);
		const row = setupRows(
			data.trades.filter((x) => x.currency === currency),
			data.categories,
			metas,
		).find((r) => r.key === norm(meta.name));

		const head = root.createDiv({ cls: "tradoshi-su-block-head" });
		head.createSpan({ cls: `tradoshi-badge tradoshi-su-status is-${meta.status}`, text: statusLabel(meta.status) });
		head.createSpan({ cls: "tradoshi-muted", text: data.sample ? st("blockSample") : st("blockScope", { c: currency }) });
		const actions = head.createDiv({ cls: "tradoshi-su-block-actions" });
		actions.createEl("button", { text: st("edit") }).addEventListener("click", () => new EditSetupModal(app, file, meta).open());
		actions.createEl("button", { cls: "mod-cta", text: st("openInView") }).addEventListener("click", () => void openSetups(this.plugin, { kind: "detail", key: norm(meta.name) }));

		if (!row || !row.stats.trades) {
			root.createEl("p", { cls: "tradoshi-empty", text: st("blockNoTrade") });
			return;
		}
		const s = row.stats;
		const grid = root.createDiv({ cls: "tradoshi-su-block-figures" });
		const fig = (label: string, value: string, cls = ""): void => {
			const d = grid.createDiv({ cls: "tradoshi-kpi" });
			d.createDiv({ cls: "tradoshi-kpi-label", text: label });
			d.createDiv({ cls: `tradoshi-kpi-value ${cls}`, text: value });
		};
		fig(t("net"), money(s.net, currency), sign(s.net));
		fig(t("trades"), String(s.trades));
		fig(t("winRate"), pct(s.winRate));
		fig(t("expectancy"), s.expectancy === null ? "–" : money(s.expectancy, currency), sign(s.expectancy ?? 0));
		fig(t("profitFactor"), s.profitFactor === null ? (s.wins && !s.losses ? "∞" : "–") : num(s.profitFactor));
		fig(t("avgR"), s.avgR === null ? "–" : `${s.avgR > 0 ? "+" : ""}${num(s.avgR)} R`, sign(s.avgR ?? 0));
		if (s.curve.length > 1) sparkline(root, [0, ...s.curve], meta.name);
		const gap = executionGap(row.trades, data.categories);
		const lines: string[] = [];
		if (gap.planCost !== null && gap.planCost > 0) lines.push(st("planCost", { v: amount(gap.planCost, currency) }));
		if (gap.mistakeCost !== null && gap.mistakeCost > 0) lines.push(st("mistakeCost", { v: amount(gap.mistakeCost, currency) }));
		for (const l of lines) root.createDiv({ cls: "tradoshi-su-block-line neg", text: l });
	}
}
