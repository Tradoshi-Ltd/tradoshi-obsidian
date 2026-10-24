# Tradoshi Trading Journal

A complete trading journal inside Obsidian, in Markdown notes you own.

Your trades come from your [Tradoshi](https://tradoshi.com) journal, synced automatically from over 2,000 brokers and prop firms (MetaTrader 4 and 5, cTrader, NinjaTrader, Tradovate, Interactive Brokers and more), from a statement you import, or by hand. The plugin writes them as plain notes you can link, tag, query and keep forever, and analyses them on your computer.

## What you get

### A dashboard you shape
- **Widgets you turn on, off and order** (Customize): key figures compared with the period before, equity curve, P&L calendar that opens each day, discipline and cost of each mistake, setups, emotions, days of the week, latest trades, and more.
- **Advanced analytics**: Sharpe and Calmar ratios, payoff, streaks, holding times, drawdown curve and time under water, P&L by day and trade by trade, long against short, results by hour with your best hours, rolling win rate and rolling average win and loss, results by symbol and by tag, year heatmap, weekly summary and a trading score that shows how it is built.
- **Periods and filters**: 7, 30 or 90 days, this month, this year or all time; one account or all; symbols, setups, tags to require or leave out, side and outcome.
- **Goals**: a result for the month, a loss limit for the day, and goals of your own (result, number of trades, win rate, average R or trades reviewed, each day, week or month, at least or at most, on one account or all).
- **Tools**: quick links, trades to review, missed trades, position size calculator, a pinned note (your plan, your rules), recent items, privacy mode that blurs every amount for a screenshot.

### A note per trade, with its card
- **The trade card** at the top of each trade note: prices on one scale (stop loss, entry, exit, take profit), key figures, risk and planned reward to risk, holding time, the Tradoshi data (emotion, execution, plan, tags), previous and next trade, and the trading day.
- **Your review**: thesis, lesson and a reviewed state, kept in properties the sync never touches (`review_*`).
- **Charts and media**: screenshots and videos you paste in the note show in the card and open full screen, where each chart gets its own tags and note.
- The same facts stay in a folded table, readable wherever the plugin is not (mobile without the plugin, Publish, another editor). The sections of the card can be hidden in the settings.

### A trade log
- Every trade in a table with the columns you choose and order, sorting, grouping by day, week, month, quarter or year with subtotals.
- Date range, account, type (executed, missed, backtest), review state and advanced filters.
- Select several trades (Shift+click for a range) to mark them reviewed, add a setup, a mistake or a tag, or delete their notes.
- A gallery of all the charts and media of your trades, sorted by date or result, filtered by chart tag.

### Prop firm challenges
- One or two evaluation phases then the funded account, each with its rules: profit target, maximum loss (static, or trailing at the end of the day or after each trade), daily loss, minimum and maximum days, consistency.
- Every rule as a gauge (respected, at risk, broken with its day), the balance curve with its floor and target, payouts (when one is possible, how much, your share) and what your evaluations cost against what they paid.
- Starting profiles for FTMO, FundedNext and The5ers, to check against your firm's current rules.

### Accounts
- Assets under management over time, a card per account and a page per account: balance, return, drawdown in %, win rate, profit factor, balance curve, profit target.

### Trades by hand, statements, Excel
- **Add a trade by hand**, executed, missed or backtest: P&L and R are computed from prices, size and point value. Missed and backtest trades are journaled but kept out of your figures.
- **Import a statement**: MetaTrader 4 or 5 report (.html), any CSV or Excel (.xlsx) file. Columns are recognized in English, French, Spanish and Portuguese, and can be corrected before importing.

### Notes that stay yours
- **A note per trade, a note per trading day and an overview note**, with their properties, for Bases and Dataview.
- **Room for your own thinking.** The plugin only updates the block between `%% tradoshi:start %%` and `%% tradoshi:end %%` and its own properties. What you write elsewhere is never touched.
- **Your notes stay where you put them.** Rename or move a note anywhere in the vault and it keeps receiving its updates there. The plugin never renames, moves or deletes a note on its own, and a note you delete is not written again (**Restore deleted notes** brings them back).
- **Your time zone, your trading day.** Dates use the time zone of the journal, set once from your computer. A trading day can start at the hour you choose, for example 23:00 to follow the forex week.
- **A navigation sidebar** with every view and a search through your trades and days by symbol, account, tag, emotion or date.

Before you connect an account, the dashboard, the accounts and the prop firm view show a sample journal.

## Three ways to bring your trades

| | Automatic sync | Imported file | By hand |
|---|---|---|---|
| How | Your broker sends your trades to Tradoshi, which writes them in your vault | A MetaTrader 4 or 5 report (.html), a CSV or an Excel file, read in the plugin | The trade form of the plugin |
| Where your trades are | A copy in Tradoshi (data stored in Europe), a full copy in your vault | In your vault only: nothing is sent | In your vault only: nothing is sent |
| Brokers | Over 2,000 brokers and prop firms | Any broker or platform that exports a file | Any |
| Price | Paid Tradoshi plans, with a free trial | Free | Free |

In every case, the notes you write never leave your computer.

Every step, with screenshots: [Tradoshi for Obsidian](https://tradoshi.com/en/obsidian.html?utm_source=obsidian&utm_medium=readme&utm_campaign=guide).

## Connect in one click

1. Install the plugin and enable it.
2. In Tradoshi, open **Settings, Obsidian** and click **Connect Obsidian**. The vault opens and asks you to confirm.
3. The first sync starts right away.

You can also create a token in Tradoshi and paste it in the plugin settings, under **Access token**.

Don't have an account yet? [Create a free Tradoshi account](https://app.tradoshi.com/?utm_source=obsidian&utm_medium=readme&utm_campaign=signup).

## Commands

Open the dashboard, the trade log, the accounts, the prop firms or the navigation sidebar; sync now; import a statement; add a trade by hand; edit the current trade; mark the current trade as reviewed; open the next or previous trade; new prop firm challenge; open the position size calculator; turn privacy mode on or off; open the overview note; open the web app; restore deleted notes.

## Settings

| Setting | Default |
|---|---|
| Folder | `Tradoshi` |
| History | Last 90 days (30 days, 12 months or everything) |
| One note per trade | On |
| One note per trading day | On |
| Include demo accounts | Off |
| Include archived accounts | Off |
| Links back to Tradoshi | On |
| Time zone | The one of your computer, the day you install the plugin |
| A trading day starts at | Midnight |
| Sync when the vault opens | On |
| Sync automatically | Every hour |
| Sections of the trade card | All shown |

## When do new trades show up?

An automatic sync asks Tradoshi only for what changed and writes only those accounts; once a day, and at the first sync after Obsidian opens, it reads the whole journal. With automatic sync, Tradoshi syncs MetaTrader 4 and 5 accounts every night, and the plugin picks up those trades at its next sync, without opening Tradoshi. Other brokers and platforms sync when Tradoshi is open: if a trade is missing, open Tradoshi, then sync again. The overview note shows when each account was last updated.

## Disclosures

- **Account required.** The plugin needs a free Tradoshi account and an access token created in Tradoshi, also to import a file or to enter a trade by hand. Those trades are still kept on your computer only: the account identifies you, it does not receive them.
- **Payment.** A Tradoshi account is free, with trades entered by hand and file imports. Automatic sync from your brokers is part of the paid plans, with a free trial. The plugin itself is free and works with any plan.
- **Network use.** The plugin sends requests to one place only: the Tradoshi API (`nzwmqmtenjgixsoetsbd.supabase.co`, the server that hosts Tradoshi), to read your journal. It sends your access token and the plugin version. Nothing from your vault is ever sent.
- **Read only.** The access token can only read your journal. It cannot change your journal, place trades, reach your broker credentials or your billing. You can revoke it at any time in Tradoshi.
- **Where the token is kept.** In the secret storage of Obsidian, not in a plain settings file.
- **Server-side records.** For each token, Tradoshi records when it was last used, how many requests it made and the plugin version, to show them to you in Tradoshi and to apply a rate limit. There is no telemetry in the plugin. See the [privacy policy](https://tradoshi.com/en/privacy).
- **Open source.** The full source code is in this repository, under the MIT license.

## Development

```bash
npm install
npm run build   # type check and bundle main.js and styles.css
npm test        # unit tests of the computations
npm run lint    # official Obsidian lint rules
```

## Support

Open an issue in this repository, or write to contact@tradoshi.com.
