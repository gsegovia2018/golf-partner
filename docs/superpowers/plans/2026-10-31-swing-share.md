# Swing sharing: a public link to one analysed swing

**Goal (2026-10-31, Marcos):** attract players. Record a swing, analyse it, share it; the people it
goes to watch it without an account and can create one from there.

**Decisions (Marcos):**
- **Content:** video plus analysis, not stills only.
- **Lifetime:** the link lasts until the owner stops sharing or deletes the swing. Either one
  deletes the files from the server.
- **After sign-up:** the new player lands on the Swing tab (`SwingHome`).
- **Design:** option A, "Results as you know it, read-only". The three options were compared on a
  private review page; the mockups are not in the repo.

## What ships

| Piece | Where |
|---|---|
| Table `swing_shares` (token, owner, swing_id, title, club, recorded_at, status) and the RPCs `start_` / `finish_` / `end_swing_share` and `get_public_swing` (anon) | `supabase/migrations/20261031000000_swing_shares.sql` |
| Bucket `swing-shares`: public read by exact path, no listing; only the link's owner can write, list or delete under `<token>/` | same migration |
| Pure helpers: frames to share, trimmed pose, `share.json`, `/s/<token>` | `src/store/swingShare.js` |
| Upload, stop, delete-a-shared-swing, public read | `src/store/swingShareStore.js` |
| Owner sheet: Results → ⋯ → "Compartir enlace" | `src/components/swing/SwingShareSheet.js` |
| Read-only Results: `readOnly`, `title`, `topSlot`, `bottomSlot` on `SwingResultsView` | `src/screens/SwingResultsScreen.js` |
| Public page | `src/screens/SwingSharedScreen.js`, route `SwingShared` = `s/:token` |
| Signed-out branch, auth over the page, landing on Swing | `App.js`, `src/lib/afterAuth.js`, `AuthScreen` props `initialMode` / `onBack` |

### What is uploaded

- `<token>/video.mp4`: the clip as recorded. Over 100 MB it can't be shared, and the sheet says
  so before uploading.
- `<token>/share.json`: `{ v: 1, analysis, pose, frames }`. The pose keeps only the frames that
  have a still.
- `<token>/frames/<i>.jpg`: one still per checkpoint frame and internal key frame
  (`shareFrames`).

What the page reads without an account is limited to the above plus `get_public_swing`:
- the sharer as first name + initial ("Íñigo E.", `league_public_name`);
- the owner's own name for the swing, if they set one;
- the club;
- the recorded and shared dates.

Never the user id, email, handicap or other swings.

### Read-only Results

Read-only mode hides:
- the ⋯ menu, "Edit marks", the view switch and the frame nudge. Only the key frames' stills are
  uploaded, so ‹ › has nothing to show.
- place-the-clubhead and the ask rows.

Kept: the verdict, the position strip, the stills with the overlay, the rows and fixes, the drills
and the ⅛-speed player.

## Known limits

- **A share is a snapshot.** Editing marks after sharing doesn't change the link. Sharing again
  (the sheet's upload) replaces the files and keeps the same link.
- **Measurement text is in the owner's language.** The analysis stores the text it was written
  in, so a Spanish viewer of an English owner's swing reads those rows in English.
- **Stop sharing needs a connection.** The files go first, then the row. Offline, the sheet says
  it couldn't stop, and deleting a shared swing is refused rather than leaving its link alive.

## Verified (2026-10-31)

- `npm test` and `npm run lint` (0 errors).
- Migration applied. Without an account: `get_public_swing` works; starting a share, reading the
  table, listing the bucket and writing under a token are all refused.
- Production web build (`npm run build:web`, headless Chrome at 390 × 844 and 1280 × 860):
  - a share seeded as a demo account through the real RPCs and storage rules;
  - every state: loaded light/dark/English, a position tab, the video at ⅛, loading, error →
    retry, closed link;
  - "Crear cuenta" → the sign-up screen with "‹ Volver al swing"; "Entrar" → sign-in → `/SwingHome`;
  - stop sharing as the owner: files removed, the lookup returns null, `share.json` returns 400;
  - the demo account and its rows were deleted afterwards.
- Not verified here: uploading from the Android app (native file read of a 240 fps clip). Marcos
  checks it on the phone.
