import type { DashTrade } from "../stats";
import { newChallenge, type PhaseNames } from "./profiles";
import { addDays, type Challenge } from "./rules";

// Challenges of the sample journal, shown before an account is connected so that the
// module can be seen working. Built from the sample trades, never saved. Pure.

export const SAMPLE_EVALUATION_ACCOUNT = "FTMO Challenge 100K";
export const SAMPLE_FUNDED_ACCOUNT = "FTMO Funded 100K";

const SIZE = 100000;

function firstDay(trades: DashTrade[], account: string): { day: string; currency: string } | null {
	const mine = trades.filter((t) => t.account === account).sort((a, b) => a.at - b.at);
	return mine.length ? { day: mine[0].day, currency: mine[0].currency } : null;
}

export function sampleChallenges(trades: DashTrade[], names?: PhaseNames): Challenge[] {
	const out: Challenge[] = [];

	// An evaluation in its first phase.
	const evaluation = firstDay(trades, SAMPLE_EVALUATION_ACCOUNT);
	if (evaluation) {
		const c = newChallenge({ id: "sample-evaluation", profile: "ftmo", account: SAMPLE_EVALUATION_ACCOUNT, size: SIZE, currency: evaluation.currency, start: evaluation.day, names });
		c.name = SAMPLE_EVALUATION_ACCOUNT;
		c.cost = 540;
		out.push(c);
	}

	// A funded account: both evaluation phases passed before it, one payout already taken.
	const funded = firstDay(trades, SAMPLE_FUNDED_ACCOUNT);
	if (funded) {
		const c = newChallenge({ id: "sample-funded", profile: "ftmo", account: SAMPLE_FUNDED_ACCOUNT, size: SIZE, currency: funded.currency, start: addDays(funded.day, -45), names });
		c.name = SAMPLE_FUNDED_ACCOUNT;
		c.cost = 540;
		const [one, two, three] = c.phases;
		one.outcome = "passed";
		one.end = addDays(funded.day, -31);
		two.start = addDays(funded.day, -28);
		two.outcome = "passed";
		two.end = addDays(funded.day, -10);
		three.start = funded.day;
		c.current = 2;
		// The payout follows the first day, 14 days or more into the funded phase, that ends 2,000 up.
		let cum = 0;
		const mine = trades.filter((t) => t.account === SAMPLE_FUNDED_ACCOUNT && t.currency === funded.currency).sort((a, b) => a.at - b.at);
		for (let i = 0; i < mine.length; i++) {
			cum += mine[i].pnl;
			const lastOfDay = i === mine.length - 1 || mine[i + 1].day !== mine[i].day;
			if (lastOfDay && cum >= 2000 && mine[i].day >= addDays(funded.day, 14) && i < mine.length - 1) {
				c.payouts.push({ day: addDays(mine[i].day, 1), amount: 2000, received: 1600 });
				break;
			}
		}
		out.push(c);
	}
	return out;
}
