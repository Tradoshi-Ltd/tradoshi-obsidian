# Tradoshi Trading Journal

Keep your trading journal as Markdown notes in your own vault.

The plugin reads your [Tradoshi](https://tradoshi.com) journal and writes it into notes you own: one note per trade, one note per trading day, and an overview note. Your broker trades arrive in Tradoshi automatically, from over 2,000 brokers and platforms (MetaTrader 4 and 5, cTrader, NinjaTrader, Tradovate, Interactive Brokers, prop firms and more), and the plugin turns them into plain files you can link, tag, query and keep forever.

## What you get

- **A dashboard** (the owl in the ribbon): net P&L, win rate, profit factor, expectancy, average R, max drawdown and best day; equity curve; monthly P&L calendar that opens each day note; discipline (results when you follow your plan and when you don't, cost of each mistake); setups; emotions; days of the week; latest trades. It is computed on your computer from the notes of your vault, so it works offline. Before you connect an account, it shows a sample journal.
- **A note per trade**, with its properties: symbol, side, result, net P&L, R multiple, entry and exit, stop loss and take profit, fees, account, emotion, execution rating, whether you followed your plan, and your Tradoshi tags (`tradoshi_tags`).
- **A note per trading day**, with the net P&L, the win rate and a table of the day's trades linked to their notes, plus the day notes you wrote in Tradoshi.
- **An overview note** with your accounts, the last 30 days and links to your recent days.
- **Room for your own thinking.** Every note ends with a "My notes" section. The plugin only updates the block between `%% tradoshi:start %%` and `%% tradoshi:end %%` and its own properties. What you write elsewhere in the note, and the tags you add in `tags`, are never touched.
- **Your notes stay where you put them.** Each note carries its identity (`tradoshi_id`, `tradoshi_day`): rename it or move it anywhere in the vault and it keeps receiving its updates there. The plugin never renames, moves or deletes a note, and a note you delete is not written again (the command **Restore deleted notes** brings them back).
- **Your time zone, your trading day.** Dates and times use the time zone of the journal, set once from your computer, so traveling or moving does not shift a single day. A trading day can start at the hour you choose, for example 23:00 to follow the forex week.

Properties work with the core Bases plugin and with Dataview, so you can build your own views of your trading.

## Two ways to bring your trades

| | Automatic sync | Imported file |
|---|---|---|
| How | Your broker sends your trades to Tradoshi, which writes them in your vault | You import a MetaTrader 4 or 5 report (.html) or any CSV file in the plugin |
| Where your trades are | A copy in Tradoshi (data stored in Europe), a full copy in your vault | In your vault only: the file is read on your computer and nothing is sent |
| Brokers | Over 2,000 brokers and prop firms | Any broker or platform that exports a CSV |
| Price | Paid Tradoshi plans, with a free trial | Free |

In both cases, the notes you write never leave your computer. Importing the same file again updates the same notes instead of adding copies, and the column mapping of a CSV can be corrected before importing.

Every step, with screenshots: [Tradoshi for Obsidian](https://tradoshi.com/en/obsidian.html?utm_source=obsidian&utm_medium=readme&utm_campaign=guide).

## Connect in one click

1. Install the plugin and enable it.
2. In Tradoshi, open **Settings, Obsidian** and click **Connect Obsidian**. The vault opens and asks you to confirm.
3. The first sync starts right away.

You can also create a token in Tradoshi and paste it in the plugin settings, under **Access token**.

Don't have an account yet? [Create a free Tradoshi account](https://app.tradoshi.com/?utm_source=obsidian&utm_medium=readme&utm_campaign=signup).

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

Commands: **Open the dashboard**, **Sync journal now**, **Import a statement**, **Open the overview note**, **Open the web app**, **Restore deleted notes**.

## When do new trades show up?

Trades synced from your brokers reach the vault once your Tradoshi journal is up to date. If a trade is missing, open Tradoshi, then sync again. The overview note shows when each account was last updated.

## Disclosures

- **Account required.** The plugin needs a free Tradoshi account and an access token created in Tradoshi, also to import a file. An imported file is still read on your computer only: the account identifies you, it does not receive your trades.
- **Payment.** A Tradoshi account is free, with manual entry and file imports. Automatic sync from your brokers is part of the paid plans, with a free trial. The plugin itself is free and works with any plan.
- **Network use.** The plugin sends requests to one place only: the Tradoshi API (`nzwmqmtenjgixsoetsbd.supabase.co`, the server that hosts Tradoshi), to read your journal. It sends your access token and the plugin version. Nothing from your vault is ever sent.
- **Read only.** The access token can only read your journal. It cannot change your journal, place trades, reach your broker credentials or your billing. You can revoke it at any time in Tradoshi.
- **Where the token is kept.** In the secret storage of Obsidian, not in a plain settings file.
- **Server-side records.** For each token, Tradoshi records when it was last used, how many requests it made and the plugin version, to show them to you in Tradoshi and to apply a rate limit. There is no telemetry in the plugin. See the [privacy policy](https://tradoshi.com/en/privacy).
- **Open source.** The full source code is in this repository, under the MIT license.

## Development

```bash
npm install
npm run build   # type check and bundle main.js
npm test        # note rendering tests
npm run lint    # official Obsidian lint rules
```

## Support

Open an issue in this repository, or write to contact@tradoshi.com.
