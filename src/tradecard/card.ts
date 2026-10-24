import { MarkdownRenderChild, Modal, TFile, type App, type FrontMatterCache } from "obsidian";
import { emotionLabel } from "../i18n";
import { dateLabel, duration, money, num, sign } from "../format";
import { tradesFromVault } from "../journal-data";
import type TradoshiPlugin from "../main";
import { appLink } from "../render";
import { renderContext } from "../sync";
import { ladder, outcomeOf, plannedRewardRisk, priceDigits, riskFromR, type TradePrices } from "./geometry";
import { tc } from "./text";

// The card at the top of a trade note: what happened, at a glance, and the trader's own
// review. It reads the note's properties, so it follows every sync; the review goes to
// `review_*` properties, which the sync never touches.

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const VIDEO = new Set(["mp4", "webm", "mov", "m4v"]);

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Local day "YYYY-MM-DD" of now. */
const today = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface Media {
	src: string;
	video: boolean;
	name: string;
}

/** Images and videos embedded in the note, in the order they appear. */
function mediaOf(app: App, file: TFile): Media[] {
	const out: Media[] = [];
	for (const e of app.metadataCache.getFileCache(file)?.embeds ?? []) {
		if (/^https?:\/\//.test(e.link)) {
			const ext = e.link.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
			if (IMAGE.has(ext) || VIDEO.has(ext)) out.push({ src: e.link, video: VIDEO.has(ext), name: e.link });
			continue;
		}
		const dest = app.metadataCache.getFirstLinkpathDest(e.link.split("#")[0], file.path);
		if (!dest) continue;
		const ext = dest.extension.toLowerCase();
		if (IMAGE.has(ext) || VIDEO.has(ext)) out.push({ src: app.vault.getResourcePath(dest), video: VIDEO.has(ext), name: dest.basename });
	}
	return out;
}

class MediaModal extends Modal {
	constructor(
		app: App,
		private readonly items: Media[],
		private index: number,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("tradoshi-media-modal");
		this.draw();
		this.scope.register([], "ArrowLeft", () => this.go(-1));
		this.scope.register([], "ArrowRight", () => this.go(1));
	}

	private go(delta: number): void {
		this.index = (this.index + delta + this.items.length) % this.items.length;
		this.draw();
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		const m = this.items[this.index];
		if (m.video) el.createEl("video", { attr: { src: m.src, controls: "" }, cls: "tradoshi-media-full" });
		else el.createEl("img", { attr: { src: m.src, alt: m.name }, cls: "tradoshi-media-full" });
		if (this.items.length > 1) {
			const nav = el.createDiv({ cls: "tradoshi-tc-nav" });
			nav.createEl("button", { text: "‹" }).addEventListener("click", () => this.go(-1));
			nav.createSpan({ cls: "tradoshi-muted", text: `${this.index + 1} / ${this.items.length}` });
			nav.createEl("button", { text: "›" }).addEventListener("click", () => this.go(1));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class TradeCard extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly plugin: TradoshiPlugin,
		private readonly sourcePath: string,
	) {
		super(containerEl);
	}

	onload(): void {
		this.render();
		this.registerEvent(
			this.plugin.app.metadataCache.on("changed", (file) => {
				// Not while the trader is typing in the card: the redraw would take the field away.
				if (file.path === this.sourcePath && !this.containerEl.contains(this.containerEl.ownerDocument.activeElement)) this.render();
			}),
		);
	}

	private get app(): App {
		return this.plugin.app;
	}

	private render(): void {
		const root = this.containerEl;
		root.empty();
		root.addClass("tradoshi-tc");
		const file = this.app.vault.getFileByPath(this.sourcePath);
		const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		if (!file || !fm || !s(fm.tradoshi_id) || n(fm.pnl) === null) {
			root.createEl("p", { cls: "tradoshi-empty", text: tc("notATrade") });
			return;
		}
		this.drawHead(root, fm);
		this.drawMetrics(root, fm);
		this.drawLadder(root, fm);
		const cols = root.createDiv({ cls: "tradoshi-tc-cols" });
		this.drawTradoshi(cols.createDiv({ cls: "tradoshi-tc-section" }), fm);
		this.drawReview(cols.createDiv({ cls: "tradoshi-tc-section" }), file, fm);
		this.drawMedia(root, file);
		this.drawNav(root, file, fm);
	}

	private drawHead(root: HTMLElement, fm: FrontMatterCache): void {
		const pnl = n(fm.pnl) ?? 0;
		const currency = s(fm.currency) ?? "USD";
		const side = fm.side === "short" ? "short" : "long";
		const outcome = outcomeOf(pnl);
		const head = root.createDiv({ cls: "tradoshi-tc-head" });
		const id = head.createDiv({ cls: "tradoshi-tc-id" });
		id.createSpan({ cls: "tradoshi-tc-symbol", text: s(fm.symbol) ?? "" });
		id.createSpan({ cls: `tradoshi-badge is-${side}`, text: tc(side) });
		id.createSpan({ cls: `tradoshi-badge is-${outcome}`, text: tc(outcome) });
		if (fm.review_done === true) id.createSpan({ cls: "tradoshi-badge is-reviewed", text: `✓ ${tc("reviewed")}` });
		const res = head.createDiv({ cls: "tradoshi-tc-result" });
		res.createDiv({ cls: `tradoshi-tc-pnl ${sign(pnl)}`, text: money(pnl, currency, 2) });
		const r = n(fm.r_multiple);
		if (r !== null) res.createDiv({ cls: `tradoshi-tc-r ${sign(r)}`, text: `${r > 0 ? "+" : ""}${num(r)} R` });

		const parts: string[] = [];
		const account = s(fm.account);
		const broker = s(fm.broker);
		if (account) parts.push(broker ? `${account} · ${broker}` : account);
		const opened = s(fm.opened);
		const closed = s(fm.closed);
		if (opened) parts.push(`${opened.replace("T", " ")}${closed ? ` → ${closed.slice(11) || closed}` : ""}`);
		if (opened && closed) {
			const held = Date.parse(`${closed}Z`) - Date.parse(`${opened}Z`);
			if (Number.isFinite(held) && held >= 0) parts.push(`${tc("duration")} ${duration(held)}`);
		}
		root.createDiv({ cls: "tradoshi-tc-sub", text: parts.join(" · ") });
	}

	private drawMetrics(root: HTMLElement, fm: FrontMatterCache): void {
		const currency = s(fm.currency) ?? "USD";
		const price = (v: number | null): string => (v === null ? "–" : num(v, priceDigits(v)));
		const prices = this.prices(fm);
		const fees = (n(fm.commission) ?? 0) + (n(fm.swap) ?? 0);
		const risk = riskFromR(n(fm.pnl) ?? 0, n(fm.r_multiple));
		const rr = plannedRewardRisk(prices);
		const grid = root.createDiv({ cls: "tradoshi-tc-metrics" });
		const tile = (label: string, value: string, tone = ""): void => {
			const c = grid.createDiv({ cls: "tradoshi-kpi" });
			c.createDiv({ cls: "tradoshi-kpi-label", text: label });
			c.createDiv({ cls: `tradoshi-kpi-value ${tone}`, text: value });
		};
		tile(tc("entry"), price(prices.entry));
		tile(tc("exit"), price(prices.exit));
		tile(tc("stopLoss"), price(prices.stopLoss));
		tile(tc("takeProfit"), price(prices.takeProfit));
		tile(tc("volume"), n(fm.volume) === null ? "–" : num(n(fm.volume) ?? 0, priceDigits(n(fm.volume) ?? 0)));
		tile(tc("costs"), fees ? money(fees, currency, 2) : "–", fees < 0 ? "neg" : "");
		tile(tc("risk"), risk === null ? "–" : money(risk, currency, 2).replace(/^\+/, ""));
		tile(tc("plannedRr"), rr === null ? "–" : `1:${num(rr, 1)}`);
	}

	private prices(fm: FrontMatterCache): TradePrices {
		return { side: fm.side === "short" ? "short" : "long", entry: n(fm.entry), exit: n(fm.exit), stopLoss: n(fm.stop_loss), takeProfit: n(fm.take_profit) };
	}

	/** The prices on one line: the stretch at risk in red, the one aimed at in green, the exit marked. */
	private drawLadder(root: HTMLElement, fm: FrontMatterCache): void {
		const l = ladder(this.prices(fm));
		if (!l) return;
		const W = 800, H = 92, pl = 16, pr = 16, line = 46;
		const x = (pos: number): number => pl + pos * (W - pl - pr);
		const svg = root.createSvg("svg", { cls: "tradoshi-tc-ladder", attr: { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": tc("ladder") } });
		svg.createSvg("line", { cls: "tradoshi-tc-ladder-base", attr: { x1: pl, x2: W - pr, y1: line, y2: line } });
		if (l.risk) svg.createSvg("rect", { cls: ["tradoshi-tc-zone", "is-risk"], attr: { x: x(l.risk[0]), y: line - 9, width: x(l.risk[1]) - x(l.risk[0]), height: 18, rx: 3 } });
		if (l.reward) svg.createSvg("rect", { cls: ["tradoshi-tc-zone", "is-reward"], attr: { x: x(l.reward[0]), y: line - 9, width: x(l.reward[1]) - x(l.reward[0]), height: 18, rx: 3 } });
		const label: Record<string, string> = { sl: tc("stopLoss"), entry: tc("entry"), exit: tc("exit"), tp: tc("takeProfit") };
		const pnl = n(fm.pnl) ?? 0;
		const placed: number[] = [];
		for (const m of [...l.marks].sort((a, b) => a.pos - b.pos)) {
			const mx = x(m.pos);
			// Two labels too close to each other: the second one goes below the line.
			const below = placed.some((p) => Math.abs(p - mx) < 90);
			placed.push(mx);
			const tone = m.kind === "exit" ? (pnl >= 0 ? "is-gain" : "is-loss") : `is-${m.kind}`;
			svg.createSvg("line", { cls: ["tradoshi-tc-mark", tone], attr: { x1: mx, x2: mx, y1: line - 14, y2: line + 14 } });
			const anchor = m.pos < 0.1 ? "start" : m.pos > 0.9 ? "end" : "middle";
			svg.createSvg("text", { cls: "tradoshi-tc-mark-label", attr: { x: mx, y: below ? line + 30 : line - 20, "text-anchor": anchor } }).textContent = `${label[m.kind]} ${num(m.price, priceDigits(m.price))}`;
		}
	}

	private drawTradoshi(sec: HTMLElement, fm: FrontMatterCache): void {
		sec.createDiv({ cls: "tradoshi-tc-section-title", text: tc("fromTradoshi") });
		const rows = sec.createDiv({ cls: "tradoshi-tc-facts" });
		const fact = (label: string, value: string, cls = ""): void => {
			const r = rows.createDiv({ cls: "tradoshi-tc-fact" });
			r.createSpan({ cls: "tradoshi-muted", text: label });
			r.createSpan({ cls, text: value });
		};
		const emotion = s(fm.emotion);
		if (emotion) fact(tc("emotion"), emotionLabel(emotion));
		const rating = n(fm.rating);
		if (rating !== null) fact(tc("rating"), `${"★".repeat(Math.round(rating))}${"☆".repeat(Math.max(0, 5 - Math.round(rating)))}`);
		if (typeof fm.followed_plan === "boolean") fact(tc("plan"), fm.followed_plan ? `✓ ${tc("planYes")}` : `✗ ${tc("planNo")}`, fm.followed_plan ? "pos" : "neg");
		const tags = Array.isArray(fm.tradoshi_tags) ? fm.tradoshi_tags.map(String) : [];
		if (tags.length) {
			const chips = sec.createDiv({ cls: "tradoshi-tc-tags" });
			const cats = this.plugin.settings.tagCategories;
			for (const tag of tags) {
				const cat = (cats[tag] ?? "").toLowerCase();
				chips.createSpan({ cls: `tradoshi-tag${cat === "setups" ? " is-setup" : cat === "mistakes" ? " is-mistake" : ""}`, text: tag });
			}
		}
		if (!emotion && rating === null && typeof fm.followed_plan !== "boolean" && !tags.length) rows.createDiv({ cls: "tradoshi-muted", text: "–" });
		const id = s(fm.tradoshi_id) ?? "";
		if (this.plugin.settings.appLinks && !id.startsWith("file-")) {
			sec.createEl("a", { cls: "tradoshi-guide-link", text: tc("editInTradoshi"), href: appLink(renderContext(this.plugin.settings), "trade_card_edit") });
		}
	}

	private drawReview(sec: HTMLElement, file: TFile, fm: FrontMatterCache): void {
		sec.createDiv({ cls: "tradoshi-tc-section-title", text: tc("myReview") });
		const save = (key: string, value: unknown): Promise<void> =>
			this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
				if (value === null || value === "") delete front[key];
				else front[key] = value;
			});
		const field = (key: string, label: string, hint: string): void => {
			const wrap = sec.createDiv({ cls: "tradoshi-tc-field" });
			wrap.createEl("label", { text: label });
			const area = wrap.createEl("textarea", { attr: { rows: 2, placeholder: hint, "aria-label": label } });
			area.value = s(fm[key]) ?? "";
			area.addEventListener("change", () => void save(key, area.value.trim()));
		};
		field("review_thesis", tc("thesis"), tc("thesisHint"));
		field("review_lesson", tc("lesson"), tc("lessonHint"));
		const done = fm.review_done === true;
		const row = sec.createDiv({ cls: "tradoshi-tc-reviewed" });
		row.createSpan({ cls: done ? "pos" : "tradoshi-muted", text: done ? tc("reviewedOn", { d: s(fm.review_date) ?? "" }) : tc("notReviewed") });
		row.createEl("button", { cls: done ? "" : "mod-cta", text: done ? tc("markUnreviewed") : tc("markReviewed") }).addEventListener("click", () => {
			void this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
				if (done) {
					delete front.review_done;
					delete front.review_date;
				} else {
					front.review_done = true;
					front.review_date = today();
				}
			});
		});
	}

	private drawMedia(root: HTMLElement, file: TFile): void {
		const items = mediaOf(this.app, file);
		const sec = root.createDiv({ cls: "tradoshi-tc-section tradoshi-tc-media" });
		sec.createDiv({ cls: "tradoshi-tc-section-title", text: tc("media") });
		if (!items.length) {
			sec.createDiv({ cls: "tradoshi-muted tradoshi-small", text: tc("noMedia") });
			return;
		}
		const strip = sec.createDiv({ cls: "tradoshi-tc-thumbs" });
		items.forEach((m, i) => {
			const b = strip.createEl("button", { cls: "tradoshi-tc-thumb", attr: { "aria-label": m.name } });
			if (m.video) b.createEl("video", { attr: { src: m.src, muted: "", preload: "metadata" } });
			else b.createEl("img", { attr: { src: m.src, alt: m.name, loading: "lazy" } });
			b.addEventListener("click", () => new MediaModal(this.app, items, i).open());
		});
	}

	private drawNav(root: HTMLElement, file: TFile, fm: FrontMatterCache): void {
		const nav = root.createDiv({ cls: "tradoshi-tc-nav" });
		const { prev, next } = neighbours(this.app, file.path, s(fm.account));
		const go = (path: string | null): void => {
			const f = path ? this.app.vault.getFileByPath(path) : null;
			if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
		};
		const b1 = nav.createEl("button", { text: `‹ ${tc("previous")}` });
		b1.disabled = !prev;
		b1.addEventListener("click", () => go(prev));
		const day = s(fm.trading_day);
		const dayPath = day ? this.plugin.pathForKey(`day:${day}`) : null;
		if (day) {
			const b = nav.createEl("button", { text: `${tc("day")} ${dateLabel(new Date(`${day}T12:00:00`).getTime(), { weekday: "short", day: "numeric", month: "short" })}` });
			b.disabled = !dayPath;
			b.addEventListener("click", () => go(dayPath));
		}
		const b2 = nav.createEl("button", { text: `${tc("next")} ›` });
		b2.disabled = !next;
		b2.addEventListener("click", () => go(next));
		const id = s(fm.tradoshi_id) ?? "";
		if (this.plugin.settings.appLinks && !id.startsWith("file-")) {
			nav.createEl("a", { cls: "tradoshi-guide-link", text: tc("replay"), href: appLink(renderContext(this.plugin.settings), "trade_card") });
		}
	}
}

/** The trades of the same account just before and just after this one, by close. */
export function neighbours(app: App, path: string, account: string | null): { prev: string | null; next: string | null } {
	const list = tradesFromVault(app)
		.filter((t) => t.path && (!account || t.account === account))
		.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
	const i = list.findIndex((t) => t.path === path);
	if (i < 0) return { prev: null, next: null };
	return { prev: list[i - 1]?.path ?? null, next: list[i + 1]?.path ?? null };
}
