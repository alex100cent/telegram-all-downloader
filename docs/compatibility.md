# Compatibility and evidence

Automated verification date: October 11, 2026. Extension version: 0.2.0 preview. The live results below refer to the 0.1.0 single-file workflow tested on October 9.

Automated verification: TypeScript and ESLint passed without errors; **219 unit/integration tests and 22 E2E scenarios passed**. The built MV3 extension was tested in Chromium 156.0.8078.4: both adapters, exact SHA-256, queueing, cancellation, background process recovery, a late meta CSP without unsafe-eval, and preserving the connection after `history.pushState`/`location.hash` changes. In the last two scenarios, a synthetic file is successfully saved after navigation within Web A. Separate scenarios simulate write and writer finalization failures, closing and reloading the source tab during transfer, and checking that the build identifier matches in the popup and manifest. E2E uses its own Telegram pages and a real OPFS writer; the native picker is replaced with a test function. Details: [E2E](../tests/e2e/README.md).

Web A regression tests cover restoring the button after rendering, current attachment markup, loss of local metadata, late RPC responses when a message is replaced/deleted, and cancellation of source revalidation. These checks do not replace saving a real file through the system dialog.

| Environment      | Protocol research                            | Automated fixtures                                           | Live downloads                             |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Web A / Chromium | Official source + production bundle          | Worker RPC, identity, formats, cancellation, ranges          | 8 samples saved; 7 SHA-256 pairs matched K |
| Web K / Chromium | Official source + production bundle          | Runtime RPC, identity, formats, cancellation, ranges         | 7 samples saved; cancellation tested       |
| Chrome macOS     | 155.0.8059.40 installed                      | Separate test profile                                        | Web A/K: system picker and writing tested  |
| Yandex macOS     | Not installed in the development environment | Shared Chromium contracts; this does not test Yandex Browser | The user will test it independently        |

Changing chats within the SPA through hash/pushState preserves the original document and extension session. An actual reload or document replacement, leaving supported Telegram Web, or closing the tab interrupts the page-dependent path. A single `chrome.tabs.onUpdated` event with status `loading` is not enough to consider the session lost.

Testing the standalone executor with a synthetic 1 GiB stream confirms bounded chunk sizes; it is not a Telegram network test, a measurement of Telegram's total memory usage, or a test of writing 1 GiB to disk.

## Build identification

The extension version in `chrome://extensions` and the popup's “Settings → About this build” section show the build: `0.2.0 (<commit>)` for a build from a commit without changes, `0.2.0 (<commit>-modified.<hash>)` for a build with changes outside the commit, and `unversioned` without Git information. Changes to source documentation and tests do not affect the identifier. All packaged assets inside `public/` are included regardless of extension or name. CI builds are additionally labeled with the run number. Record this identifier with every live result. The October 9 results predate the identifier; their revision is recorded manually below.

## Live testing of Web A and Web K

On October 9, 2026, real attachments of six types from a private channel with content protection enabled were tested in Chrome 155.0.8059.40 on macOS. The system dialog was used to choose the destination. The extension interface showed `Saved` for **15 tasks: eight in A and seven in K**. Seven samples were saved through both adapters, with one additional photo saved only through A. The files were nonempty and were not modified during verification; size and SHA-256 matched in all seven A/K pairs. The `file` command recognized the formats, and `ffprobe` exited with code 0 for each sample.

All eight unique samples were fully decoded with FFmpeg 7.1.1 to `null` output: the first six from K, and the additional podcast and photo from A. All video and audio streams were selected, including embedded MP3 covers; `-xerror -err_detect explode` was used. Each run exited with code 0 and an empty error log; no decoding errors or truncated frames were reported. Copies from the other adapter with matching sizes and SHA-256 hashes were not decoded again. Images, audio, and video were not exported or played during verification.

| Sample                    | Size, bytes | Detected format and parameters                                      |
| ------------------------- | ----------: | ------------------------------------------------------------------- |
| Audio                     |   2 466 244 | MP3, 60.029388 s, 44.1 kHz, stereo, 320 kbit/s; embedded JPEG cover |
| Photo                     |      29 154 | JPEG, 554 × 554                                                     |
| Video                     |   2 111 861 | MP4, H.264 720 × 1280, AAC stereo, 13.3 s                           |
| Voice message             |      14 967 | Ogg/Opus, 48 kHz, mono, 3.62 s                                      |
| Round video message       |     163 538 | MP4, H.264 300 × 300, AAC mono, 2.34118 s                           |
| Sticker                   |     287 060 | WebP, 960 × 1282                                                    |
| Podcast                   |  29 109 155 | MP3, 718.08 s, 44.1 kHz, stereo, 320 kbit/s; JPEG cover 1500 × 1500 |
| Additional photo (A only) |      26 321 | JPEG, 538 × 371                                                     |

For the first seven rows, sizes and SHA-256 hashes are identical in A and K, including the photo with matching image dimensions of 554 × 554. The additional photo was not saved through K.

During the live podcast download through A, the popup was opened at 16% progress and closed with Escape before completion. The download continued, and the interface then showed `Saved`. Saving the additional photo was also confirmed, but these tasks were not documented as being in the queue at the same time: this test confirms operation after closing the popup, rather than a live queue test. The queue is covered by separate automated E2E scenarios.

A separate audio download in Web K was cancelled with the `Cancel` button during transfer. The interface showed `Cancelled`; an empty 0-byte file created by the system picker remained on disk. This result is not counted as a successful save. Live cancellation in Web A was not tested separately.

The successful Web A series and the seventh Web K download (the podcast) took place after the user confirmed reloading the extension from revision **`3dcd7a9`**, which included A cache fixes. The ZIP distribution was built from the same revision; 127 unit/integration tests and 8 E2E scenarios passed before live testing. ZIP SHA-256: `e4342999429ca38dbead4c3f9124455aee88c2a1c174305c4ae3aa297e9a84a1`. For the preceding six Web K downloads, the exact loaded revision was not recorded; the interface confirmed that the connection survived a chat change with the SPA fix.

The comparison confirms that files obtained through both adapters match. Expected server hashes of the original attachments are unknown: matching A/K copies and full decoding are not an independent verification of byte-for-byte equality with the server original. The largest sample actually saved was **29 109 155 bytes (about 27.76 MiB)**; a live 1 GiB download and memory usage were not tested separately.

Other attachment formats, large files, and Yandex Browser remain untested in a live environment. The required MVP criteria in PLAN.md cannot be considered fully met until the live matrix is completed. For subsequent results, record browser/build, A/K, file type, public/private/protected access, size, expected and actual hash, cancellation behavior, and memory usage. Do not include private chat identifiers, original file names, or file contents in this document.

## Batches and manager in 0.2.0

Implemented features include selection of up to 200 discovered attachments, a type filter and selection of displayed album items, one destination folder, safe name templates, keep-both/skip/explicit overwrite, and a manager with search, filters, pagination, and bulk operations. Nine new E2E tests check a batch of two exact files in Web A (Worker + CSP) and K, a sequential queue, saving after the panel closes, collisions and actual names, skip without reading the file, cancellation, partial failure, retrying only the failed item with a new picker, and page reload. The selection panel and manager were visually checked in EN/light and RU/dark.

Unit/integration tests also check cancellation while waiting for metadata with release of a late source, identity changes before opening the writer, preserving selection when retry is unavailable, keyboard focus with identical names, bounded RPC calls for bulk cancellation, and returning to a message after losing the source page. QA sample verification no longer reports success for a truncated or unknown file; the build fingerprint includes packaged assets.

On October 13, 2026, the owner reported successful manual testing of version 0.2.0. Individual results by format, browser, and file size were not recorded, so this confirmation does not change the detailed matrix below.

Native folder selection, batches with real attachments and albums in Telegram A/K, Yandex Browser, and large files still need itemized results from the [0.2.0 manual checklist](manual-testing.md#batches-and-folders-manual-testing-for-020). OPFS and fixtures do not replace these checks. Manager summaries reflect saved history, rather than a complete archive of downloaded files.

## Awaiting live testing

Status as of October 11, 2026. “Pending” means no live result is available, rather than a known failure. Samples and verification methods are described in the [manual test plan](manual-testing.md); `node scripts/qa-samples.ts generate` creates reproducible synthetic files.

### Formats (QA-1)

| Category                                                  | How to obtain a sample                 | Criterion                                                                    | Web A   | Web K   |
| --------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- | ------- | ------- |
| MP3, JPEG, MP4, Ogg/Opus voice, round video message, WebP | Regular messages                       | See live testing above                                                       | Tested  | Tested  |
| PDF, ZIP, TXT                                             | Generator; send as a file              | SHA-256 matches the sample; ZIP passes `unzip -t`                            | Pending | Pending |
| Unknown type, file without an extension, Unicode name     | Generator; send as a file              | SHA-256 matches the sample; the name does not acquire an unrelated extension | Pending | Pending |
| FLAC, M4A                                                 | Generator; send as music and as a file | SHA-256 matches the sample; full decoding                                    | Pending | Pending |
| GIF                                                       | Generator; send as an animation        | Actual MP4 saved without a `.gif` extension; A and K copies match            | Pending | Pending |
| MP4 animation, WebM video                                 | Generator                              | Format and decoding; sample SHA-256 when sent as a file                      | Pending | Pending |
| TGS sticker                                               | Public sticker pack                    | Original gzip, Lottie `tgs=1`, no decompression; A and K copies match        | Pending | Pending |
| WebM video sticker                                        | Public sticker pack                    | WebM VP9 decodes; A and K copies match                                       | Pending | Pending |
| Video and photo sent as documents                         | Your own uncompressed file             | SHA-256 matches the original                                                 | Pending | Pending |

### Large files and memory (QA-2)

The largest tested size is 29 109 155 bytes. The executor's 4 GiB limit is a technical limit, rather than a tested Telegram file size. Web A photos are retrieved in full through a separate path and are limited to 32 MiB.

| Sample                      |   Size, bytes | Condition                     | Web A   | Web K   |
| --------------------------- | ------------: | ----------------------------- | ------- | ------- |
| `tad-large-100m.bin`        |   104 869 945 | —                             | Pending | Pending |
| `tad-sample-long-video.mp4` |  over 100 MiB | Generator with `--long-video` | Pending | Pending |
| `tad-large-1g.bin`          | 1 073 754 169 | —                             | Pending | Pending |
| `tad-large-2g.bin`          | 2 086 678 585 | Below the 2000 MiB limit      | Pending | Pending |
| `tad-large-4g.bin`          | 4 183 830 585 | Requires Telegram Premium     | Pending | Pending |

For each row, record the exact size and SHA-256, peak memory and increase for Telegram processes, interface responsiveness, and cancellation halfway through transfer.

### Lifecycle and identity (QA-3)

| Scenario                                                           | Automated                 | Live                                                                           |
| ------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------ |
| Cancellation during transfer                                       | E2E (K), unit (A)         | K tested; A pending                                                            |
| Cancelling the system dialog, long wait for confirmation           | Unit                      | Pending                                                                        |
| Write failure and writer finalization failure                      | E2E with simulation       | Pending (safe simulation only)                                                 |
| Closing and reloading the source tab during transfer               | E2E                       | Pending                                                                        |
| Stopping the extension service worker                              | E2E                       | Pending                                                                        |
| Browser restart, offline mode, and retry                           | Unit (chunk retries)      | Pending                                                                        |
| Navigation within the SPA during transfer                          | Unit; E2E before transfer | Connection after a chat change tested; transfer during navigation pending      |
| Real queue: second file waits while the first transfers            | E2E                       | Pending                                                                        |
| Double click, two tabs, account change, DOM rendering              | Unit                      | Pending                                                                        |
| Album item, viewer                                                 | Unit                      | Pending                                                                        |
| Identical audio names/durations, prefetch, cache, partial playback | Unit                      | Pending                                                                        |
| Public, ordinary private, and protected channel                    | —                         | Protected private channel tested; public and ordinary private channels pending |

Yandex Browser is tested using a [separate checklist](yandex-checklist.md).
