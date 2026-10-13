# Privacy Policy

Last updated: October 13, 2026

Telegram All Downloader is a free, open-source browser extension that saves selected Telegram Web message attachments to your device. It works with your existing Telegram session. The extension has no media server, analytics, advertising SDK, or separate user account.

## Telegram data and downloads

To recognize attachments and save the ones you choose, the extension processes attachment data available in your current Telegram Web session: account, chat, message and file identifiers, filenames, media types, MIME types, sizes and message links. Attachment metadata may be held in page memory while the extension identifies available files. Internal parameters needed to access a file stay in the Telegram page context. The extension does not copy your Telegram authorization keys, passwords or sign-in codes.

Media bytes are retrieved through the current Telegram client and written to the file or folder you select. The extension does not upload media or download metadata to the developer or another media service. Telegram's own network requests and data handling remain subject to Telegram's policies.

The extension does not receive general access to all your local files. You choose a destination through the browser's system file or folder dialog. Folder downloads request read and write access to that folder so the extension can check conflicting names and save selected attachments. The default conflict policy keeps both files; overwriting requires your explicit choice.

File and folder handles are held in page memory for the queue. The extension does not persist these handles, absolute paths or folder names in IndexedDB, settings or diagnostics. After closing or reloading the source Telegram page, retrying requires you to choose a destination again. The browser manages file-picker permissions separately from the extension's storage.

## Local settings and history

Settings are stored in `chrome.storage.local`. IndexedDB stores the queue, download history, page connection state and the donation reminder counter. None of this extension data is synced to a cloud service or automatically sent to the developer.

Download records can include the original filename, the final saved filename, attachment identifiers and message links, file type and size, progress, result, attempt count and timestamps. Queue and connection records also include browser tab IDs and random page session IDs. A batch has a random identifier and a generic label with its creation time; that label does not contain the chat name or destination folder path.

History is enabled by default. You can turn it off or clear completed history in Settings; doing so does not delete saved files. Automatic cleanup limits finished, failed, cancelled, interrupted and skipped records to 500 entries and 30 days. Active jobs remain until their state is resolved. Manager summaries describe only the records still retained. The extension does not apply its own encryption to locally stored history.

## Optional donation reminders

A separate local counter records the number of successfully saved files and the last dismissed reminder milestone. It starts when a version with reminders is installed, contains no file details, and remains when download history is cleared or disabled. Failed, cancelled and skipped downloads do not count.

A nonblocking invitation to buy the developer a coffee appears after every 20 successful saves. You can dismiss it until the next milestone or disable reminders in Settings. Accumulated reminders are combined into one. Every feature remains free regardless of whether you donate.

Support and donation links open only when you click them. Donations use [Lava](https://app.lava.top/294798508); its page is not loaded before you click. Donation links do not include download details, and the extension does not transmit the counter or history to Lava. External sites, including Lava and GitHub, apply their own privacy policies and may process information when you visit them. The extension does not handle payment details.

## Diagnostics and support

For a failed download, the popup or manager can display a diagnostic report. The full report is visible before copying and is copied to the clipboard only when you click the copy button. It includes the extension version and build, browser and operating system, Telegram client A/K, attachment type, MIME type, rounded size, state, error code, transfer percentage and attempt number.

The report excludes filenames, message links and text, and account, chat, message and session identifiers. It is not sent automatically: you decide whether and where to paste it. If you submit an issue on GitHub, the information you choose to include is handled by GitHub and may be public. Do not include private messages or account credentials.

## Permissions and limited use

Access to `https://web.telegram.org/*` is used to add download controls and work with attachments in Telegram Web A and K. The `storage` permission saves your settings locally. The extension does not request `cookies`, `debugger` or `<all_urls>`, and it does not load remotely hosted executable code.

Telegram All Downloader's use of user data complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including its Limited Use requirements. Data is used for the disclosed attachment-saving features and their operation. It is not sold, used for personalized advertising or used to determine creditworthiness.

## Contact and changes

The extension is maintained by [alex100cent](https://github.com/alex100cent). For privacy questions, use the project's [GitHub issue tracker](https://github.com/alex100cent/telegram-all-downloader/issues) without posting sensitive data. Updates to this policy will be published here with a revised date.
