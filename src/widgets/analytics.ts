import { advancedMetricsWidget } from "./advanced-metrics";
import { hoursWidget, longShortWidget, symbolsWidget, tagsWidget } from "./breakdowns";
import { dailyPnlWidget, drawdownWidget, rollingAverageWidget, rollingWinRateWidget, tradeBarsWidget } from "./curves";
import { goalsWidget } from "./goals";
import { scoreWidget, streaksWidget, weekSummaryWidget, yearMapWidget } from "./overview";
import type { Widget } from "./types";

// The analytics widgets, in their default order. Sizes are chosen so that each row of
// the 12-column grid is full on a wide pane: metrics (12), drawdown 7 + long/short 5,
// days 6 + trades 6, rolling 6 + 6, hours 4 + symbols 4 + tags 4. The overview
// widgets (week 7 + streaks 5, score 6 + goals 6, year map 12) start hidden.
export const ANALYTICS_WIDGETS: Widget[] = [
	advancedMetricsWidget,
	drawdownWidget,
	longShortWidget,
	dailyPnlWidget,
	tradeBarsWidget,
	rollingWinRateWidget,
	rollingAverageWidget,
	hoursWidget,
	symbolsWidget,
	tagsWidget,
	weekSummaryWidget,
	streaksWidget,
	scoreWidget,
	goalsWidget,
	yearMapWidget,
];
