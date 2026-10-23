import { requestUrl } from "obsidian";
import type { JournalResponse } from "./types";

export const API_URL = "https://nzwmqmtenjgixsoetsbd.supabase.co/functions/v1/api-journal";

export class TradoshiError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status: number,
	) {
		super(message);
	}
}

export interface FetchOptions {
	/** Oldest day to include, YYYY-MM-DD. */
	from: string | null;
	/** Only return the detail of accounts and notes changed after this instant. */
	since: string | null;
	clientVersion: string;
}

export async function fetchJournal(token: string, options: FetchOptions): Promise<JournalResponse> {
	const params = new URLSearchParams();
	if (options.from) params.set("from", options.from);
	if (options.since) params.set("since", options.since);
	const query = params.toString();

	let response;
	try {
		response = await requestUrl({
			url: query ? `${API_URL}?${query}` : API_URL,
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				"X-Tradoshi-Client": `obsidian/${options.clientVersion}`,
			},
			throw: false,
		});
	} catch {
		throw new TradoshiError("Tradoshi could not be reached. Check your connection.", "network", 0);
	}

	if (response.status >= 400) {
		let code = "error";
		let message = `Tradoshi answered with an error (${response.status}).`;
		try {
			const body = response.json as { error?: string; message?: string };
			if (body?.error) code = body.error;
			if (body?.message) message = body.message;
		} catch {
			// The body was not JSON: keep the generic message.
		}
		throw new TradoshiError(message, code, response.status);
	}

	const data = response.json as JournalResponse;
	if (!data || data.version !== 1 || !Array.isArray(data.accounts)) {
		throw new TradoshiError("Tradoshi sent an answer this version cannot read. Update the plugin.", "format", response.status);
	}
	return data;
}
