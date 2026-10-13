# Changelog

## 0.2.1 — preview

- Added optional donations through Lava: links in the README, GitHub, popup, and manager.
- A small reminder appears in Telegram, the popup, and the manager after every 20 successfully saved files. It does not interrupt the queue or open pages automatically; dismissal lasts until the next threshold, and a setting can disable reminders entirely.
- The counter is stored locally, separately from history, and excludes errors, cancellations, and skips. Multiple accumulated thresholds are combined into one reminder.
- English is now the default language for new installations; Russian and the browser language are available in settings. Existing language selections are preserved.

## 0.2.0 — preview

Added batch attachment selection, saving to a chosen folder, and a separate download manager.

- Up to 200 attachments discovered on the current page, a type filter, and selection of listed album items. Refresh the list after scrolling manually; there is no automatic export of the channel's entire history.
- One folder selection per batch and sequential writes. Collision policies: keep both, skip, or explicitly enable overwrite. Safe naming options: original name, message ID + name, or number + name.
- A manager with filename search, type/status/batch filters, page sizes of 25/50/100, and selection of up to 200 records. Bulk cancellation and retry, a separate “Skipped” status, and the actual filename after collision handling.
- Retrying a batch opens Telegram and requires a new folder selection. If the tab is lost, an individual retry opens the original message when a link is available; bulk retry reports accepted and rejected requests.
- Summaries are calculated from retained history: a maximum of 500 terminal records and 30 days. The popup shows up to five active and five recent records; the full list is available in the manager.
- The extension does not store file/folder handles or folder paths. RU/EN and both themes are available in the manager and selection panel.
- The QA script distinguishes a proven match (`0`), a detected error (`1`), and an inconclusive result (`2`). For renamed copies, `--expected` assigns one reference sample to all input files in the run.

The native folder picker and new batch scenarios in real Telegram await owner verification. Previous live results for individual downloads do not prove the new functionality. Checks for missing formats, large files, and Yandex Browser also remain open; see the [compatibility matrix](docs/compatibility.md) and [manual checklist](docs/manual-testing.md).

## 0.1.0 — preview

The first individual download flow for Telegram Web A/K: attachment buttons, streaming writes, a local queue, cancellation, history, retry, RU/EN, and themes. Added build identification, local diagnostics, and sample verification tools. Live results and their limitations are recorded in the [compatibility matrix](docs/compatibility.md).
