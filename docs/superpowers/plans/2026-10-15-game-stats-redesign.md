# Game Stats redesign (option B: results first, four tabs)

Date: 2026-10-15. Design review artifact: https://claude.ai/artifact/VBcpiHwXqDFymGN2m92A9j (option B picked).
Screen: `src/screens/StatsScreen.js` (Game settings → Statistics), today 4,351 lines, 6 tabs, ~40 sections.

## Build items

| # | Item | Branch | Model |
|---|------|--------|-------|
| 1 | Calculation fixes + tests | `fix/stats-calculations` | Sonnet |
| 2 | Redesign B (this plan, §2–§6) | `feat/game-stats-redesign` | Opus |

Item 1 lands first; item 2 rebases on it.

## 1. Calculation fixes (item 1)

All in `src/store/statsEngine.js` / `src/store/tournamentStore.js`, each with a failing test first.

1. `strokeIndexAccuracy`: rank holes within each course (group by `courseId ?? courseName`), never across courses.
2. `playerAvgStableford` (and the average built from `playerRoundHistory`): average only full-length rounds fully scored by the player (`isFullLengthRound` + `isRoundFullyScoredBy`, as `computeMetrics` does). Expose pts/hole alongside.
3. `playerPartnerSplits`: resolve the partner against `tournament.players` (pairs are stored thin, `{id}`), so the name renders.
4. `hallOfShame` Triple Bogey Club: skip `isPickup` entries in strokes mode (mirror the blow-up rule).
5. `bounceBackRate`: count an opportunity only when the next scored hole is adjacent (a blank hole breaks the chain, not a failure).
6. `warmupVsClosing` labels: derive the hole range from the round length (H7–9 on a nine). (The card is cut in item 2, but fix it so item 1 stands alone.)
7. `tournamentMomentum` / `courseDNA.roundPoints`: same full-round rule as 2 (or pts/hole).

## 2. Information architecture (item 2)

Tabs: **Summary · Rounds · Players · Rivals**. Rivals only when ≥2 players. A single tab row; the global Strokes/Points switch is removed. Filters live inside the tab that uses them (round chips on Rounds, player chips on Players). Scramble sanitising (`withoutScrambleScores`) and the all-scramble placeholder stay as today.

Split the screen: `StatsScreen.js` becomes the shell (load, tabs, sheet). New `src/components/gamestats/`:
`SummaryTab.js`, `RoundsTab.js`, `PlayersTab.js`, `RivalsTab.js`, `ProgressionChart.js`, `RaceChart.js`, `ScorecardHeatmap.js`, `AwardsStrip.js`. Pure data shaping (standings rows, race series, stroke-hole split, awards list) goes in `src/store/` (statsEngine or a new `gameStatsView.js`) with unit tests. Keep `StatDetailSheet` for drill-down.

### Summary
1. **Standings**: reuse `LeaderboardCard` (deep green, as on Play). `headerRight` = Points / Gross / Net segmented control. Rows: place (ties `T2`), name, detail line = per-round values (`22 · 24 · 22`, partial rounds marked with holes played), big figure = total, sub = vs HCP (points − 2/hole) in Points, to-par in Gross/Net. Gross/Net rank only complete rounds (reuse the existing strokes-mode leaderboard logic in `tournamentStore`); Net = gross − playing handicap per round. Tap a row → that player on the Players tab.
2. **How it unfolded**: `ProgressionChart` (NEW, react-native-svg): cumulative points after each round, one line per player, direct end labels (collision-nudged), leader line bolder, 4-colour series palette from tokens (accent, pair.b, info, masters.pink), plus a one-line caption generated from the data (lead changes). Hidden with 1 round; with 1 round show nothing (Rounds has the race).
3. **Awards**: `AwardsStrip` (NEW): horizontal snap-scrolling compact cards (≈150 px), glory first, then shame. Each opens the existing detail sheet. Sources: best round, hot stretch (#1 only), most birdies (labelled net/gross explicitly), longest par streak (≥3), skins king (full skins table in its sheet), then shame merged per plan: Worst hole (triple club + blow-up), Cold streak (bogey/double/pointless streaks + zero hero), The Gift, The Collapse, Par-3 Heartbreak, Pickup champion, The Anchor (teams). Feather icons only, no emoji.
4. **Score mix · everyone**: one `ScoreMixBar` per player (net), with a legend, sorted by standings.

### Rounds
Round chips (`R1 · course` on the selected chip). For the selected round:
1. **Result card**: individual modes → winner + runner-up line; match play / pairs match play → scoreline from `matchPlayResults`; team Stableford/bestball/sindicato → pair totals.
2. **Race**: `RaceChart` (NEW): running Stableford points per player across holes 1–N (9 or 18), end labels. For team rounds also show the existing pair-difference chart (fix its Y-axis labels overlapping bars).
3. **Scorecard**: `ScorecardHeatmap` (NEW, replaces the heatmap): sticky Hole/Par/SI column, one column per player, each cell shows its points (colour + number), a superscript for stroke holes (¹ ²), dashed empty cell for unplayed, Out / In / Tot rows (9-hole rounds: Tot only). Legend underneath.
4. **Hole stories**: easiest, hardest, most chaos, everyone-cruised / everyone-wrecked — for this round, compact rows.

### Players
Player chips (default = me). Sections:
1. Header tiles: total + rank, avg per full round (+ pts/hole), vs HCP.
2. Score mix (`ScoreMixBar`, labelled net).
3. Where you score: par 3 / 4 / 5 and SI bands (hardest third / easiest third) as horizontal bars with pts/hole.
4. Stroke holes (NEW): pts/hole on holes with a handicap stroke vs without.
5. Front 9 vs back 9 + bounce-back, with the low-sample line (`isLowSample`) when thin.
6. Nemesis & crushed for this player.
7. Round history (as today, opens the hole sheet).
8. Shots (only when this player logged shot detail): putting (per round, per hole, 1-putts, 3-putts), FIR % with the drive-direction distribution, GIR %, scrambling, penalties; and a **shot comparison** table (FIR / GIR / putts per hole / 3-putts / penalties) when ≥2 players logged. Link "Career shots → My Stats".

### Rivals
1. **Head-to-head grid** (net hole wins), tap a cell → duel sheet (merge of today's H2H heatmap + duel card).
2. **Teams** (only with real team rounds): match play results, pair cards (avg pts + carry bar; no synergy ×, no coverage line), partner splits (hidden when `settings.fixedTeams`).

## 3. Cut
Consistency index, Clutch on hardest, Warm-up vs closing, Course DNA, Handicap ROI (folded into vs HCP), Hole wins table, Pair config matrix, Synergy/coverage, Putt deep-dive, Drive impact, Approach impact, GIR-after-drive, Nemesis encore, Tournament momentum (replaced), Stroke index accuracy card (keep the engine fix; drop the card), section-index chip rows, global Strokes/Points switch. Delete engine functions + their tests only when nothing else imports them.

## 4. Visual rules
Tokens only (`useTheme`, `semantic`, `onDeep`, `withAlpha` from `src/theme/alpha.js` — no `hex + '20'`). No literal colours. Smallest text 10 px. Serif only for big hero numerals. Touch targets ≥44 px. Colour never alone: every heat cell shows its number, ranks show text. Light + dark. Charts: one scale, labels the chart reaches, text from theme tokens.

## 5. i18n
Every new string in `src/i18n/locales/en` and `es` (see `docs/i18n.md` glossary). Remove keys only used by cut sections.

## 6. Verification
`npm test`, `npm run lint`, `EXPO_NO_TYPESCRIPT_SETUP=1 npm run build:web`; web walkthrough at 390 px, light + dark, with a 4-player 3-round fixture, a 9-hole round, a team round, a 1-player game and a game without shot data.
