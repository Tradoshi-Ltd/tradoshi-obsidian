import type { SetupMeta, SetupStatus } from "./logic";
import { sheetTexts, st, type SetupKey } from "./text";

// The sheets of the three setups of the sample journal (Breakout, Pullback, Range), in
// the language of the interface: what a filled sheet looks like before the trader has
// written one. They live in memory only; nothing is written in the vault.

interface SampleSetup {
	name: string;
	markets: string[];
	sessions: SetupKey[];
	timeframe: string;
	status: SetupStatus;
	text: { desc: SetupKey; entry: SetupKey; manage: SetupKey; exit: SetupKey; rules: SetupKey[] };
}

const SAMPLE: SampleSetup[] = [
	{
		name: "Breakout",
		markets: ["XAUUSD", "GBPUSD", "US30"],
		sessions: ["sessLondon", "sessNewYork"],
		timeframe: "M15",
		status: "active",
		text: { desc: "breakoutDesc", entry: "breakoutEntry", manage: "breakoutManage", exit: "breakoutExit", rules: ["breakoutRule1", "breakoutRule2", "breakoutRule3", "breakoutRule4"] },
	},
	{
		name: "Pullback",
		markets: ["EURUSD", "GBPUSD", "XAUUSD"],
		sessions: ["sessLondon"],
		timeframe: "H1",
		status: "active",
		text: { desc: "pullbackDesc", entry: "pullbackEntry", manage: "pullbackManage", exit: "pullbackExit", rules: ["pullbackRule1", "pullbackRule2", "pullbackRule3", "pullbackRule4"] },
	},
	{
		name: "Range",
		markets: ["EURUSD", "US30"],
		sessions: ["sessAsia", "sessNewYork"],
		timeframe: "M5",
		status: "testing",
		text: { desc: "rangeDesc", entry: "rangeEntry", manage: "rangeManage", exit: "rangeExit", rules: ["rangeRule1", "rangeRule2", "rangeRule3", "rangeRule4"] },
	},
];

export function sampleSheets(): { meta: SetupMeta; content: string }[] {
	const tx = sheetTexts();
	return SAMPLE.map((s) => ({
		meta: {
			name: s.name,
			aliases: [],
			path: null,
			description: st(s.text.desc),
			markets: s.markets,
			sessions: s.sessions.map((k) => st(k)),
			timeframe: s.timeframe,
			status: s.status,
			color: null,
			playbook: null,
		},
		content: [
			`## ${tx.playbook}`,
			"",
			`### ${tx.entry}`,
			st(s.text.entry),
			"",
			`### ${tx.management}`,
			st(s.text.manage),
			"",
			`### ${tx.exit}`,
			st(s.text.exit),
			"",
			`## ${tx.rules}`,
			"",
			...s.text.rules.map((k) => `- [ ] ${st(k)}`),
			"",
		].join("\n"),
	}));
}
