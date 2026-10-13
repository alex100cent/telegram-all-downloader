# Testing Yandex Browser on macOS

Until the rows below contain live results, Yandex Browser support is considered **unverified**. Successful checks in Chrome and Chromium fixtures do not automatically apply to Yandex.

## Preparation

1. Build the extension: `npm ci && npm run build` (or unpack the ZIP from CI / `npm run zip`). You need the `.output/chrome-mv3` folder.
2. Open the extensions page (`browser://extensions`), enable developer mode, and load the unpacked `.output/chrome-mv3` folder. If the menu path differs, record the actual steps.
3. Record the browser version (`browser://version`, first line) and macOS version.
4. Record the extension build: popup → Settings → “About this build”. The same value is visible in the extension version on the extensions page: `0.1.0 (<build>)`. A build of the form `<commit>-modified.<hash>` contains changes outside the commit — state this in the report.
5. Reload any already open `web.telegram.org/a/` and `/k/` tabs. Disable other Telegram downloaders during testing.
6. Prepare samples: `node scripts/qa-samples.ts generate ~/tad-samples --media --large=100m`. Send them **as files** to a test channel, or use samples already uploaded by the owner. See the [manual test plan](manual-testing.md) for details.

## Scenarios

Run each scenario in Web A and Web K. The Telegram tab must be active when testing the system dialog.

| ID  | Scenario                    | Action                                                                                 | Expected result                                                                                              |
| --- | --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Y1  | Installation and connection | Open the popup with Telegram open                                                      | “Connected” and the Web A or Web K label                                                                     |
| Y2  | System dialog               | Click ↓ beside an attachment, choose a destination, and save                           | The Yandex/macOS dialog opens immediately; the popup shows “Saved”                                           |
| Y3  | Main formats                | Save audio (MP3), a photo, video, voice message, and PDF                               | Size and SHA-256 match the sample or the same file from Chrome; `verify` has no FAIL                         |
| Y4  | Large file                  | Save `tad-large-100m.bin` (104 869 945 bytes)                                          | Exact size and SHA-256 from `manifest.json`                                                                  |
| Y5  | Cancellation                | During Y4, click the download button again or “Cancel” in the popup                    | “Cancelled”; the file is not marked as saved. Record the remaining file's size (an empty file is acceptable) |
| Y6  | Closing the popup           | Start Y4, close the popup, and wait for completion                                     | The download continues; reopening shows “Saved”                                                              |
| Y7  | Closing and reloading       | Close the Telegram tab during Y4; repeat with a reload                                 | “Interrupted”, code `interrupted`; no “Saved”                                                                |
| Y8  | Retry                       | For an interrupted or cancelled download, click “Retry in Telegram”, then “Save again” | The source tab opens; the new download requires selecting a file again and completes with “Saved”            |

## Report format

Copy the block for each result. Do not include chat names, links, personal file names, or screenshots with private content.

```text
Date:
macOS:
Yandex Browser (browser://version):
Extension build (Settings → About this build):
Client: Web A / Web K
Scenario: Y1–Y8
Sample: category and size (for example, PDF 608 bytes, tad-large-100m)
Result: as expected / different — specify how
SHA-256 matched: yes / no / not applicable
Error code and diagnostics (popup → “Diagnostics”), if an error occurred:
```

Transfer results to the [compatibility matrix](compatibility.md), marked “Yandex”. A Yandex-specific failure is fixed separately; untested scenarios remain “Pending”.
