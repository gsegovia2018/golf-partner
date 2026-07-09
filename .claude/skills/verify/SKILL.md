---
name: verify
description: Runtime-verify golf-partner changes by driving the Expo web app (same codebase as Android) with Playwright MCP tools.
---

# Verifying golf-partner at runtime

## Launch

```bash
npx expo start --web --port 8090 > /tmp/expo-web.log 2>&1 &   # ~25s to bundle
```

Then drive `http://localhost:8090` with the Playwright MCP tools
(`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_evaluate`).

## Login

Google OAuth is the primary flow but email/password works. No standing test
account — mint a confirmed throwaway with the service-role key from `.env`:

```bash
source .env
curl -X POST "$EXPO_PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"<qa>@example.com","password":"<pw>","email_confirm":true}'
```

Fill the login form via `browser_evaluate` using the native input value setter
(React controlled inputs ignore direct `.value` writes):
`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v)`
then dispatch `new Event('input', {bubbles: true})`.

## Driving the scorecard

- Setup wizard: Home → "New game" → pick course → 4 steps → Start Game.
- Stepper buttons carry aria-labels: `Increase strokes on hole N` /
  `Decrease strokes on hole N`. The score display is
  `Strokes on hole N` when empty, but becomes
  `Strokes on hole N — long-press to clear` once scored — match with
  `[aria-label^="Strokes on hole N"]`.
- All 18 hole pages are mounted at once; off-screen holes are clickable.
- First + tap on an empty hole lands on par, then ±1 per tap. Score saves are
  debounced 400ms; the sync-worker kick is debounced 1.5s (SYNC_KICK_DELAY_MS).
- To observe persistence work, monkey-patch `localStorage.setItem` and count
  writes per key (`@golf_tournament_<id>`, `@golf_sync_queue`,
  `@golf_last_sync_at`).

## Gotchas

- Ports are origins: localhost:8090 and :8091 have separate localStorage —
  a fresh port needs a fresh sign-in, but tournaments sync back via Supabase.
- Script-loop `.click()` bursts batch into one React render; to check
  per-tap rendering use ~120ms between taps and read the DOM ~30ms after each.
- If another session has uncommitted changes in this tree, Metro serves them.
  For an isolated run: `git worktree add <dir> HEAD`, `git apply` your diff,
  symlink `node_modules`, copy `.env`, and run expo on another port.
- An uncaught render error anywhere (e.g. HomeScreen) triggers the app-level
  ErrorBoundary and resets navigation to Home, unmounting the scorecard —
  don't confuse that with a scorecard bug.
