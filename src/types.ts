export interface ApiTrade {
	id: string;
	symbol: string;
	side: "long" | "short";
	openTime: string | null;
	closeTime: string | null;
	entryPrice: number | null;
	exitPrice: number | null;
	volume: number | null;
	pnl: number;
	commission: number;
	swap: number;
	stopLoss: number | null;
	takeProfit: number | null;
	riskAmount: number | null;
	rMultiple: number | null;
	emotion: string | null;
	rating: number | null;
	followedPlan: boolean | null;
	reviewNote: string | null;
	tags: string[];
	/** A trade entered by hand that was not executed (missed) or not live (backtest): kept out of the figures. */
	kind?: "missed" | "backtest";
	missedReason?: string | null;
}

export interface ApiAccount {
	id: string;
	name: string;
	broker: string | null;
	currency: string;
	mode: "live" | "demo";
	archived: boolean;
	updatedAt: string;
	tradeCount: number;
	changed: boolean;
	trades?: ApiTrade[];
}

export interface ApiDayNote {
	date: string;
	updatedAt: string;
	markdown: string;
}

export interface ApiTag {
	name: string;
	color: string | null;
	category: string | null;
	description: string | null;
}

export interface JournalResponse {
	version: number;
	generatedAt: string;
	appUrl: string;
	accounts: ApiAccount[];
	notes: ApiDayNote[];
	tags: ApiTag[];
}

/** A trade together with the account it belongs to. */
export interface TradeWithAccount {
	trade: ApiTrade;
	account: ApiAccount;
}
