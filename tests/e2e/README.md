# Testing the built extension

```sh
npm run build
npx playwright install chromium
npm run test:e2e
```

The tests load `.output/chrome-mv3` into a separate temporary Chromium profile. They use the built extension's real MAIN/ISOLATED content scripts, service worker, IndexedDB, and popup. The profile is deleted after each test; the personal browser and Telegram account are not used.

Playwright intercepts `https://web.telegram.org/a/` and `/k/` and replaces them with custom synthetic fixtures. For A, a real Web Worker runs a reproduction of the verified Telegram protocol. For K, the fixture provides managers with an exact chunk-reading contract. Other requests to Telegram are blocked.

File selection is replaced with a fixture function: it returns a real OPFS `FileSystemFileHandle`. Writer creation, writing, `close`/`abort`, reading the result, and SHA-256 are handled by the browser. This tests the browser writer and component connections; it is **not a test of the native file picker** or **a live download from Telegram**.

Scenarios in `extension.spec.ts`:

1. Web A: unplayed audio, a real Worker bridge, a tail after 512 KiB, exact SHA-256.
2. Web K: MAIN → ISOLATED → background → popup, the complete file and exact SHA-256; history is preserved after the source tab closes.
3. Two user selections become a sequential queue; closing the popup does not interrupt writing.
4. Cancellation from the popup after the first chunk causes an abort; the partial file is not marked as saved.
5. The MV3 worker is actually stopped through Chrome DevTools `ServiceWorker.stopWorker`. After it is started through the popup, the status of the still-running writer is restored; chunks already received are not read again.
6. Web A with a CSP set through `<meta>` that prohibits JavaScript `eval`: connection, commands, and saving work after the policy is applied. The fixture uses external scripts from its own origin. This reproduces the loading order of [Telegram Web A](https://web.telegram.org/a/), where the content script executes before the CSP and command validation happens later.
7. After `history.pushState` in connected Web A, the session is preserved and the complete file is downloaded. Real `chrome.tabs.onUpdated` events are recorded in a test attachment.
8. After `location.hash` changes in connected Web A, the session is also preserved; changing chats within the SPA is not considered closure of the source page.

Scenarios in `failures.spec.ts`:

9. The writer rejects the second write (simulating a full disk): reading stops, the writer is aborted, the file on disk is empty, and the popup and page show the `disk_error` code. Diagnostic text contains no file name or links.
10. The writer rejects finalization after all chunks have transferred: the same result, with no false “Saved” status.
11. The source tab closes during transfer: the task is “Interrupted” with code `interrupted`, and the file is empty.
12. The source tab reloads during transfer: the same behavior through a new page session.
13. The popup and `version_name` in the manifest show the same build identifier.

Disk errors are simulated by wrapping the real OPFS writer; the owner's disk is not filled.

Scenarios in `batch.spec.ts` test selecting multiple attachments into one OPFS folder and manager behavior: exact SHA-256 hashes and the final incomplete chunk, task sequencing, saving after the panel closes, keep-both with identical names, skip without reading bytes, explicit overwrite and name templates, bulk cancellation, partial failure without losing other files, retrying only the failed item with a new folder selection, and reloading the source tab. A separate scenario uses the Web A Worker protocol. The directory picker is replaced, but its invocation during an active user gesture is verified; actual writing uses the browser's OPFS. Screenshots of the manager in EN/light and RU/dark, and of the panel, are saved in `test-results/` for visual inspection. This does not confirm that the native folder dialog works in Telegram.

The profile, Playwright traces, and results are stored outside the source tree or in the ignored `test-results/` directory. A trace is saved on failure. Live A/K, Chrome/Yandex, the native picker, real private/protected channels, and large files are tested separately using the manual matrix.

Harness references: [Playwright Chrome extensions](https://playwright.dev/docs/chrome-extensions), [Chrome DevTools ServiceWorker protocol](https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/).
