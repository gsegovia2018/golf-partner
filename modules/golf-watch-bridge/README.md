# golf-watch-bridge

Local Expo module (Kotlin, **Android only**) that connects the phone app to the Wear OS
companion over the Wearable Data Layer. Autolinked from `modules/` — no `package.json`
entry needed. iOS and web have no native side: `src/lib/watchBridge.js` loads it with
`requireOptionalNativeModule('GolfWatchBridge')` and turns every call into a no-op when
it is missing.

Plan and message contract: `docs/superpowers/plans/2026-10-11-wear-os-watch-companion.md`.

## API (`GolfWatchBridge`)

| Member | Behaviour |
|--------|-----------|
| `setState(json: string, urgent: boolean): void` | Puts the DataItem `/golf/state`, key `json`; `setUrgent()` when `urgent` (JS passes `false` only for a distance-only refresh). Calls made while a put is in flight are coalesced — only the latest JSON is put next, urgent if any coalesced call was. Failures are logged (`adb logcat -s GolfWatchBridge`), never thrown. A phone without the Wear OS app fails with `API_NOT_CONNECTED`; the first such failure turns publishing off for the module's lifetime (one log line, not one per push). |
| event `onCommand` → `{ json: string }` | Watch → phone messages on `/golf/cmd` (UTF-8 JSON). |
| `getConnectedNodes(): Promise<{ id, name }[]>` | Watches currently reachable. Rejects with `ERR_WEARABLE` when Play services / the Wearable API is unavailable. |

## Paths

- `/golf/state` — DataItem, phone → watch. Last write wins; the watch reads it on launch
  and receives it on reconnect without asking.
- `/golf/cmd` — Message, watch → phone. Commands carry absolute values, so a duplicate is
  harmless.

## Delivery while JS is not listening

The `MessageClient` listener is registered once per **process** (application context),
not per module instance. When no JS listener is attached — a JS reload, or before the
scorecard subscribes — commands wait in an in-memory FIFO (64 max, oldest dropped) and are
flushed in order when JS starts observing `onCommand`. Commands that waited more than 30 s
are dropped on flush: a minutes-old command would be replayed over whatever happened on
the phone since. The watch sees from the next state that it did not land.

This needs the process to be alive. During a round the round-tracking foreground service
(expo-location) keeps it alive with the screen off. If the process is dead, commands are
lost; the fallback — not built in v1 — is a `WearableListenerService` declared in the
manifest with a `/golf/cmd` intent filter, which wakes the app and persists the command
for JS to drain on start.

## Same applicationId and signing key on the watch

The Data Layer only delivers DataItems and Messages between apps with the **same package
name and the same signing certificate**. The watch app must therefore use applicationId
`com.golfpartner.app` and be signed with the phone's keystore — that is why the watch APK
is built through EAS with the same credentials (`wear-preview` profile). A debug-signed
watch build talks only to a debug-signed phone build.

Native change: adding or changing this module changes the runtime fingerprint, so it
needs a new phone APK (`preview-arm64`) before OTA updates can use it.
