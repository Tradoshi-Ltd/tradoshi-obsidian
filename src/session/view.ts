import { ItemView, Modal, setIcon, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { money, sign } from "../format";
import { tradesLabel } from "../i18n";
import type TradoshiPlugin from "../main";
import { zoned } from "../render";
import { periodOf } from "../reviews/periods";
import { timeOf, typingIn } from "../reviews/ui";
import { ensureDayNote, openFile } from "../reviews/vault";
import { weekdayOf } from "../stats-advanced";
import { addNote, answerGate, closeSession, endSession, endStale, goLive, prepare, removeEntry, restartGate, resume, sessionEvents, takeBreak, toggleCheck } from "./actions";
import { defaultGate, gatesOf, lessonTagOf, sessionData, tagsOf, type SessionData } from "./data";
import { isRunnable, type Gate } from "./gate";
import { drawGateRun, outcomeLabel } from "./gate-ui";
import { clock, liveTime, minutesOf, sessionTrades, summary, timeline, windowStatus, type SessionRecord, type SessionTrade, type WindowStatus } from "./logic";
import { SessionSettingsModal } from "./settings-modal";
import { st } from "./text";
import { vaultSessionTrades } from "./write";

// Session mode, in the right sidebar: before the session (the windows of the day, the
// checklist, the plan), during it (the clock, the trade gate, the log), after it (what
// happened, the lessons, the note written to the journal).

export const SESSION_VIEW = "tradoshi-session";

/** Where the clock stands against the trading windows, in the journal time zone. */
export function clockStatus(plugin: TradoshiPlugin, now = Date.now()): WindowStatus {
	const cfg = sessionData(plugin).config;
	const z = zoned(now, plugin.settings.timeZone || "UTC");
	return windowStatus(cfg.windows, weekdayOf(z.date), minutesOf(z.time) ?? 0, cfg.prepMinutes);
}

/** A one-line text asked before an action: the reason of an unplanned session, a note. */
export class AskModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly placeholder: string,
		private readonly submit: (text: string, tag: string | null) => void,
		private readonly tags: string[] = [],
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		let tag = this.tags[0] ?? null;
		if (this.tags.length) {
			const chips = this.contentEl.createDiv({ cls: "tradoshi-sv-tags" });
			const draw = (): void => {
				chips.empty();
				for (const x of this.tags) {
					const b = chips.createEl("button", { cls: `tradoshi-chip${x === tag ? " is-active" : ""}`, text: x });
					b.addEventListener("click", () => {
						tag = x;
						draw();
					});
				}
			};
			draw();
		}
		const input = this.contentEl.createEl("textarea", { cls: "tradoshi-sv-ask", attr: { rows: 3, placeholder: this.placeholder, "aria-label": this.title } });
		const go = (): void => {
			if (!input.value.trim()) return;
			this.submit(input.value.trim(), tag);
			this.close();
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				go();
			}
		});
		const row = this.contentEl.createDiv({ cls: "tradoshi-tq-foot" });
		row.createEl("button", { text: st("cancel") }).addEventListener("click", () => this.close());
		row.createEl("button", { cls: "mod-cta", text: st("ok") }).addEventListener("click", go);
		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function askUnplanned(plugin: TradoshiPlugin, live: boolean): void {
	new AskModal(plugin.app, st("unplannedTitle"), st("reasonHint"), (reason) => void (live ? goLive(plugin, null, reason) : prepare(plugin, null, reason))).open();
}

export function askNote(plugin: TradoshiPlugin): void {
	const cfg = sessionData(plugin).config;
	new AskModal(plugin.app, st("addNote"), st("noteHint"), (text, tag) => void addNote(plugin, tag ?? tagsOf(cfg)[0], text), tagsOf(cfg)).open();
}

export class SessionView extends ItemView {
	private draft = "";
	private tag: string | null = null;
	/** Gate shown in the gate panel. */
	private gateId: string | null = null;
	/** A gate tried outside a live session: answers stay here, nothing is written. */
	private trial: { gate: string; steps: { node: string; option: number }[] } | null = null;
	private timer: number | null = null;
	private dirty = false;
	private phaseKey = "";
	private clocks: (() => void)[] = [];

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TradoshiPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return SESSION_VIEW;
	}

	getDisplayText(): string {
		return st("title");
	}

	getIcon(): string {
		return "timer";
	}

	async onOpen(): Promise<void> {
		await endStale(this.plugin);
		this.draw();
		const redraw = (): void => this.schedule();
		sessionEvents.add(redraw);
		this.register(() => sessionEvents.delete(redraw));
		this.registerEvent(
			this.app.metadataCache.on("changed", (_file, _data, cache) => {
				if (typeof cache.frontmatter?.tradoshi_id === "string" && sessionData(this.plugin).current) this.schedule();
			}),
		);
		this.registerDomEvent(this.contentEl, "focusout", () => {
			if (this.dirty) this.schedule();
		});
		this.registerInterval(window.setInterval(() => this.tick(), 15000));
	}

	async onClose(): Promise<void> {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.contentEl.empty();
	}

	private schedule(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			if (typingIn(this.contentEl)) this.dirty = true;
			else {
				this.dirty = false;
				this.draw();
			}
		}, 150);
	}

	/** Every few seconds: the clocks move; a window that opens or closes redraws the view. */
	private tick(): void {
		for (const c of this.clocks) c();
		const s = clockStatus(this.plugin);
		const key = `${s.phase}:${s.window?.id ?? ""}`;
		if (key !== this.phaseKey) this.schedule();
		void endStale(this.plugin);
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass("tradoshi-sv");
		this.clocks = [];
		const data = sessionData(this.plugin);
		const status = clockStatus(this.plugin);
		this.phaseKey = `${status.phase}:${status.window?.id ?? ""}`;
		const s = data.current;

		const head = el.createDiv({ cls: "tradoshi-sv-head" });
		head.createDiv({ cls: "tradoshi-sv-title", text: st("title") });
		const pill = head.createSpan({ cls: `tradoshi-sv-pill is-${s ? s.phase : status.phase}` });
		pill.setText(s ? phaseName(s.phase) : statusName(status.phase));
		const gear = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": st("settingsTitle") } });
		setIcon(gear, "settings");
		gear.addEventListener("click", () => new SessionSettingsModal(this.app, this.plugin, () => this.schedule()).open());

		if (!s) this.drawIdle(el, data, status);
		else this.drawSession(el, data, s);
	}

	// ── No session ───────────────────────────────────────────────────────────

	private drawIdle(el: HTMLElement, data: SessionData, status: WindowStatus): void {
		const box = el.createDiv({ cls: "tradoshi-sv-box" });
		const w = status.window;
		const mins = status.minutes === null ? "" : clock(status.minutes * 60000);
		if (status.phase === "none") box.createDiv({ text: data.config.windows.length ? st("noWindowToday") : st("noWindowSet") });
		else if (status.phase === "done") box.createDiv({ text: st("windowsDone") });
		else if (status.phase === "live" && w) box.createDiv({ text: st("windowLive", { w: w.name, t: mins }) });
		else if (w) box.createDiv({ text: st("windowNext", { w: w.name, from: w.start, to: w.end, t: mins }) });
		const actions = box.createDiv({ cls: "tradoshi-sv-actions" });
		const planned = status.phase === "live" || status.phase === "prep" || status.phase === "waiting" ? w : null;
		if (planned) {
			if (status.phase !== "live") actions.createEl("button", { cls: "mod-cta", text: st("prepare", { w: planned.name }) }).addEventListener("click", () => void prepare(this.plugin, planned.name, null));
			actions.createEl("button", { cls: status.phase === "live" ? "mod-cta" : "", text: st("startNow", { w: planned.name }) }).addEventListener("click", () => void goLive(this.plugin, planned.name, null));
		}
		actions.createEl("button", { text: st("unplannedStart") }).addEventListener("click", () => askUnplanned(this.plugin, true));
		if (!data.config.windows.length)
			actions.createEl("button", { text: st("setWindows") }).addEventListener("click", () => new SessionSettingsModal(this.app, this.plugin, () => this.schedule()).open());
		if (data.last) {
			const last = this.app.vault.getFileByPath(data.last);
			if (last instanceof TFile) {
				const row = box.createDiv({ cls: "tradoshi-small tradoshi-muted" });
				row.appendText(`${st("lastSession")} `);
				const a = row.createEl("a", { text: last.basename, href: "#" });
				a.addEventListener("click", (e) => {
					e.preventDefault();
					void openFile(this.app, last);
				});
			}
		}
		this.drawGatePanel(el, data, false);
	}

	// ── A session ────────────────────────────────────────────────────────────

	private drawSession(el: HTMLElement, data: SessionData, s: SessionRecord): void {
		const now = Date.now();
		const trades = sessionTrades(s, vaultSessionTrades(this.plugin), now);
		const sum = summary(s, trades, now, lessonTagOf(data.config));

		const strip = el.createDiv({ cls: "tradoshi-sv-box tradoshi-sv-strip" });
		const top = strip.createDiv({ cls: "tradoshi-sv-strip-top" });
		top.createSpan({ cls: "tradoshi-strong", text: s.window ?? st("unplanned") });
		if (s.unplanned) top.createSpan({ cls: "tradoshi-badge is-unplanned", text: st("unplanned") });
		if (s.unplanned && s.reason) strip.createDiv({ cls: "tradoshi-small tradoshi-muted", text: `${st("reason")} : ${s.reason}` });
		const times = strip.createDiv({ cls: "tradoshi-sv-times" });
		const clockEl = times.createSpan({ cls: "tradoshi-sv-clock" });
		const update = (): void => {
			const from = s.startAt ?? s.prepAt;
			const label = s.phase === "prep" ? st("prepSince", { t: timeOf(this.plugin, s.prepAt) }) : `${timeOf(this.plugin, from)}${s.endAt ? ` → ${timeOf(this.plugin, s.endAt)}` : ""}`;
			clockEl.setText(s.phase === "prep" ? label : `${label} · ${clock(liveTime(s, Date.now()))}`);
		};
		update();
		if (s.phase !== "ended") this.clocks.push(update);
		const figures = strip.createDiv({ cls: "tradoshi-sv-figures" });
		figures.createSpan({ text: tradesLabel(sum.trades) });
		if (sum.currency && sum.trades) figures.createSpan({ cls: `tradoshi-strong ${sign(sum.net)}`, text: money(sum.net, sum.currency, 2) });
		const g = sum.gate;
		if (g.go + g.wait + g.nogo) figures.createSpan({ cls: "tradoshi-muted", text: `${outcomeLabel("go")} ${g.go} · ${outcomeLabel("wait")} ${g.wait} · ${outcomeLabel("nogo")} ${g.nogo}` });

		const actions = strip.createDiv({ cls: "tradoshi-sv-actions" });
		if (s.phase === "prep") actions.createEl("button", { cls: "mod-cta", text: st("goLive") }).addEventListener("click", () => void goLive(this.plugin));
		if (s.phase === "live") actions.createEl("button", { text: st("takeBreak") }).addEventListener("click", () => void takeBreak(this.plugin));
		if (s.phase === "break") actions.createEl("button", { cls: "mod-cta", text: st("resume") }).addEventListener("click", () => void resume(this.plugin));
		if (s.phase !== "ended") actions.createEl("button", { cls: "mod-warning", text: st("end") }).addEventListener("click", () => void endSession(this.plugin));
		const planLink = actions.createEl("button", { text: st("openDayCard") });
		planLink.addEventListener("click", () => void ensureDayNote(this.plugin, s.day).then((f) => openFile(this.app, f)));

		if (s.phase === "break") el.createDiv({ cls: "tradoshi-sv-break", text: st("breakText") });
		if (s.phase === "prep") this.drawChecklist(el, s);
		if (s.phase === "ended") this.drawEnded(el, s, sum.lessons);
		if (s.phase === "live") this.drawGatePanel(el, data, true);
		this.drawComposer(el, data, s);
		this.drawTimeline(el, data, s, trades);
		if (s.phase === "prep") this.drawGatePanel(el, data, false);
	}

	private drawChecklist(el: HTMLElement, s: SessionRecord): void {
		if (!s.checklist.length) return;
		const done = s.checklist.filter((c) => c.done).length;
		const sec = el.createDiv({ cls: "tradoshi-sv-box" });
		const title = sec.createDiv({ cls: "tradoshi-rv-section-title" });
		title.createSpan({ text: st("checklist") });
		title.createSpan({ cls: "tradoshi-card-extra", text: `${done}/${s.checklist.length}` });
		s.checklist.forEach((c, i) => {
			const label = sec.createEl("label", { cls: `tradoshi-sv-check${c.done ? " is-done" : ""}` });
			const box = label.createEl("input", { attr: { type: "checkbox" } });
			box.checked = c.done;
			box.addEventListener("change", () => void toggleCheck(this.plugin, i));
			label.appendText(` ${c.text}`);
		});
		if (done === s.checklist.length) sec.createDiv({ cls: "pos tradoshi-small", text: st("checklistDone") });
	}

	private drawEnded(el: HTMLElement, s: SessionRecord, lessons: number): void {
		const sec = el.createDiv({ cls: "tradoshi-sv-box" });
		sec.createDiv({ cls: "tradoshi-rv-section-title", text: st("afterSession") });
		sec.createDiv({ cls: "tradoshi-small", text: lessons ? st("lessonsN", { n: lessons }) : st("lessonPrompt") });
		const file = s.notePath ? this.app.vault.getFileByPath(s.notePath) : null;
		const actions = sec.createDiv({ cls: "tradoshi-sv-actions" });
		if (file instanceof TFile) actions.createEl("button", { text: st("openSessionNote") }).addEventListener("click", () => void openFile(this.app, file));
		actions.createEl("button", { text: st("reviewDay") }).addEventListener("click", () => void ensureDayNote(this.plugin, s.day).then((f) => openFile(this.app, f)));
		actions.createEl("button", { cls: "mod-cta", text: st("close") }).addEventListener("click", () => void closeSession(this.plugin));
		if (periodOf("week", s.day).end === s.day) sec.createDiv({ cls: "tradoshi-small tradoshi-muted", text: st("weekEnds") });
	}

	// ── Trade gate ───────────────────────────────────────────────────────────

	private drawGatePanel(el: HTMLElement, data: SessionData, live: boolean): void {
		const gates = gatesOf(data.config).filter(isRunnable);
		const sec = el.createDiv({ cls: "tradoshi-sv-box tradoshi-sv-gate" });
		const head = sec.createDiv({ cls: "tradoshi-rv-section-title" });
		head.createSpan({ text: live ? st("tradeGate") : st("tryGate") });
		if (!gates.length) {
			sec.createDiv({ cls: "tradoshi-muted tradoshi-small", text: st("noGate") });
			return;
		}
		const run = live ? data.run : this.trial;
		const current: Gate = gates.find((g) => g.id === (run?.gate ?? this.gateId)) ?? gates.find((g) => g.id === defaultGate(data.config).id) ?? gates[0];
		if (gates.length > 1) {
			const select = head.createEl("select", { cls: "dropdown", attr: { "aria-label": st("tradeGate") } });
			for (const g of gates) select.createEl("option", { value: g.id, text: g.name });
			select.value = current.id;
			select.addEventListener("change", () => {
				this.gateId = select.value;
				if (live) void restartGate(this.plugin, select.value);
				else {
					this.trial = { gate: select.value, steps: [] };
					this.draw();
				}
			});
		}
		if (!live) sec.createDiv({ cls: "tradoshi-muted tradoshi-small", text: st("trialHint") });
		if (!run || run.gate !== current.id) {
			sec.createEl("button", { cls: live ? "mod-cta" : "", text: st("runGate") }).addEventListener("click", () => {
				if (live) void restartGate(this.plugin, current.id);
				else {
					this.trial = { gate: current.id, steps: [] };
					this.draw();
				}
			});
			return;
		}
		drawGateRun(
			sec,
			current,
			run.steps,
			(steps) => {
				if (live) void answerGate(this.plugin, current.id, steps);
				else {
					this.trial = { gate: current.id, steps };
					this.draw();
				}
			},
			() => {
				if (live) void restartGate(this.plugin, current.id);
				else {
					this.trial = { gate: current.id, steps: [] };
					this.draw();
				}
			},
		);
	}

	// ── Log ──────────────────────────────────────────────────────────────────

	private drawComposer(el: HTMLElement, data: SessionData, s: SessionRecord): void {
		const tags = tagsOf(data.config);
		const lesson = lessonTagOf(data.config);
		if (!this.tag || !tags.includes(this.tag)) this.tag = s.phase === "ended" && tags.includes(lesson) ? lesson : tags[0];
		const sec = el.createDiv({ cls: "tradoshi-sv-box" });
		sec.createDiv({ cls: "tradoshi-rv-section-title", text: s.phase === "ended" ? st("addLesson") : st("log") });
		const chips = sec.createDiv({ cls: "tradoshi-sv-tags" });
		for (const x of tags) {
			const b = chips.createEl("button", { cls: `tradoshi-chip${x === this.tag ? " is-active" : ""}`, text: x });
			b.setAttr("aria-pressed", String(x === this.tag));
			b.addEventListener("click", () => {
				this.tag = x;
				this.draw();
			});
		}
		const row = sec.createDiv({ cls: "tradoshi-sv-compose" });
		const input = row.createEl("textarea", { attr: { rows: 2, placeholder: st("noteHint"), "aria-label": st("addNote") } });
		input.value = this.draft;
		input.addEventListener("input", () => (this.draft = input.value));
		const add = (): void => {
			const text = input.value.trim();
			if (!text) return;
			this.draft = "";
			input.value = "";
			input.blur();
			void addNote(this.plugin, this.tag ?? tags[0], text);
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				add();
			}
		});
		row.createEl("button", { cls: "mod-cta", text: st("add") }).addEventListener("click", add);
	}

	private drawTimeline(el: HTMLElement, data: SessionData, s: SessionRecord, trades: SessionTrade[]): void {
		const entries = timeline(s, trades, data.config.tradeEvents).reverse();
		const sec = el.createDiv({ cls: "tradoshi-sv-box" });
		const title = sec.createDiv({ cls: "tradoshi-rv-section-title" });
		title.createSpan({ text: st("timeline") });
		title.createSpan({ cls: "tradoshi-card-extra", text: String(entries.length) });
		const list = sec.createDiv({ cls: "tradoshi-sv-timeline" });
		for (const e of entries) {
			const row = list.createDiv({ cls: `tradoshi-sv-entry is-${e.kind}${e.tag === lessonTagOf(data.config) ? " is-lesson" : ""}` });
			row.createSpan({ cls: "tradoshi-sv-time", text: timeOf(this.plugin, e.at) });
			const body = row.createDiv({ cls: "tradoshi-sv-entry-body" });
			if (e.kind === "note") body.createSpan({ cls: "tradoshi-sv-tag", text: e.tag ?? "" });
			if (e.kind === "gate" && e.outcome) body.createSpan({ cls: `tradoshi-sv-outcome is-${e.outcome}`, text: outcomeLabel(e.outcome) });
			if (e.kind === "trade") {
				const a = body.createEl("a", { text: e.text, href: "#" });
				a.addEventListener("click", (ev) => {
					ev.preventDefault();
					void openFile(this.app, e.path ? this.app.vault.getFileByPath(`${e.path}.md`) : null);
				});
				if (e.pnl !== undefined && e.currency) body.createSpan({ cls: `tradoshi-strong ${sign(e.pnl)}`, text: ` ${money(e.pnl, e.currency, 2)}` });
			} else body.createSpan({ cls: e.kind === "phase" ? "tradoshi-muted" : "", text: e.kind === "gate" ? ` ${e.text}` : e.text });
			if (e.kind === "note") {
				const rm = row.createEl("button", { cls: "clickable-icon tradoshi-sv-remove", text: "✕", attr: { "aria-label": st("removeNote") } });
				rm.addEventListener("click", () => void removeEntry(this.plugin, e.at));
			}
		}
		if (!entries.length) list.createDiv({ cls: "tradoshi-muted tradoshi-small", text: st("emptyLog") });
		if (data.config.tradeEvents && !trades.length && (s.phase === "live" || s.phase === "break")) sec.createDiv({ cls: "tradoshi-muted tradoshi-small", text: st("tradesArrive") });
	}
}

function phaseName(p: SessionRecord["phase"]): string {
	return p === "prep" ? st("phasePrep") : p === "live" ? st("phaseLive") : p === "break" ? st("phaseBreak") : st("phaseEnded");
}

function statusName(p: WindowStatus["phase"]): string {
	return p === "live" ? st("statusLive") : p === "prep" ? st("statusPrep") : p === "waiting" ? st("statusWaiting") : p === "done" ? st("statusDone") : st("statusNone");
}

export async function openSessionView(plugin: TradoshiPlugin): Promise<void> {
	const ws = plugin.app.workspace;
	const existing = ws.getLeavesOfType(SESSION_VIEW)[0];
	const leaf = existing ?? ws.getRightLeaf(false);
	if (!leaf) return;
	if (!existing) await leaf.setViewState({ type: SESSION_VIEW, active: true });
	await ws.revealLeaf(leaf);
}
