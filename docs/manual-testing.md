# Testing with real Telegram

Use your own test attachments and known reference files. First install the unpacked extension, reload Telegram, and disable other downloader extensions for the comparison. A separate [short checklist](yandex-checklist.md) is available for Yandex Browser.

## Build

Before each test series, record the build: popup/manager → Settings → “About this build”, or the version on the extensions page — `0.2.0 (<build>)`.

- `35536af` — built from a commit without local changes.
- `35536af-modified.1a2b3c4d` — changes have been added to the commit; the hash distinguishes different sets of changes. Do not report this build as a clean commit.
- `unversioned` — Git information was unavailable during the build.

A CI build has a “CI run #N” label in the same section. `npm run build` and `npm run zip` rebuild `.output/chrome-mv3`: finish building before reloading the extension, and do not rebuild it during live testing.

## For each Web A/K client and browser

1. Photo, video, MP3/podcast, voice message, round video message, MP4 animation, PDF, unknown file, WebP/TGS/WebM sticker: save each, then compare its format and bytes with a reference available in Telegram.
2. Check a public channel, a private channel, and a separate protected channel. Private does not mean protected.
3. An unplayed file, a partially played file, two audio files with the same names/durations, and an adjacent prefetched attachment: save exactly the selected document without changing the current player.
4. An individual album item and the viewer. If the viewer does not provide an exact association, check the available button in the message and record the limitation.
5. Two quick clicks, different tabs with the same file, different chats/accounts: one active writer, correct deduplication and identity.
6. Cancellation during reading, cancellation in the picker, disk error, offline mode, tab reload/closure, extension worker shutdown: no false success or hidden duplication.
7. Files of 100 MiB, 1 GiB, and about 2 GiB; about 4 GiB if available. Record peak memory across the entire path, actual size, and hash. Check free disk space before large tests.
8. Popup in light/dark themes, RU/EN, keyboard navigation, clearing/disabling history. History is removed; the downloaded file remains.
9. Leave the system save dialog open for a minute: after confirmation, the same file should be saved even if Telegram has cleared its local message index. Check cancellation while metadata is requested again.
10. The button returns after the message is rendered again; during an active download, the new button controls the existing task and does not create a second writer.

Reload Telegram after disabling/enabling or updating the extension: Web A needs the hook before its API worker is created.

The Telegram tab must be active when testing the native picker. Switching to another tab before the dialog opens may cancel it; that does not test file transfer.

## Batches and folders: manual testing for 0.2.0

The scenarios below still require testing by the owner in real Web A and K through the system folder picker. Synthetic E2E tests with OPFS do not confirm the native dialog or behavior with real attachments. Use a separate test folder and your own files; its contents will be needed to test name collisions.

1. **Selection and refresh.** Open “Download several” from Telegram and through the popup/manager. If multiple tabs are connected, select the intended one. Check types, individual items, and the button for selecting displayed album items. Scroll the chat manually and refresh the list; do not treat the list of up to 200 attachments as the entire channel. Make sure the type filter in the panel preserves already selected hidden files and counts the total correctly.
2. **One folder, exact files.** Select several different attachments, keep their original names, and choose “Keep both”. Choose a folder in one action. Check sequential writing, actual sizes, and the SHA-256 of each file. Close the panel, popup, and manager during transfer: the queue continues while Telegram remains open.
3. **Matching names.** Prepare an existing file and two selected attachments with the same name. “Keep both” creates distinct names and preserves the original file. “Skip existing” leaves the existing file unchanged, gives a “Skipped” status, and does not report it as saved.
4. **Overwrite and names.** Using test files only, explicitly select “Overwrite”: a successful write replaces the contents. Separately check failure/cancellation before finalization — the previous bytes remain and there is no false success. Check ID/number + name templates, Unicode, and long names; the actual name in the manager must match the name on disk.
5. **Manager.** Search by name, type/status/batch filters, pages of 25/50/100, selection across multiple pages up to 200 entries. Changing the filter clears the selection. Bulk cancellation cancels only selected queued/downloading files; cancellation is unavailable during finalization. RU/EN, both themes, Tab/Space/Escape, including two identical names in the panel.
6. **Retry.** Produce a failure and a cancellation, select them in the manager, and click retry. Check that the new transfer requires another click and folder selection in Telegram. Successful and skipped entries are not retried by the bulk button. Compare accepted/rejected with the pickers actually opened and the results of the new queue.
7. **Losing the tab or dialog.** Reload/close the source Telegram tab during a batch: dependent tasks are interrupted and files are not marked as saved. An individual retry opens the source message if a link is available. For a rejected bulk retry, restore the source manually. Cancel the system folder dialog: no new tasks are created; the next click works.
8. **History and summaries.** Compare the selected batch's counters with its saved history entries, including “Skipped”. Clear or disable history: completed entries disappear and summaries change; the active queue and files on disk remain. After a reload, retry still requires choosing a destination — the folder is not restored automatically.

## Samples and verification

Synthetic samples contain no personal data and are reproducible. The generator writes them and a `manifest.json` with sizes and SHA-256 hashes:

```sh
node scripts/qa-samples.ts generate ~/tad-samples --media
node scripts/qa-samples.ts generate ~/tad-samples-large --large=100m,1g,2g
```

- Without flags: PDF, ZIP, TXT, a file without an extension, an unknown `.tadqa` type, and a file with a Unicode name.
- `--media` (requires FFmpeg): FLAC, M4A, GIF, MP4 animation, WebM. `--long-video` adds an 11-minute MP4 (over 100 MiB).
- `--large`: `100m`, `1g`, `2g`, `4g`. Sizes are not multiples of 512 KiB, so the final chunk is incomplete. `2g` is below Telegram's 2000 MiB limit; `4g` requires Telegram Premium (4000 MiB limit).

Documents and media sent **as uncompressed files** must match the samples byte for byte. Telegram may transform photos, GIFs, and videos sent as media: GIF becomes an MP4 animation. For these, compare the A and K copies with each other and check the format, rather than comparing with the original before upload. Send TGS and WebM stickers from any public sticker pack.

Verify downloaded files (folders or individual files):

```sh
node scripts/qa-samples.ts verify ~/tad-samples/manifest.json ~/Downloads/tad-a ~/Downloads/tad-k --decode
```

The command prints the size, SHA-256, detected format, and result: `PASS`, `FAIL`, or `INCONCLUSIVE`. A known sample must match both size and hash: even a file with a different size receives `FAIL` rather than being skipped. Additional checks cover TGS (gzip + Lottie with `tgs=1`), full FFmpeg decoding with `--decode`, and groups of identical A/K copies.

Exit codes:

- `0` — all selected files matched known references in size and SHA-256; requested additional checks also succeeded.
- `1` — a mismatch with a known reference or a format/decoding verification error was found.
- `2` — the result is unproven: an unknown file without an exact manifest match, an empty file set, an unavailable additional check, or invalid arguments.

For a renamed file, explicitly specify the **sample name from the manifest** using `--expected=<sample-name>`. This reference applies **to all input files in that run**; do not pass copies of different source samples together. Example for two renamed copies of one sample:

```sh
node scripts/qa-samples.ts verify ~/tad-samples/manifest.json ~/Downloads/copy-a.pdf ~/Downloads/copy-k.pdf --expected=tad-sample-document.pdf
```

`tad-sample-document.pdf` is the generator's PDF; for another sample, use the exact `file` value from your `manifest.json`. Without an explicit reference, a renamed file may be identified by an exact match of size and SHA-256; a nonmatching file with an unknown name remains `INCONCLUSIVE`. Matching A/K copies alone do not prove completeness: both may be truncated identically. Media transformed by Telegram needs a reference for the result available in Telegram, rather than the original before transformation.

On macOS, verify an individual file with `shasum -a 256 /path/to/file`. Include the comparison result in the report, but no private content, channel names, or links.

## Large files and memory

1. Check free disk space: `2g` needs about 4.2 GB (the sample and downloaded copy).
2. Open the browser task manager (Chrome: Shift+Esc). Find the Telegram tab processes and, for Web K, the `web.telegram.org` `Shared Worker` and `Service Worker`: bytes pass through them. Record their process IDs.
3. Start measurement before clicking ↓ and stop it with Ctrl+C after “Saved”:

   ```sh
   node scripts/qa-samples.ts memory 1234,5678
   ```

   The command sums the RSS of the specified processes every 0.5 seconds and prints the baseline, peak, and increase. The increase should not grow in proportion to file size. Also record “Memory footprint” from the task manager at the peak for comparison.

4. Scroll the chat and open the popup during transfer: the interface should remain responsive. Separately cancel a download halfway through and check that the memory increase subsides and the popup shows the actual result.
5. Record: size, SHA-256 (match/no match), duration, peak memory and increase, A/K, browser, and build.

Report the largest tested size, the executor's 4 GiB limit, and the separate Web A photo path (32 MiB) individually.

## Bug report

When a download fails, the popup shows a clear reason and a stable code (`Code: disk_error`). The “Diagnostics” button opens the text that will be copied: version and build, browser and OS, client, type/MIME, rounded size, state, code, and transfer percentage. It contains no file names, links, or identifiers. You can attach this text to an [issue](https://github.com/alex100cent/telegram-all-downloader/issues/new).
