import type { PluginModule } from "../modules";
import { lt } from "./text";
import { openTradeLog, TRADE_LOG_VIEW, TradeLogView } from "./view";

export const tradeLogModule: PluginModule = {
	id: "trade-log",
	load(plugin) {
		plugin.registerView(TRADE_LOG_VIEW, (leaf) => new TradeLogView(leaf, plugin));
		plugin.addCommand({ id: "open-trade-log", name: lt("cmdOpen"), callback: () => void openTradeLog(plugin) });
	},
	places: (plugin) => [{ id: "trade-log", label: () => lt("title"), icon: "table", open: () => void openTradeLog(plugin) }],
};
