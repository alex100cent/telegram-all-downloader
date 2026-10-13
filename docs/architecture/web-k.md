# Telegram Web K adapter

Research date: October 9, 2026. The extension implementation was written separately; no `Telegram-Downloader` code was used. The official Telegram Web K sources were read to identify data formats and available calls; they are not included in the extension.

## Confirmed path

Reviewed the official [morethanwords/tweb](https://github.com/morethanwords/tweb) repository, commit `18f99a99f62f62cd234b16af23a21664b62babb8`, and the public build at `https://web.telegram.org/k/`: `apiManagerProxy-DVXobuyu.js`, `index.worker-DGfthI1r.js`. Build filenames are evidence of the research and are not hardcoded in the adapter.

1. `window.apiManagerProxy`, `window.rootScope`, and `window.createProxiedManagersForAccount` are available in the MAIN world. This is confirmed by the sources and the published build. The [MOUNT_CLASS_TO](https://github.com/morethanwords/tweb/blob/18f99a99f62f62cd234b16af23a21664b62babb8/src/config/debug.ts) setting exposes these objects on `window` in production as well.
2. In the message list, `.bubble[data-peer-id][data-mid]` identifies a message. For albums, the nested `.grouped-item[data-mid]` or `.document-container[data-mid]` is selected. Multiple attachments in one message use `.album-item[data-index]`. Metadata comes from `apiManagerProxy.getMessageByPeer(peerId, mid)`; the audio player and recent `blob:` URLs are not involved.
3. The viewer has `window.appMediaViewer.target` with `peerId`, `mid`, `message`, and `index`. Changing slides therefore updates the button's exact identity. Stories and avatars have no suitable message and are excluded from discovery.
4. [`createProxiedManagersForAccount(slot)`](https://github.com/morethanwords/tweb/blob/18f99a99f62f62cd234b16af23a21664b62babb8/src/lib/getProxiedManagers.ts) provides access to the current Telegram account's managers through the worker that is already running. The slot number comes from `?account=`, but the identity stores the Telegram user ID. Before each chunk, the slot, `rootScope.myId`, and the `appUsersManager.getSelf()` response are checked to detect a user change within the slot.
5. [`apiFileManager.requestFilePart`](https://github.com/morethanwords/tweb/blob/18f99a99f62f62cd234b16af23a21664b62babb8/src/lib/appManagers/apiFileManager.ts) retrieves original bytes through the existing `upload.getFile`. The published build retains this method and handles `FILE_REFERENCE_EXPIRED` / `FILE_REFERENCE_INVALID` through Telegram reference storage. A new login, a separate MTProto client, and reading auth keys are unnecessary.

This is an unstable internal Telegram API, not a public compatibility guarantee. If the required runtime is absent, the adapter returns `unsupported_client`. The extension does not download executable code to restore compatibility.

Deduplication between A/K uses the server `message.id` and a shared channel peer representation (`-1_000_000_000_000 - channel_id`). K's internal `mid` remains only a runtime address. Both adapters identify the selected full file as `variant: original`; the specific photo size is kept in the private file location.

## File retrieval

Documents use `inputDocumentFileLocation` without a thumbnail variant. The same path covers audio, voice messages, round videos, videos, GIF/MP4, arbitrary documents, WebP, TGS, and WebM stickers.

For photos, the available `photoSize` or `photoSizeProgressive` with the highest resolution is selected; `photoStrippedSize` and `photoCachedSize` are not used. For progressive photos, the known byte size is taken from the last/largest size of the progressive representation. The available Telegram JPEG photo is saved without additional recompression.

Retrieving the original TGS bytes is essential: Telegram's standard `downloadMedia` may decompress a sticker for the renderer. The adapter reads through `requestFilePart`, so it does not substitute a JSON file with an incorrect extension for gzip TGS. Voice messages are saved with their actual MIME type/container; MP4 animations are not renamed to GIF.

One `read` retrieves at most 512 KiB. Ranges are aligned to 4 KiB; the shared executor uses 512 KiB. The next chunk is requested after the previous one has been written. The extension does not assemble a full Blob or pass bytes through extension messaging. `access_hash`, `file_reference`, and the Telegram file location remain in a MAIN world closure; only `MediaInfo` is exposed outside it.

Responses are checked for type, maximum length, and expected byte count. When the size is known, a short chunk is treated as an error rather than a successful end of file. Waiting for a chunk has a 60-second timeout. Network errors allow an explicit retry.

Cancellation immediately stops waiting and prevents further requests. A request for one chunk that has already been sent may complete inside Telegram. The adapter does not invoke shared cancellation by document ID, to avoid interrupting Telegram's own playback of that document. Another `read` on the same source is prohibited until that request finishes.

`noforwards` is unchanged: the adapter uses the file available to the current user and its own button. Unavailable paid previews without `extended_media[index].media` and TTL media are not handled. Metadata available only in a link preview is not treated as a message attachment.

## Verified behavior and remaining live checks

Automated fixtures verify exact selection of unplayed audio while an unrelated player is active, all listed document types, original TGS bytes, full photo selection, individual album items, viewer slide changes, an accessible protected attachment, account changes, media edits, cancellation, truncated responses, and an incompatible runtime. Sequential reads are checked by comparing all received bytes with the original test array.

These checks do not replace an authenticated Telegram session. A verified release still requires checks in Chrome and Yandex Browser on macOS, real examples of every attachment type, protected/private channels, server-side `file_reference` expiry, the File System Access picker/writer, a real 1 GiB file, and memory measurements across the full path. Confirming methods in the published build is not presented as a completed download in a user account.
