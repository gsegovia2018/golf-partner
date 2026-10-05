# League: month-first board + Stats screen — plan (2026-10-05)

Design canvas (picked): https://claude.ai/artifact/VvFGssPHBAG7qd8LYDAU62
- Board = "Board B" (round 2). Settings = "Settings" board. Stats = "Stats screen · B + C's season grid".
- League has up to ~18 members. All copy in English (app language).

No backend change. Everything is derived client-side from data `useLeague` already loads
(`league`, `members`, `cardsByMonth` with full cards incl. `holes`, `course`, `playingHandicap`,
`points`, `teeTime`, `playedOn`, `status`, `confirmation`, `confirmedByName`, `notAnnounced`, `proofPath`).
Only cards with `status === 'confirmed'` feed stats and rankings.

## Item 1 — `src/store/leagueStats.js` (pure, no I/O) + tests   [PR: feat/league-stats]
Reuse `scoreCard` from `store/leagueRules.js` for per-hole Stableford points (it takes
`{holes, course, leagueHandicap, tee}`; prefer the card's stored `playingHandicap` — add a small
internal helper that computes per-hole points from `holes` + `course.holes` + `playingHandicap`
using `calcStablefordPoints` / `calcExtraShots` from `store/scoring.js` if scoreCard can't take it).
Gross birdie = strokes <= par - 1. Blob = 0 points. Snowman = strokes >= 8 (or worst vs par).

Exports (names are a suggestion; keep them pure and tested):
- `cardHoleStats(card)` → per-hole `{n, par, si, strokes, points}` + `{out, in}` nine totals.
- `monthHonours(cards, members)` → ordered list of `{key, title, text, userId}` for one month:
  card of the month (best points, course), hole of the month (max points on one hole; text like
  "Pablo, a 2 on the par-3 7th at Los Arqueros with a stroke · 4 pts"), hot streak (longest run of
  holes at 2+ pts, holes a–b), closer (best back nine, "13 out and 21 back"), birdies (group total +
  top players), snowman (worst hole vs par), early bird (earliest teeTime) · last call (latest
  playedOn). Skip an honour when its data is missing. Fewer than 3 confirmed cards → `[]` and the
  UI shows "Not enough cards yet".
- `statLeaders(cardsByMonth, members, statKey)` → rows `{userId, value, display, cards}` sorted best
  first. statKeys: `avg` (avg points/card), `birdies` (total), `blobs` (total, fewest is NOT best —
  sort most first, it's a fun stat), `par3` (avg pts on par 3s), `backNine` (avg back − avg front).
  Players with < 3 confirmed cards go last with `display: 'needs 3 cards'` for averaged stats.
- `seasonGrid(cardsByMonth, members, monthKeys)` → rows per member (in season-table order, passed in)
  with cells `{month, points|null, best: bool}`; `best` = top confirmed card that month (ties all best).
- `rivals(cardsByMonth, members, meId)` → for every other member `{userId, won, lost, level}` over
  months where both have a confirmed card; sort by closest (|won−lost| asc, then most months).
  Plus `rivalMonths(cardsByMonth, a, b)` → `[{month, a, b}]` newest first.
Tests: `src/store/__tests__/leagueStats.test.js`, cover ties, missing holes, <3 cards, 9-hole course
safety (stats skip cards whose course isn't 18 holes), void/unconfirmed cards ignored.

## Item 2 — `src/screens/LeagueStatsScreen.js` + route   [PR: feat/league-stats]
Pushed screen `LeagueStats` `{ leagueId }`, registered in App.js next to LeagueBoard. Uses `useLeague`.
Header: back chevron + "<league name> · Stats". Segmented tabs (4 equal): Honours · Leaders · Grid · Rivals.
- Honours: month chips (current month "Oct · so far" first if it has confirmed cards, then scored months
  newest first). Card titled "September honours" with meta "16 cards · 7 courses"; each honour = small
  Feather icon in a mint square + uppercase small label + one-line text. Current month title
  "October so far", meta "6 of 18 cards · settles 31 Oct".
- Leaders: stat chips (Avg card, Birdies, Blobs, Par 3s, Back nine); a card listing all members:
  place · name · bar (value / scale) · value. Highlight my row (mint). Footnote for "needs 3 cards".
- Grid: members × season months (letters J F M …). Cell = confirmed points, shaded 36+ (accent bg,
  white text) / 33–35 (mint) / ≤32 (bunker wash) / dashed "–" no card; month winner outlined gold.
  Legend under it. Tap a cell with a card → `LeagueCard` screen if it exists in the codebase,
  else no-op. Rows in season-table order (`seasonTable` from leagueStandings).
- Rivals: "You vs the league" list: name, sub "1 level · 9 months", record "5–3" (accent when winning).
  Tap a row → expands (or shows below) the month-by-month list "Sep  You 33  Nacho 39", winner bold accent.
Loading/error/offline: mirror LeagueBoardScreen (ActivityIndicator, cloud-off + Try again, stale banner).
Theme: use `useTheme()` tokens like the other league screens (light + dark). Touch targets ≥ 44.
Entry point: the board header gets a `bar-chart-2` IconButton "Stats" (done in Item 3's PR; in this PR
add it too if the board header is untouched there — coordinate: THIS PR adds the header icon).
Test: `src/screens/__tests__/LeagueStatsScreen.test.js` (render each tab with fixture data).

## Item 3 — Board B + Settings move   [PR: feat/league-board-month, based on feat/league-card-view (#107)]
LeagueBoardScreen:
1. Order: stale/archived banners → "Your <Month> card" (unchanged logic, moved ABOVE the leaderboard;
   in the `none` state show the primary "Play with the app" and two side-by-side secondary buttons
   "Playing without the app" (→ LeagueAnnounce) and "Add a card I played" (→ LeagueAddScore); keep the
   explanatory sentence short: "Announce it before your first shot. Whatever you score then is your
   <Month> card.") → leaderboard card.
2. Leaderboard scope chips: first chip = current month with a small dot ("Oct"), then "Season", then
   scored months. DEFAULT scope = current month (unless archived league → Season).
3. Current-month scope renders grouped sections INSIDE the green leaderboard card (title
   "OCTOBER SO FAR · 13 DAYS LEFT"):
   - "Confirmed · N" (check icon, gold label): ranked by card points using `monthResults`; rows show
     place, name, sub-line "<course> · <how confirmed>" (with app partner / marker by QR / signed card
     photo / official result; append "not announced in the app" when flagged), points, and the table
     points the place would earn right now "+500" (gold).
   - "Waiting for confirmation · N" (clock icon): submitted cards; place "–", points muted,
     "not counting yet"; sub-line reason ("Marker hasn't scanned the QR yet" for qr/app, "needs the
     card photo" for off-app without proof).
   - "Playing or announced · N" (flag icon): playing → "Playing now · <course>"; announced →
     "Announced · <day time> · <course>".
   - "No card yet · N": one wrapped line of names, "You" first and bold.
   - Empty sections are omitted. Footer: "Gold = table points if the month ended today. The season
     table is one tap away on Season."
   Rows with a viewable card open it (reuse #107's row press → LeagueCard).
   Probably extend LeaderboardCard with optional section headers, or render sections with a small
   local component using the same styles — keep LeaderboardCard's existing API working.
4. Season and past-month scopes: unchanged from today.
5. Remove the separate "<Month>" status list card, the Final row and the "Members and handicaps" row
   from the board. Header right: Stats (`bar-chart-2`, → LeagueStats — guard: only if the route exists;
   it lands with feat/league-stats, so navigate anyway, both PRs merge together) + Settings. Remove the
   `users` header icon.
6. Move the pendingFinal effect + Final row logic to LeagueSettingsScreen: new first section "LEAGUE"
   with link rows: "Members and handicaps" (sub "18 members · cap 30" for admin, "Your league
   handicap 21.4" for a member; a pill "1 vote open" when there are open handicap votes) →
   LeagueMembers; Final row: admin + no final → "Set up the Final" (sub "December · extra strokes from
   the standings") → LeagueFinal; final exists → "The Final · <date>" (sub "Open") → Tournament.
   Keep everything else in Settings as is.
Pure helpers go in `store/leagueView.js` (e.g. `monthBoard(members, cardsByMonth, month, pointsTable,
now)` → `{confirmed, waiting, onCourse, noCard}`), with tests in `src/store/__tests__/leagueView.test.js`.
Update `src/screens/__tests__/LeagueBoardScreen.test.js` and add/extend a Settings test.

## Verification
`npm test`, `npm run lint` green. Then a web walkthrough (verify skill) as a member with cards, light + dark.
Ship: PRs → squash-merge → Vercel auto-deploy (web) + OTA `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli update --branch preview`.
