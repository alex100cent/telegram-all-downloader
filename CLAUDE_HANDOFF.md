# Telegram All Downloader: Claude Code Handoff

Updated: October 9, 2026.

## Progress update — October 11, 2026

Preview 0.2.0 now implements QA-5 and the UX-1/UX-2/UX-3 workflows: selection of up to 200 discovered attachments (including discovered album items), type filters, a folder picker, safe naming templates, keep-both/skip/explicit-overwrite policies, and a separate download manager with filters, pagination, batch summaries, cancellation and retry. The owner explicitly requested these features before their manual acceptance pass. Preserve the existing single-file workflow and shared sequential executor.

The QA verifier now distinguishes PASS (exit 0), FAIL (exit 1), and INCONCLUSIVE (exit 2), and accepts `--expected=<manifest filename>` for renamed originals. Build fingerprints include every packaged `public/` asset. See the current README, changelog, compatibility report and manual checklist for implementation details and current test counts. The baseline and original task definitions below remain historical reference; do not rebuild completed features.

Live QA-1/QA-2/QA-3 gaps and the owner's Yandex check remain pending. Native directory selection and real Telegram batch downloads still need owner verification. UX-4 completed-media deduplication, Windows acceptance, remaining release materials and Priority 2 remain future work. Folder handles never leave the source page or persist across a reload; retry requires a fresh user gesture and destination choice. History summaries cover retained records only.

## Objective and starting point

Continue the existing browser extension. The product goal is convenient, reliable downloading of the exact attachment selected in Telegram Web, including content in private or protected channels that the signed-in user can access.

The MVP is implemented and published as a **preview**, not a fully validated release. The owner explicitly approved publishing with the remaining verification gaps documented. Continue from this baseline; do not rebuild the project or treat completed infrastructure as pending work.

- Repository: [alex100cent/telegram-all-downloader](https://github.com/alex100cent/telegram-all-downloader).
- Published baseline: `main`, commit `35536afe02c601d671b5f0f034d38697dc57ae27`.
- [Baseline CI](https://github.com/alex100cent/telegram-all-downloader/actions/runs/37916142648) passed and contains an extension ZIP artifact. Artifacts expire; the project can also build the ZIP locally.
- Version: `0.1.0`. Stack: WXT, TypeScript, React, Manifest V3, npm, Node.js 22.
- Free, open source, MIT-licensed, with optional donations. No subscription, download quota, separate extension account, media backend, or analytics.
- Initial platform: Chrome and Yandex Browser on macOS; both Telegram Web A and K matter. The owner will test Yandex separately. Windows is later work.
- MVP interaction: one attachment per action. A queue of individually selected downloads already exists. Bulk selection, history scanning, stories, and avatars are later features.
- Communicate with the owner in Russian; write project files, including code, documentation, and reports, in English. Preserve explicit localizations and multilingual test fixtures. Follow [AGENTS.md](AGENTS.md) and keep code comments minimal and useful.

Read [README.md](README.md), [docs/compatibility.md](docs/compatibility.md), and [docs/manual-testing.md](docs/manual-testing.md) first. [PLAN.md](PLAN.md) contains the original requirements and longer roadmap; some sections describe alternatives that were not implemented. Use the code and compatibility report for current behavior.

## What already works

Implemented: separate A/K adapters, attachment buttons, streaming file executor, sequential global queue, IndexedDB history and reconciliation, popup progress/cancel/retry, source links, RU/EN, light/dark themes, configurable donation link, packaging, licensing notices, and CI.

Verified at the published baseline:

- **127 unit/integration tests and 8 E2E scenarios** passed locally and in GitHub Actions.
- Real Chrome `155.0.8059.40` on macOS: **15 successful saves**, eight through A and seven through K, from an owner-provided private channel with content protection enabled.
- Six attachment types: MP3 audio, JPEG photo, MP4 video, Ogg/Opus voice, MP4 round video, and static WebP sticker.
- **Seven A/K file pairs matched in size and SHA-256**, including a long MP3. The additional eighth unique sample was an A-only photo.
- All eight unique samples fully decoded without errors. Hash-equivalent copies were not decoded twice.
- Largest real sample: **29,109,155 bytes**, approximately **27.8 MiB**. The long audio completed after closing the popup.
- Live cancellation was verified in K. The UI reported cancellation; the native picker left a zero-byte placeholder, which was not counted as a successful download.

These results do not establish every format, every browser, or large-file compatibility. Matching two adapters is useful evidence, but independent server-original hashes were unavailable. E2E uses synthetic Telegram pages and real OPFS writers with a substituted picker; it does not test production Telegram or the native save dialog.

## Architecture and invariants to preserve

| Area                                    | Main locations                                                        |
| --------------------------------------- | --------------------------------------------------------------------- |
| Web A protocol, metadata, discovery     | `src/adapters/telegram-a/`, `docs/architecture/web-a.md`              |
| Web K runtime and attachment resolution | `src/adapters/telegram-k/index.ts`, `docs/architecture/web-k.md`      |
| Page controls, picker, source ownership | `src/page/controller.ts`, `entrypoints/telegram-main.content.ts`      |
| Validated message bridge                | `src/bridge/`, `entrypoints/telegram.content.ts`                      |
| Queue, coordinator, history             | `entrypoints/background.ts`, `src/storage/database.ts`, `src/domain/` |
| Stream validation and disk writes       | `src/downloads/stream.ts`, `docs/architecture/transport.md`           |
| Popup and settings                      | `src/ui/`, `src/i18n/`, `src/config.ts`                               |
| Regression coverage                     | `tests/`, `tests/e2e/`, `src/ui/App.test.ts`                          |

Preserve these properties when adding features:

1. Use the existing Telegram session. Do not copy authentication keys, introduce another login, or bundle Telegram client source into this MIT project.
2. Resolve an exact account, peer, message, media ID, and variant. Never substitute a neighboring audio track, preview, thumbnail, or guessed DOM URL.
3. File System Access runs in the Telegram page's MAIN context. The picker opens synchronously from a trusted user action. Bytes, handles, and writers stay in that page; extension messaging carries validated metadata and commands.
4. Documents are read in chunks of at most 512 KiB with backpressure. The executor's 4 GiB ceiling is a technical limit, not a verified Telegram download size. Web A photos use a separate whole-response path with a 32 MiB limit; this does not cap Telegram's internal allocation before it responds.
5. Only a successful writer `close()` means saved. Preserve cancellation, abort, finalization, bounded retries, and single-writer ownership. A failure or interruption must never become a false success.
6. Closing the popup is supported. Closing/reloading the source tab interrupts its transfers. SPA hash/pushState navigation alone does not invalidate a live session. Do not release an unknown active writer solely because a probe timed out.
7. Preserve the recent regressions: MAIN-context Zod uses per-parse `jitless: true`; buttons recover after DOM replacement; A metadata eviction triggers an exact revalidation; stale RPC replies cannot overwrite later edits/deletions; account changes invalidate old sources; cancellation reaches asynchronous validation.
8. Keep the current narrow permissions: `storage` and access to `https://web.telegram.org/*`. Additional permissions need a concrete feature reason. No remote code, telemetry, media server, or automatic diagnostic uploads.
9. Preserve original bytes and formats. Telegram animations may be MP4; voice may be Ogg; TGS must remain its original gzip-based file. Conversion is a separate future feature.

## Working procedure

Start by checking the current checkout; the baseline above is a reference, not an instruction to reset newer work.

```sh
git status --short
git log -5 --oneline
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run zip
```

Run the full baseline once when establishing the environment. During development, use focused regression tests, then the relevant full checks before delivery. Do not repeatedly rerun unchanged passing checks or rebuild while a live test is using an installed build.

`npm run zip` also rebuilds `.output/chrome-mv3`. Finish and freeze the build before asking the owner to reload the unpacked extension. Then reload Telegram: A requires its hook before the API worker starts. The Telegram tab must be active for native picker testing. If the available automation cannot open the browser's extension-management page, let the owner perform that step; use permitted tools and report the exact limitation.

The repository's push URL was configured to use the owner's existing SSH access. HTTPS OAuth could not push the CI workflow without the `workflow` scope; SSH publishing succeeded. Check the actual Git configuration in a new environment rather than assuming it has the same credentials.

Use a dedicated, owner-authorized test channel and non-sensitive samples. The owner offered to provide missing sample types. Keep private media, channel identifiers, original filenames, session data, and browser profiles out of commits, CI fixtures, and issue reports. Do not copy the ignored local `Telegram-Downloader/` implementation or assets.

## Priority 0: finish MVP verification and resolve findings

Work through the tasks below before claiming complete MVP compatibility or moving to the larger feature backlog. If a test requires an unavailable sample, browser, or owner action, mark that specific case pending and continue independent work. Publication of the preview was approved; it did not close these verification tasks.

### QA-1 — Complete the attachment format matrix

**Scope:** test both A and K with PDF, ZIP, an arbitrary/unknown file type, a file without an extension, GIF/MP4 animation, animated TGS sticker, and WebM video sticker. Add non-MP3 audio samples such as M4A or FLAC where available. Test media sent as a document as well as normal media messages.

**Done when:**

- [ ] Each case saves the complete intended file without playing it first.
- [ ] Original format, MIME handling, safe filename, length, and integrity are checked; MP4 is not mislabeled as GIF and TGS is not silently decompressed or converted.
- [ ] Known originals are compared by hash where valid. For Telegram-transcoded media, compare the same Telegram representation, not the pre-upload source.
- [ ] Results and any failures are recorded per client in `docs/compatibility.md`; failures get a minimal anonymized regression before the fix.

### QA-2 — Verify real large files and memory behavior

**Scope:** progress from approximately 100 MiB to 1 GiB and 2 GiB; test near 4 GiB only if an appropriate sample and disk space are available. Include a long video and a large arbitrary document. Do not increase the advertised supported size from synthetic tests alone.

**Done when:**

- [ ] Both clients save complete files with exact sizes and valid hashes, including the final partial chunk.
- [ ] Peak memory is measured across the real Telegram/transport/writer path, not only the extension worker or pure executor.
- [ ] UI responsiveness and backpressure remain acceptable; no full-file Blob accumulation is introduced for documents.
- [ ] Cancellation during a long read/write releases resources, and the UI reports the actual result.
- [ ] The report distinguishes the largest proven size, the executor limit, and the special photo path.

### QA-3 — Complete live identity and lifecycle checks

**Scope:** prioritize cases still supported only by fixtures or partially exercised live.

- [ ] Same-name/same-duration audio, neighboring prefetch, cached media, and unplayed/partially played files: save the selected media without changing the player.
- [ ] Public, ordinary private, and protected chats have separate results. Protected-private success is not a blanket result for every access mode.
- [ ] Individual album entries and the media viewer resolve correctly; ambiguous viewer context gives a clear fallback to the original message.
- [ ] Double clicks, two tabs, duplicate selections, account changes, and DOM recycling never mix identities or create a second writer for the same active job.
- [ ] Observe a real queued task while another is still transferring, then verify sequential completion. The previous two-file live attempt did not establish actual overlap in the queue.
- [ ] Verify cancellation in A, native-picker cancellation, delayed picker confirmation, metadata eviction, and revalidation cancellation.
- [ ] Verify offline errors/retry, source-tab reload/closure, browser restart, and extension-worker suspension without false success or duplicate transfers.
- [ ] Recheck same-document navigation during a transfer. Confirm real document replacement remains an interruption.
- [ ] Exercise controlled writer failures and finalization behavior; simulate disk errors safely rather than filling the owner's disk.

**Done when:** each result has a documented outcome, any issue has a meaningful regression, and retry/interruption behavior is understandable in the UI.

### QA-4 — Collect Yandex Browser results on macOS

The owner will perform this testing; Yandex was not installed during the initial work. Provide a short reproducible checklist and request the browser version, extension build, client, sample category, and observed result.

**Done when:** A/K installation, native picker, core formats, a large file, cancellation, and source-tab lifecycle have explicit results. Fix browser-specific failures and retain an honest unsupported/pending status for unverified cases. Do not treat passing Chromium fixtures as a Yandex result.

### QA-5 — Improve build identification and maintain accurate documentation

**Scope:** make subsequent testing and bug reports easier without collecting private data.

- [ ] Show the installed version and a useful build identifier in settings/help. It must identify the tested artifact; do not label a modified local build as an unchanged clean commit.
- [ ] Provide an understandable failure reason and a stable error code where useful. If adding copyable diagnostics, preview the fields and exclude filenames, private URLs, message text, account/channel IDs, and session data.
- [ ] Reconcile stale status text: `docs/architecture/transport.md` still mentions 106 tests and no confirmed live downloads; the compatibility report has the newer results.
- [ ] Keep README claims, compatibility evidence, architecture descriptions, release notes, and test counts consistent. Prefer linking to the maintained report over duplicating counts everywhere.

**Done when:** a tester can identify the running build and report a failure without sharing private content. Documentation accurately separates implemented behavior, fixture coverage, and live verification.

## Priority 1: usability and broader platform support

These tasks extend the existing adapters, queue, and writer. Do not add a competing download pipeline. Start after the relevant MVP acceptance gaps are resolved; prepare independent design/release materials while waiting for external test inputs.

| ID         | Task                                                                                                    | Dependencies                                   | Acceptance criteria                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-1       | Select multiple discovered attachments and individual/full albums; add type filters and a batch preview | Relevant QA-1/QA-3 cases                       | Selection stays attached to exact identities. Show count, known byte total, and unknown sizes separately. State that the list contains discovered attachments, not the entire channel. No hidden history scan.                                                                                                          |
| UX-2       | Choose one destination folder for a batch; add naming templates and collision handling                  | UX-1                                           | Obtain directory access through a user action; check permission before execution. Reuse the streaming writer and queue. Sanitize every path component; define keep-both/skip/overwrite behavior without silent overwrites. One failure does not discard successful files.                                               |
| UX-3       | Add a full download-manager view                                                                        | UX-1/UX-2                                      | Queue and history remain usable at larger volumes, with filters, per-item/batch cancellation, retry of failed items, and clear partial-success summaries. Closing the view does not stop transfers. Preserve local history controls.                                                                                    |
| UX-4       | Add optional completed-media deduplication                                                              | UX-1/UX-2                                      | Reuse canonical account/peer/message/media/variant identity. Keep active-job deduplication. Let the user deliberately save again; distinguish a history record from proof that a local file still exists.                                                                                                               |
| PLATFORM-1 | Validate Chrome and Yandex on Windows                                                                   | Stable MVP behavior; can run alongside UX work | Repeat the relevant A/K matrix, including actual picker/permission behavior, reserved names, Unicode, long paths, collision handling, cancellation, and large files. Publish only measured support.                                                                                                                     |
| RELEASE-1  | Prepare a user-facing release package                                                                   | Accurate QA status                             | Add a changelog, issue template, reproducible versioned ZIP/checksum, and original short demos for install, audio/voice, cancel/retry, and popup. Verify license/privacy/permission text. Configure the optional donation URL only when the owner supplies it. Prepare store materials separately from submitting them. |

A public release can retain explicitly documented limitations, as the owner already chose for the preview. Expanding access, adding subscriptions, or changing the product's free/open-source model is outside this roadmap.

## Priority 2: larger features after the core workflow is reliable

| ID        | Task                                                              | Dependencies                                             | Acceptance criteria                                                                                                                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HISTORY-1 | Research then implement bounded history discovery                 | UX-1/UX-2                                                | Verify pagination separately for A and K. Add a date/message boundary, checkpoint, progress, stop control, and reason for stopping. Report incomplete coverage explicitly. Separate discovery/selection from downloading. If using autoscroll, disclose that it controls the current tab and make it interruptible. |
| MEDIA-1   | Add stories and avatars                                           | Stable MVP; independent of full history scanning         | Use separate resolvers and explicit source identities, reusing queue/storage/write components where appropriate. Test both clients and actual formats. Do not fabricate message identities or infer a full-resolution original from a thumbnail.                                                                    |
| ARCHIVE-1 | Export selected media as a streaming ZIP with a manifest          | UX-1/UX-2; HISTORY-1 for history exports                 | Bound memory, preserve unique safe paths, support ZIP64 when needed, and record successful/failed/skipped entries. Test cancellation, partial failures, archive integrity, and large output. Review any added dependency's license and distribution notices.                                                        |
| RESUME-1  | Research pause/resume, restart recovery, and optional concurrency | Proven large-file behavior and stable transfer semantics | Resume only when source identity, destination access, and existing ranges can be verified. Otherwise offer a full restart. Define queue behavior explicitly and prevent duplicate writers. Do not promise downloading after the Telegram tab closes without a separately validated architecture.                    |
| CONVERT-1 | Optional media conversion                                         | Stable original-file downloads                           | Make conversion an explicit separate operation with a clear cost/format choice. Preserve the original file and actual MIME/extension. Do not make conversion a prerequisite for downloading.                                                                                                                        |

## Delivery checklist for each task

- [ ] Extend the existing code with a focused change and update the appropriate documentation.
- [ ] Add meaningful regressions for new behavior or reproduced failures; do not mistake synthetic coverage for live compatibility.
- [ ] Run applicable type/lint/unit/build/E2E checks and record any unavailable live checks accurately.
- [ ] For live evidence, record date, OS/browser, extension build, A/K, access mode, sample category/size, method, integrity result, and limitation without private identifiers.
- [ ] Summarize what changed, what was tested, and what remains pending. Keep unrelated work moving when one test needs owner input.
- [ ] Keep the working tree reviewable and follow the owner's instructions for committing/pushing. Do not force-push or commit personal test artifacts.

Suggested first session: inspect the baseline, fix the stale documentation and build-identification gap, obtain the missing test samples, then run QA-1 and QA-2 before beginning batch downloads.
