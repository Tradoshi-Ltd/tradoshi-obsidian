import { Modal, Setting, type App } from "obsidian";
import { locale } from "../i18n";
import type TradoshiPlugin from "../main";
import { checklistOf, gatesOf, lessonTagOf, saveSessionData, sessionData, tagsOf, type SessionConfig } from "./data";
import { isRunnable, validateGate, type Gate } from "./gate";
import { GateEditorModal } from "./gate-ui";
import { minutesOf, type SessionWindow } from "./logic";
import { st } from "./text";

// Settings of session mode: trading windows, preparation time, the checklist, the
// tags of the log and the trade gates. Each change is saved at once.

const dayName = (d: number): string => new Date(2024, 0, 1 + d).toLocaleDateString(locale(), { weekday: "short" });

export class SessionSettingsModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private readonly onChange: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("tradoshi-smodal");
		this.setTitle(st("settingsTitle"));
		this.draw();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async update(change: (c: SessionConfig) => void, redraw = true): Promise<void> {
		const data = sessionData(this.plugin);
		change(data.config);
		await saveSessionData(this.plugin, data);
		this.onChange();
		if (redraw) this.draw();
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		const c = sessionData(this.plugin).config;

		new Setting(el).setName(st("windows")).setDesc(st("windowsDesc")).setHeading();
		if (!c.windows.length) el.createDiv({ cls: "tradoshi-muted tradoshi-small", text: st("noWindows") });
		c.windows.forEach((w, i) => this.drawWindow(el, w, i));
		new Setting(el).addButton((b) =>
			b.setButtonText(`+ ${st("addWindow")}`).onClick(() => {
				void this.update((cfg) => {
					cfg.windows.push({ id: `w${Date.now()}`, name: st("windowDefault"), start: "09:00", end: "11:30", days: [0, 1, 2, 3, 4] });
				});
			}),
		);
		new Setting(el)
			.setName(st("prepTime"))
			.setDesc(st("prepTimeDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ "0": st("none"), "15": "15 min", "30": "30 min", "45": "45 min", "60": "60 min", "90": "90 min" })
					.setValue(String(c.prepMinutes))
					.onChange((v) => void this.update((cfg) => (cfg.prepMinutes = Number(v)), false)),
			);

		new Setting(el).setName(st("checklist")).setDesc(st("checklistDesc")).setHeading();
		const items = checklistOf(c);
		items.forEach((item, i) => {
			new Setting(el)
				.addText((t) =>
					t.setValue(item).onChange((v) => {
						void this.update((cfg) => {
							const list = [...checklistOf(cfg)];
							list[i] = v;
							cfg.checklist = list;
						}, false);
					}),
				)
				.addExtraButton((b) =>
					b
						.setIcon("x")
						.setTooltip(st("remove"))
						.onClick(() => void this.update((cfg) => (cfg.checklist = checklistOf(cfg).filter((_, j) => j !== i)))),
				);
		});
		new Setting(el).addButton((b) => b.setButtonText(`+ ${st("addItem")}`).onClick(() => void this.update((cfg) => (cfg.checklist = [...checklistOf(cfg), ""]))));

		new Setting(el).setName(st("log")).setHeading();
		new Setting(el)
			.setName(st("logTags"))
			.setDesc(st("logTagsDesc"))
			.addText((t) =>
				t.setValue(tagsOf(c).join(", ")).onChange((v) => {
					void this.update((cfg) => (cfg.tags = v.split(",").map((x) => x.trim()).filter(Boolean)), false);
				}),
			);
		new Setting(el)
			.setName(st("lessonTag"))
			.setDesc(st("lessonTagDesc"))
			.addText((t) => t.setValue(lessonTagOf(c)).onChange((v) => void this.update((cfg) => (cfg.lessonTag = v.trim() || null), false)));
		new Setting(el)
			.setName(st("tradeEvents"))
			.setDesc(st("tradeEventsDesc"))
			.addToggle((t) => t.setValue(c.tradeEvents).onChange((v) => void this.update((cfg) => (cfg.tradeEvents = v), false)));

		new Setting(el).setName(st("gates")).setDesc(st("gatesDesc")).setHeading();
		const gates = gatesOf(c);
		for (const g of gates) {
			const issues = validateGate(g).length;
			const s = new Setting(el)
				.setName(`${g.name}${(c.gate ?? gates[0].id) === g.id ? ` · ${st("default")}` : ""}`)
				.setDesc(`${st("questionsN", { n: g.nodes.length })}${issues ? ` · ⚠ ${st("issuesN", { n: issues })}` : isRunnable(g) ? ` · ✓ ${st("ready")}` : ""}`);
			s.addButton((b) => b.setButtonText(st("edit")).onClick(() => this.editGate(g)));
			if ((c.gate ?? gates[0].id) !== g.id) s.addButton((b) => b.setButtonText(st("makeDefault")).onClick(() => void this.update((cfg) => (cfg.gate = g.id))));
			if (gates.length > 1)
				s.addExtraButton((b) =>
					b
						.setIcon("trash")
						.setTooltip(st("remove"))
						.onClick(() => void this.update((cfg) => (cfg.gates = gatesOf(cfg).filter((x) => x.id !== g.id)))),
				);
		}
		new Setting(el).addButton((b) =>
			b.setButtonText(`+ ${st("addGate")}`).onClick(() => {
				const id = `gate-${Date.now()}`;
				const blank: Gate = { id, name: st("gateDefaultName"), start: "q1", nodes: [{ id: "q1", question: "", options: [{ label: st("yes"), to: null }, { label: st("no"), to: null }] }] };
				this.editGate(blank, true);
			}),
		);
	}

	private drawWindow(el: HTMLElement, w: SessionWindow, i: number): void {
		const box = el.createDiv({ cls: "tradoshi-sv-window" });
		const row = box.createDiv({ cls: "tradoshi-tq-row" });
		const name = row.createEl("input", { attr: { type: "text", "aria-label": st("windowName") } });
		name.value = w.name;
		name.addEventListener("change", () => void this.update((cfg) => (cfg.windows[i].name = name.value.trim() || st("windowDefault")), false));
		const time = (value: string, key: "start" | "end", label: string): void => {
			const input = row.createEl("input", { attr: { type: "time", "aria-label": label } });
			input.value = value;
			input.addEventListener("change", () => {
				if (minutesOf(input.value) === null) return;
				void this.update((cfg) => (cfg.windows[i][key] = input.value), false);
			});
		};
		time(w.start, "start", st("from"));
		row.createSpan({ cls: "tradoshi-muted", text: "→" });
		time(w.end, "end", st("to"));
		row.createEl("button", { cls: "clickable-icon", text: "✕", attr: { "aria-label": st("remove") } }).addEventListener("click", () => {
			void this.update((cfg) => cfg.windows.splice(i, 1));
		});
		const days = box.createDiv({ cls: "tradoshi-sv-days" });
		for (let d = 0; d < 7; d++) {
			const on = w.days.includes(d);
			const b = days.createEl("button", { cls: `tradoshi-chip${on ? " is-active" : ""}`, text: dayName(d) });
			b.setAttr("aria-pressed", String(on));
			b.addEventListener("click", () => {
				void this.update((cfg) => {
					const list = cfg.windows[i].days;
					cfg.windows[i].days = on ? list.filter((x) => x !== d) : [...list, d].sort();
				});
			});
		}
	}

	private editGate(g: Gate, isNew = false): void {
		new GateEditorModal(this.app, g, (saved) => {
			void this.update((cfg) => {
				const list = gatesOf(cfg);
				cfg.gates = isNew ? [...list, saved] : list.map((x) => (x.id === saved.id ? saved : x));
			});
		}).open();
	}
}
