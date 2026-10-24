import { Modal, Setting, type App } from "obsidian";
import type TradoshiPlugin from "../main";
import { amount } from "../format";
import { applyProfile, blankPhase, newChallenge, newId, PROFILES, profileById } from "./profiles";
import { addPayout, advance, emptyPayout, isDay, markPassed, type Challenge, type ChallengeEval, type DrawdownMode, type Limit, type PayoutEval, type Phase, type Unit } from "./rules";
import { accountsOf, journalData, phaseNames, todayOf, upsertChallenge } from "./store";
import { tr } from "./texts";
import { dayLabel, phaseSummary } from "./ui";

// The windows of the module: create or change a challenge, move to the next phase,
// record a payout, confirm a deletion. Nothing is saved before the trader confirms.

const parseNum = (s: string): number | null => {
	const v = parseFloat(s.replace(/\s/g, "").replace(",", "."));
	return Number.isFinite(v) ? v : null;
};
const shown = (v: number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

function numberInput(el: HTMLInputElement): void {
	el.type = "number";
	el.min = "0";
	el.step = "any";
}

function sizeName(c: Challenge): string {
	const size = c.size >= 1000 ? `${Math.round(c.size / 1000)}K` : String(c.size);
	return [c.firm, size].filter(Boolean).join(" ");
}

export class ChallengeModal extends Modal {
	private c: Challenge;
	private readonly isNew: boolean;
	private readonly accounts: { name: string; currency: string }[];
	private readonly today: string;
	/** Phases unfolded in the window. */
	private readonly unfolded = new Set<number>();
	private nameTouched: boolean;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		existing: Challenge | null,
	) {
		super(app);
		const data = journalData(plugin);
		this.accounts = accountsOf(data);
		this.today = todayOf(plugin, data.sample);
		this.isNew = !existing;
		if (existing) {
			this.c = JSON.parse(JSON.stringify(existing)) as Challenge;
			this.nameTouched = true;
		} else {
			const first = this.accounts[0];
			this.c = newChallenge({ id: newId(), profile: "custom", account: first?.name ?? "", size: 100000, currency: first?.currency ?? "USD", start: this.today, names: phaseNames() });
			this.nameTouched = false;
		}
		this.unfolded.add(this.c.current);
	}

	onOpen(): void {
		this.setTitle(this.isNew ? tr("newTitle") : tr("editTitle"));
		this.modalEl.addClass("tradoshi-pf-modal");
		this.draw();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		const c = this.c;
		el.createEl("p", { cls: "tradoshi-pf-warning", text: tr("profileWarning") });

		new Setting(el)
			.setName(tr("fProfile"))
			.setDesc(this.isNew ? tr("fProfileDesc") : tr("fProfileReplace"))
			.addDropdown((d) => {
				for (const p of PROFILES) d.addOption(p.id, p.id === "custom" ? tr("custom") : `${p.firm} · ${p.program}`);
				d.setValue(profileById(c.profile).id).onChange((v) => {
					this.c = applyProfile(this.c, v, phaseNames());
					if (!this.nameTouched) this.c.name = sizeName(this.c);
					this.draw();
				});
			});
		new Setting(el).setName(tr("fName")).addText((t) =>
			t
				.setPlaceholder(sizeName(c) || tr("fName"))
				.setValue(c.name)
				.onChange((v) => {
					c.name = v.trim();
					this.nameTouched = true;
				}),
		);
		new Setting(el).setName(tr("fFirm")).addText((t) => t.setValue(c.firm).onChange((v) => (c.firm = v.trim())));

		const account = new Setting(el).setName(tr("fAccount")).setDesc(tr("fAccountDesc"));
		if (this.accounts.length) {
			account.addDropdown((d) => {
				for (const a of this.accounts) d.addOption(a.name, a.name);
				if (c.account && !this.accounts.some((a) => a.name === c.account)) d.addOption(c.account, c.account);
				d.setValue(c.account).onChange((v) => {
					c.account = v;
					const found = this.accounts.find((a) => a.name === v);
					if (found) c.currency = found.currency;
					this.draw();
				});
			});
		} else {
			account.addText((t) => t.setValue(c.account).onChange((v) => (c.account = v.trim())));
		}

		new Setting(el)
			.setName(tr("fSize"))
			.setDesc(tr("fSizeDesc"))
			.addText((t) => {
				numberInput(t.inputEl);
				t.setValue(shown(c.size)).onChange((v) => {
					c.size = parseNum(v) ?? 0;
					if (!this.nameTouched) c.name = sizeName(c);
				});
			})
			.addText((t) => {
				t.inputEl.addClass("tradoshi-pf-currency");
				t.inputEl.maxLength = 3;
				t.setPlaceholder("USD")
					.setValue(c.currency)
					.onChange((v) => (c.currency = v.trim().toUpperCase()));
			});
		new Setting(el)
			.setName(tr("fStart"))
			.setDesc(tr("fStartDesc"))
			.addText((t) => {
				t.inputEl.type = "date";
				t.setValue(c.phases[0].start ?? "").onChange((v) => {
					c.phases[0].start = v;
					c.phases[0].startAt = null;
				});
			});
		new Setting(el)
			.setName(tr("fCost"))
			.setDesc(tr("fCostDesc"))
			.addText((t) => {
				numberInput(t.inputEl);
				t.setPlaceholder(tr("optional"))
					.setValue(shown(c.cost))
					.onChange((v) => {
						const n = parseNum(v);
						c.cost = n !== null && n > 0 ? n : null;
					});
			});

		new Setting(el).setName(tr("phases")).setDesc(tr("phasesDesc")).setHeading();
		c.phases.forEach((p, i) => this.drawPhase(el, p, i));
		new Setting(el).addButton((b) =>
			b.setButtonText(tr("addPhase")).onClick(() => {
				const at = c.phases[c.phases.length - 1]?.funded ? c.phases.length - 1 : c.phases.length;
				const evaluations = c.phases.filter((p) => !p.funded).length;
				c.phases.splice(at, 0, blankPhase(tr("phaseN", { n: evaluations + 1 }), false));
				if (at <= c.current) c.current++;
				this.unfolded.clear();
				this.unfolded.add(at);
				this.draw();
			}),
		);

		if (c.phases.length > 1 || !this.isNew) this.drawProgress(el);

		this.errorEl = el.createDiv({ cls: "tradoshi-pf-error" });
		new Setting(el)
			.addButton((b) => b.setButtonText(tr("cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setCta()
					.setButtonText(this.isNew ? tr("create") : tr("save"))
					.onClick(() => void this.save()),
			);
	}

	private drawPhase(parent: HTMLElement, p: Phase, i: number): void {
		const c = this.c;
		const r = p.rules;
		const details = parent.createEl("details", { cls: "tradoshi-pf-phase-edit" });
		details.open = this.unfolded.has(i);
		details.addEventListener("toggle", () => {
			if (details.open) this.unfolded.add(i);
			else this.unfolded.delete(i);
		});
		const summary = details.createEl("summary");
		summary.createSpan({ cls: "tradoshi-strong", text: `${i + 1}. ${p.name}` });
		summary.createSpan({ cls: "tradoshi-muted", text: ` · ${p.funded ? tr("fundedAccount") : tr("evaluation")}${i === c.current ? ` · ${tr("inProgress")}` : ""}` });
		summary.createDiv({ cls: "tradoshi-pf-phase-summary", text: phaseSummary(p, c.size, c.currency) });
		const body = details.createDiv({ cls: "tradoshi-pf-phase-body" });

		new Setting(body).setName(tr("fPhaseName")).addText((t) => t.setValue(p.name).onChange((v) => (p.name = v.trim())));
		new Setting(body)
			.setName(tr("fFunded"))
			.setDesc(tr("fFundedDesc"))
			.addToggle((tg) =>
				tg.setValue(p.funded).onChange((v) => {
					p.funded = v;
					p.payout = v ? (p.payout ?? emptyPayout()) : null;
					this.draw();
				}),
			);
		if (this.accounts.length) {
			new Setting(body)
				.setName(tr("fPhaseAccount"))
				.setDesc(tr("fPhaseAccountDesc"))
				.addDropdown((d) => {
					d.addOption("", tr("sameAccount"));
					for (const a of this.accounts) d.addOption(a.name, a.name);
					if (p.account && !this.accounts.some((a) => a.name === p.account)) d.addOption(p.account, p.account);
					d.setValue(p.account ?? "").onChange((v) => (p.account = v || null));
				});
		}

		this.limitSetting(body, tr("rTarget"), tr("fTargetDesc"), () => r.profitTarget, (l) => (r.profitTarget = l));

		this.limitSetting(body, tr("rMaxLoss"), tr("fMaxLossDesc"), () => r.maxLoss, (l) => (r.maxLoss = l));
		new Setting(body)
			.setName(tr("fMode"))
			.setDesc(tr("fModeDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ static: tr("mStatic"), eod: tr("mEodLong"), intraday: tr("mIntradayLong") })
					.setValue(r.maxLossMode)
					.onChange((v) => {
						r.maxLossMode = v as DrawdownMode;
						this.draw();
					}),
			);
		if (r.maxLossMode !== "static") {
			new Setting(body)
				.setName(tr("fLock"))
				.setDesc(tr("fLockDesc"))
				.addToggle((tg) => tg.setValue(r.trailLock).onChange((v) => (r.trailLock = v)));
		}

		this.limitSetting(body, tr("rDailyLoss"), tr("fDailyDesc"), () => r.dailyLoss, (l) => (r.dailyLoss = l));
		new Setting(body)
			.setName(tr("fDailyOf"))
			.setDesc(tr("fDailyOfDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ size: tr("ofSize"), dayStart: tr("ofDayStart") })
					.setValue(r.dailyLossOf)
					.onChange((v) => (r.dailyLossOf = v === "dayStart" ? "dayStart" : "size")),
			);
		new Setting(body)
			.setName(tr("fDailyFails"))
			.setDesc(tr("fDailyFailsDesc"))
			.addToggle((tg) => tg.setValue(r.dailyLossFails).onChange((v) => (r.dailyLossFails = v)));

		this.countSetting(body, tr("rMinDays"), tr("fMinDaysDesc"), () => r.minDays, (n) => (r.minDays = n));
		this.countSetting(body, tr("rMaxDays"), tr("fMaxDaysDesc"), () => r.maxDays, (n) => (r.maxDays = n));
		this.countSetting(body, tr("fConsistency"), tr("fConsistencyDesc"), () => r.consistency, (n) => (r.consistency = n));

		if (p.funded) {
			const pay = p.payout ?? (p.payout = emptyPayout());
			new Setting(body).setName(tr("payoutPolicy")).setDesc(tr("payoutPolicyDesc")).setHeading();
			this.countSetting(body, tr("fWait"), tr("fWaitDesc"), () => pay.waitDays, (n) => (pay.waitDays = n));
			this.countSetting(body, tr("fPayoutDays"), tr("fPayoutDaysDesc"), () => pay.minDays, (n) => (pay.minDays = n));
			this.limitSetting(body, tr("fMinProfit"), tr("fMinProfitDesc"), () => pay.minProfit, (l) => (pay.minProfit = l));
			this.countSetting(body, tr("fSplit"), tr("fSplitDesc"), () => pay.split, (n) => (pay.split = n));
		}

		if (c.phases.length > 1 && (this.isNew || i > c.current)) {
			new Setting(body).addButton((b) =>
				b
					.setButtonText(tr("removePhase"))
					.setDestructive()
					.onClick(() => {
						c.phases.splice(i, 1);
						c.current = Math.min(c.current, c.phases.length - 1);
						this.unfolded.clear();
						this.draw();
					}),
			);
		}
	}

	/** A limit: a number, and whether it is a percentage of the account size or an amount. */
	private limitSetting(parent: HTMLElement, name: string, desc: string, get: () => Limit | null, set: (l: Limit | null) => void): void {
		let unit: Unit = get()?.unit ?? "percent";
		new Setting(parent)
			.setName(name)
			.setDesc(desc)
			.addText((t) => {
				numberInput(t.inputEl);
				t.setPlaceholder(tr("empty"))
					.setValue(shown(get()?.value))
					.onChange((v) => {
						const n = parseNum(v);
						set(n !== null && n > 0 ? { value: n, unit } : null);
					});
			})
			.addDropdown((d) =>
				d
					.addOptions({ percent: tr("unitPercent"), amount: this.c.currency || tr("unitAmount") })
					.setValue(unit)
					.onChange((v) => {
						unit = v === "amount" ? "amount" : "percent";
						const l = get();
						if (l) set({ ...l, unit });
					}),
			);
	}

	/** A whole number of days, or a percentage; empty when the rule does not apply. */
	private countSetting(parent: HTMLElement, name: string, desc: string, get: () => number | null, set: (n: number | null) => void): void {
		new Setting(parent)
			.setName(name)
			.setDesc(desc)
			.addText((t) => {
				numberInput(t.inputEl);
				t.setPlaceholder(tr("empty"))
					.setValue(shown(get()))
					.onChange((v) => {
						const n = parseNum(v);
						set(n !== null && n > 0 ? n : null);
					});
			});
	}

	private drawProgress(el: HTMLElement): void {
		const c = this.c;
		new Setting(el).setName(tr("progress")).setDesc(tr("progressDesc")).setHeading();
		new Setting(el).setName(tr("fCurrent")).addDropdown((d) => {
			for (const [i, p] of c.phases.entries()) d.addOption(String(i), `${i + 1}. ${p.name}`);
			d.setValue(String(c.current)).onChange((v) => {
				this.setCurrent(Number(v));
				this.draw();
			});
		});
		for (let i = 1; i <= c.current; i++) {
			const p = c.phases[i];
			new Setting(el).setName(tr("fPhaseStart", { phase: p.name })).addText((t) => {
				t.inputEl.type = "date";
				t.setValue(p.start ?? "").onChange((v) => {
					p.start = v;
					p.startAt = null;
				});
			});
		}
		if (!this.isNew) {
			const cur = c.phases[c.current];
			new Setting(el)
				.setName(tr("fOutcome"))
				.setDesc(tr("fOutcomeDesc"))
				.addDropdown((d) =>
					d
						.addOptions({ auto: tr("outcomeAuto"), passed: tr("outcomePassed"), failed: tr("outcomeFailed") })
						.setValue(cur.outcome ?? "auto")
						.onChange((v) => {
							cur.outcome = v === "passed" || v === "failed" ? v : null;
							cur.end = cur.outcome ? (cur.end ?? this.today) : null;
						}),
				);
			new Setting(el)
				.setName(tr("fArchived"))
				.setDesc(tr("fArchivedDesc"))
				.addToggle((tg) => tg.setValue(c.archived).onChange((v) => (c.archived = v)));
		}
	}

	/** The phase in progress, chosen in the window: earlier phases are passed, later ones not reached. */
	private setCurrent(k: number): void {
		const c = this.c;
		c.phases.forEach((p, i) => {
			if (i < k) {
				p.outcome = p.outcome ?? "passed";
				p.start = p.start ?? c.phases[Math.max(0, i - 1)].start ?? this.today;
			} else if (i > k) {
				p.start = null;
				p.startAt = null;
				p.end = null;
				p.outcome = null;
			}
		});
		const cur = c.phases[k];
		cur.start = cur.start ?? this.today;
		if (k < c.current) {
			cur.outcome = null;
			cur.end = null;
		}
		c.current = k;
	}

	private validate(): string | null {
		const c = this.c;
		if (!c.account) return tr("errAccount");
		if (!(c.size > 0)) return tr("errSize");
		if (!/^[A-Z]{3}$/.test(c.currency)) return tr("errCurrency");
		for (let i = 0; i <= c.current; i++) {
			const p = c.phases[i];
			if (!isDay(p.start)) return tr("errStart", { phase: p.name || String(i + 1) });
			const before = i > 0 ? c.phases[i - 1].start : null;
			if (before && p.start < before) return tr("errOrder", { phase: p.name || String(i + 1) });
		}
		return null;
	}

	private async save(): Promise<void> {
		const error = this.validate();
		if (error) {
			this.errorEl?.setText(error);
			return;
		}
		const c = this.c;
		const names = phaseNames();
		let n = 0;
		c.phases.forEach((p, i) => {
			if (!p.funded) n++;
			if (!p.name) p.name = p.funded ? names.funded : names.phase(n);
			// A phase reached later ends the day the next one starts.
			if (i < c.current && c.phases[i + 1].start) p.end = c.phases[i + 1].start;
		});
		if (!c.name) c.name = sizeName(c) || c.account;
		await upsertChallenge(this.plugin, c);
		this.close();
	}
}

/** Moves a challenge to its next phase, or records the last one as passed. */
export class AdvanceModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private readonly ev: ChallengeEval,
		private readonly today: string,
	) {
		super(app);
	}

	onOpen(): void {
		const c = this.ev.challenge;
		const cur = c.phases[c.current];
		const next = c.phases[c.current + 1];
		const reached = this.ev.current.targetReached;
		this.setTitle(next ? tr("advanceTitle", { next: next.name }) : tr("passTitle"));
		const el = this.contentEl;
		el.createEl("p", { text: next ? tr("advanceText", { phase: cur.name }) : tr("passText") });
		let when: string = reached ? "target" : "today";
		let day = this.today;
		new Setting(el).setName(tr("advanceWhen")).addDropdown((d) => {
			if (reached) d.addOption("target", tr("whenTarget", { d: dayLabel(reached.day) }));
			d.addOption("today", tr("whenToday"));
			d.addOption("date", tr("whenDate"));
			d.setValue(when).onChange((v) => {
				when = v;
				dateRow.settingEl.toggle(v === "date");
			});
		});
		const dateRow = new Setting(el).setName(tr("fDate")).addText((t) => {
			t.inputEl.type = "date";
			t.setValue(day).onChange((v) => (day = v));
		});
		dateRow.settingEl.toggle(when === "date");
		if (next?.account) el.createEl("p", { cls: "setting-item-description", text: tr("advanceAccount", { a: next.account }) });
		const error = el.createDiv({ cls: "tradoshi-pf-error" });
		new Setting(el)
			.addButton((b) => b.setButtonText(tr("notYet")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setCta()
					.setButtonText(next ? tr("advanceCta", { next: next.name }) : tr("passCta"))
					.onClick(() => {
						const target = when === "target" && reached ? reached : null;
						const d = target ? target.day : when === "today" ? this.today : day;
						if (!isDay(d) || (cur.start && d < cur.start)) {
							error.setText(tr("errDate"));
							return;
						}
						const updated = next ? advance(c, d, target ? target.at + 1 : null) : markPassed(c, d);
						void upsertChallenge(this.plugin, updated).then(() => this.close());
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Records money taken out of a funded account: it leaves the balance, the trader gets his share. */
export class PayoutModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TradoshiPlugin,
		private readonly c: Challenge,
		private readonly payout: PayoutEval | null,
		private readonly today: string,
	) {
		super(app);
	}

	onOpen(): void {
		const c = this.c;
		const split = c.phases[c.current]?.payout?.split ?? null;
		this.setTitle(tr("payoutTitle"));
		const el = this.contentEl;
		let day = this.today;
		let gross = Math.round((this.payout?.available ?? 0) * 100) / 100;
		const shareOf = (v: number): number => Math.round((split !== null ? (v * split) / 100 : v) * 100) / 100;
		let received = shareOf(gross);
		let receivedTouched = false;
		if (this.payout) el.createEl("p", { cls: "setting-item-description", text: tr("payoutAvailable", { v: amount(this.payout.available, c.currency) }) });
		new Setting(el).setName(tr("fDate")).addText((t) => {
			t.inputEl.type = "date";
			t.setValue(day).onChange((v) => (day = v));
		});
		let receivedInput: HTMLInputElement | null = null;
		new Setting(el)
			.setName(tr("fGross"))
			.setDesc(tr("fGrossDesc"))
			.addText((t) => {
				numberInput(t.inputEl);
				t.setValue(shown(gross)).onChange((v) => {
					gross = parseNum(v) ?? 0;
					if (!receivedTouched && receivedInput) {
						received = shareOf(gross);
						receivedInput.value = shown(received);
					}
				});
			});
		new Setting(el)
			.setName(tr("fReceived"))
			.setDesc(split !== null ? tr("fReceivedSplit", { n: split }) : tr("fReceivedDesc"))
			.addText((t) => {
				numberInput(t.inputEl);
				receivedInput = t.inputEl;
				t.setValue(shown(received)).onChange((v) => {
					received = parseNum(v) ?? 0;
					receivedTouched = true;
				});
			});
		const error = el.createDiv({ cls: "tradoshi-pf-error" });
		new Setting(el)
			.addButton((b) => b.setButtonText(tr("cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setCta()
					.setButtonText(tr("recordPayout"))
					.onClick(() => {
						if (!isDay(day) || !(gross > 0) || received < 0) {
							error.setText(tr("errPayout"));
							return;
						}
						void upsertChallenge(this.plugin, addPayout(c, { day, amount: gross, received })).then(() => this.close());
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly text: string,
		private readonly cta: string,
		private readonly onYes: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		this.contentEl.createEl("p", { text: this.text });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(tr("cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setDestructive()
					.setButtonText(this.cta)
					.onClick(() => {
						this.onYes();
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
