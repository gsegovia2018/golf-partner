-- ============================================================================
-- Shareable live board: a read-only tournament page anyone can open with a
-- link, no account required.
-- ============================================================================
--
-- WHAT THIS ADDS
-- --------------
--   1. public.tournaments.share_token  — nullable, UNIQUE. NULL = sharing off.
--   2. public.set_share_token(text, text)  — OWNER-ONLY guarded write path
--      (enable / rotate / revoke). SECURITY DEFINER, authenticated only.
--   3. public.get_shared_board(text)   — the anon read path. SECURITY DEFINER,
--      returns a WHITELISTED projection of get_game_tournament, or NULL.
--
-- The token is a bearer capability: whoever holds it can watch the board. It
-- is therefore the ONLY capability the payload carries — the real tournament
-- id is deliberately stripped, so a viewer cannot pivot from the board to any
-- id-addressed RPC, and rotating the token fully revokes every old link.
--
-- ----------------------------------------------------------------------------
-- (1) WRITE PATH: why an RPC and NOT a direct .from('tournaments').update()
-- ----------------------------------------------------------------------------
-- The current UPDATE policy on public.tournaments (20260518000004, unchanged
-- by 20260715000004/5/6) is:
--
--   CREATE POLICY tournaments_update ON public.tournaments
--     FOR UPDATE TO authenticated
--     USING      (public.can_edit_tournament(id, auth.uid()))
--     WITH CHECK (public.can_edit_tournament(id, auth.uid()));
--
-- can_edit_tournament (20260515000000) is TRUE for the creator, for legacy
-- NULL-owner rows, AND for every tournament_members row with role
-- 'owner'/'editor'. The invite/join flow grants exactly that editor role —
-- including to anonymous guests (20260518000004 header, and 20260715000005's
-- prod audit: "All 17 tournament_members rows are role 'editor'").
--
-- So a plain `.from('tournaments').update({ share_token })` WOULD succeed
-- today, but for the wrong set of people: any guest who ever redeemed an
-- invite could publish the group's scores to the open internet, or silently
-- rotate/revoke a link the owner created. Publishing a tournament is an
-- OWNER decision, not an editor one — a strictly narrower right than every
-- other tournament write. It gets its own guard.
--
-- Second reason, the same one that motivated 20260715000006: an UPDATE that
-- fails authorization under RLS matches 0 rows and returns success. A silent
-- no-op is the worst possible outcome for a share toggle — the UI would show
-- "sharing on" while the link 404s. The RPC RAISEs 42501 instead.
--
--   CLIENT CONTRACT (build item 5, tournamentStore.js):
--     enable / rotate:  supabase.rpc('set_share_token',
--                                    { p_id: <tournamentId>, p_token: uuidv4() })
--     revoke:           supabase.rpc('set_share_token',
--                                    { p_id: <tournamentId>, p_token: null })
--     Owner-only; anything else raises 42501 (insufficient_privilege).
--     An unknown/blank p_token string is normalised to NULL (= revoke).
--     Online-only, NOT queued through syncQueue — same precedent as attestCard.
--     Do NOT write share_token through patch_game_tournament: that RPC merges
--     unknown keys into props, so it would create a props.share_token that no
--     policy guards and no reader honours. share_token is a COLUMN.
--     Reading the current token back is a normal owner SELECT on tournaments
--     (already permitted by tournaments_select) — nothing new needed.
--
-- ----------------------------------------------------------------------------
-- (2) READ PATH: get_shared_board's whitelist, key by key
-- ----------------------------------------------------------------------------
-- The RPC wraps public.get_game_tournament (20260811000000) — the sync-v2
-- assembler over game_players / game_rounds / game_scores. (The legacy
-- tournaments.data blob no longer exists; it was dropped in 20260728000002.)
-- get_game_tournament's output is NOT safe to return as-is: it splices the
-- whole `props` jsonb, every player body (user_id, avatar_url, gender), every
-- round body, plus notes and shotDetails. So nothing is ever passed through
-- wholesale — every level is rebuilt with jsonb_build_object from an explicit
-- key list. Anything added to props / a player body / a round body in the
-- future is therefore excluded BY CONSTRUCTION, not by remembering to strip it.
--
-- Every kept key below was traced to a client-side consumer (all of them are
-- pure functions the public page reuses unchanged):
--
--   TOURNAMENT LEVEL
--     name          — the board heading.
--     kind          — formatRoundLabel({kind,...}) (tournamentStore.js:1990)
--                     shows the course name for a casual game, "Round N · …"
--                     for a tournament; tournamentNoun() picks the copy.
--     createdAt     — the only date the payload has (rounds carry none); the
--                     board and the share card both show "when was this".
--     currentRound  — isRoundInProgress / liveRoundSummary pick the live round
--                     with rounds[currentRound]; drives the LIVE badge.
--                     Conditional: absent when the column is NULL, exactly as
--                     get_game_tournament emits it.
--     finishedAt    — isTournamentFinished (tournamentStore.js:2067) and
--                     isRoundInProgress (2087) both short-circuit on it; the
--                     board must not claim LIVE on an archived game.
--     settings      — REBUILT, three keys only:
--                       scoringMode    → roundScoringMode(t, r) falls back to
--                                        settings.scoringMode (scoring.js:547)
--                                        for rounds with no own override.
--                       bestBallValue  → roundBestBallValues (scoring.js:556)
--                       worstBallValue    same, for the bestball board.
--                     fixedTeams / manualTeams are WRITE-path only (they steer
--                     pairsForNextRound when a round is revealed) — a
--                     read-only board never builds teams, so they are dropped.
--     DROPPED: id (the token is the only capability — see above), deletedAt
--     (a tombstoned tournament never resolves here at all), and the entire
--     rest of props.
--
--   PLAYER LEVEL (rebuilt per element)
--     id            — every score/pair/handicap map is keyed by it.
--     name          — the only thing rendered; also split for first names by
--                     scrambleUnits (scoring.js:740) and the matchplay status
--                     line (scoring.js:1156).
--     handicap      — the documented fallback whenever a round has no stored
--                     playerHandicaps entry: resolvePlayerHandicap
--                     (scoring.js:304), roundPlayerIndex (65),
--                     scrambleTeamHandicaps (720), matchPlayHolePts (179).
--                     Legacy rounds legitimately miss those entries, so
--                     dropping it would silently score them off scratch.
--     DROPPED: user_id (an auth.users UUID — never leaves the authed API),
--     avatar_url, gender (only reTeeRound consumes gender, a write path),
--     and anything else a player body carries.
--
--   ROUND LEVEL (rebuilt per element)
--     id              — React keys / round selection.
--     courseName      — formatRoundLabel + liveRoundSummary (lib/
--                       liveRoundSummary.js:38).
--     holes           — REBUILT per hole to { number, par, strokeIndex }:
--                       number keys round.scores[playerId][hole.number],
--                       par + strokeIndex are the Stableford/net-strokes math
--                       (calcStablefordPoints / calcExtraShots, scoring.js:131),
--                       and holes.length is "thru N of 18". Tee distances and
--                       every other hole field are dropped.
--     scores          — { playerId: { hole: strokes } }; the board itself.
--     scoringMode     — the round's own mode override (roundScoringMode).
--     pairs           — REBUILT to [[{id}]]: teams drive scramble/bestball/
--                       pairsmatchplay scoring (scrambleUnits, pairsMatchDuels,
--                       assignBestWorstRoles) and the scramble ball lives under
--                       pair[0]. Re-thinned server-side ON PURPOSE: thinPairs
--                       (scoring.js:523) only started stripping members on
--                       write in 20260728000001, so LEGACY rows still embed
--                       whole player objects — including user_id. Passing
--                       pairs through verbatim would leak exactly the identity
--                       the player whitelist just removed.
--     revealed        — partnerships are hidden until the round is revealed;
--                       carried so the public page honours the same reveal
--                       instead of spoiling an undrawn draw.
--     playerHandicaps — { playerId: playingHandicap }, the frozen per-round
--                       stroke allowance every scoring path reads first
--                       (getPlayingHandicap, scoring.js:109).
--     playerIndexes   — per-round handicap-INDEX overrides (roundPlayerIndex,
--                       scoring.js:65); numbers only.
--     playerTees      — { playerId: { label, slope, rating } }; resolveRoundTee
--                       (scoring.js:54) needs it to derive a playing handicap
--                       when playerHandicaps has no entry.
--     slope,
--     courseRating    — the pre-per-player-tees fallback for the same
--                       derivation (resolveRoundTee's else branch).
--     bestBallValue,
--     worstBallValue  — per-round overrides of the settings values above.
--     DROPPED: notes (free text about real people — the single most sensitive
--     thing in the blob), shotDetails (per-shot putts/penalties; irrelevant to
--     standings and a large payload), manualHandicaps (a write-path flag for
--     recomputeRoundPlayingHandicaps), courseId / tees / club / clubLayouts /
--     layoutId (course-library edit affordances), and everything else.
--
-- jsonb_strip_nulls runs once over the finished object so a key the source
-- simply does not have vanishes instead of arriving as an explicit null. Every
-- client reader above uses `?.` / `??` / `?? {}`, so absent and null are
-- already interchangeable; this only keeps the payload small and predictable.
--
-- ----------------------------------------------------------------------------
-- (3) Why SECURITY DEFINER, and what is NOT changed
-- ----------------------------------------------------------------------------
-- anon holds no grants on public.tournaments or any game_* table
-- (20260715000003), and every RLS policy is `TO authenticated`. So the RPC is
-- the entire security boundary, exactly as with the official-tournament token
-- RPCs (20260517000001:313-317) — the anon key shipping in the web bundle is
-- by design.
--
-- get_game_tournament's OWN grants are untouched. It is SECURITY INVOKER and
-- carries only the default PUBLIC execute privilege, so an anon caller reaches
-- its body and then fails on `SELECT * FROM public.tournaments` with
-- permission denied — it has never been, and does not become, an anon read
-- path. It is only usable here because a SECURITY DEFINER caller runs it as
-- the table owner, who bypasses RLS.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE). Safe to re-run. Adds one nullable column; modifies no
-- existing row and no existing function.
-- ============================================================================

-- (1) The token column ------------------------------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS share_token text;

COMMENT ON COLUMN public.tournaments.share_token IS
  'Public live-board capability token. NULL = sharing disabled (the default). '
  'Set/rotated/cleared ONLY through public.set_share_token (owner-only); read '
  'by public.get_shared_board, which is the only anon-reachable path to it.';

-- UNIQUE so a token identifies exactly one tournament. Written as its own
-- index rather than an inline column constraint purely for re-runnability:
-- ADD COLUMN IF NOT EXISTS skips its whole clause when the column already
-- exists, which would silently skip an inline UNIQUE too.
CREATE UNIQUE INDEX IF NOT EXISTS tournaments_share_token_key
  ON public.tournaments (share_token);

-- (2) Owner-only write path -------------------------------------------------
-- Guard pattern is verbatim 20260715000006: check first, RAISE 42501 on
-- failure, so an unauthorized caller gets an error instead of a silent no-op.
-- is_tournament_owner (20260419120004) is strict created_by equality — unlike
-- can_edit_tournament it has no NULL-owner and no editor-member branch.
CREATE OR REPLACE FUNCTION public.set_share_token(p_id text, p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT public.is_tournament_owner(p_id, auth.uid()) THEN
    RAISE EXCEPTION 'not authorized to share tournament %', p_id
      USING ERRCODE = '42501';
  END IF;

  -- '' / '   ' are not tokens. Normalise them to NULL so a blank string from
  -- the client revokes sharing instead of creating an unguessable-but-empty
  -- link (and so the UNIQUE index can never collide on '').
  v_token := NULLIF(btrim(COALESCE(p_token, '')), '');

  UPDATE public.tournaments
     SET share_token = v_token
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such tournament %', p_id;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_share_token(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_share_token(text, text) TO authenticated;

-- (3) Public read path ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_shared_board(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  text;
  v_raw jsonb;
  v_out jsonb;
BEGIN
  -- A blank token must never match; NULLIF+btrim mirrors set_share_token's
  -- normalisation so the two can never disagree about what "no token" means.
  IF NULLIF(btrim(COALESCE(p_token, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.id INTO v_id
    FROM public.tournaments t
   WHERE t.share_token = p_token
     AND t.deleted_at IS NULL;      -- a deleted game stops being shareable
  IF NOT FOUND THEN
    RETURN NULL;                    -- wrong / rotated / revoked token
  END IF;

  v_raw := public.get_game_tournament(v_id);
  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;

  v_out := jsonb_build_object(
    'name',      v_raw -> 'name',
    'kind',      v_raw -> 'kind',
    'createdAt', v_raw -> 'createdAt',

    'settings', jsonb_build_object(
      'scoringMode',    v_raw #> '{settings,scoringMode}',
      'bestBallValue',  v_raw #> '{settings,bestBallValue}',
      'worstBallValue', v_raw #> '{settings,worstBallValue}'),

    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',       p -> 'id',
               'name',     p -> 'name',
               'handicap', p -> 'handicap')
             ORDER BY ord)
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(v_raw -> 'players') = 'array'
                    THEN v_raw -> 'players' ELSE '[]'::jsonb END)
             WITH ORDINALITY AS e(p, ord)), '[]'::jsonb),

    'rounds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',             r -> 'id',
               'courseName',     r -> 'courseName',
               'scoringMode',    r -> 'scoringMode',
               'revealed',       r -> 'revealed',
               'scores',         r -> 'scores',
               'playerHandicaps',r -> 'playerHandicaps',
               'playerIndexes',  r -> 'playerIndexes',
               'playerTees',     r -> 'playerTees',
               'slope',          r -> 'slope',
               'courseRating',   r -> 'courseRating',
               'bestBallValue',  r -> 'bestBallValue',
               'worstBallValue', r -> 'worstBallValue',

               -- holes: par + strokeIndex are the scoring math, number is the
               -- key into scores. Distances and everything else are dropped.
               'holes',
               CASE WHEN jsonb_typeof(r -> 'holes') = 'array' THEN (
                 SELECT COALESCE(jsonb_agg(jsonb_build_object(
                          'number',      h -> 'number',
                          'par',         h -> 'par',
                          'strokeIndex', h -> 'strokeIndex')
                        ORDER BY hord), '[]'::jsonb)
                   FROM jsonb_array_elements(r -> 'holes')
                        WITH ORDINALITY AS hh(h, hord)) END,

               -- pairs: ids ONLY. Legacy rows embed whole player objects here
               -- (see the header) — re-thin server-side or the player
               -- whitelist above is pointless.
               'pairs',
               CASE WHEN jsonb_typeof(r -> 'pairs') = 'array' THEN (
                 SELECT COALESCE(jsonb_agg((
                          SELECT COALESCE(jsonb_agg(
                                   jsonb_build_object('id', m -> 'id')
                                 ORDER BY mord), '[]'::jsonb)
                            FROM jsonb_array_elements(
                                   CASE WHEN jsonb_typeof(team) = 'array'
                                        THEN team ELSE '[]'::jsonb END)
                                 WITH ORDINALITY AS mm(m, mord))
                        ORDER BY tord), '[]'::jsonb)
                   FROM jsonb_array_elements(r -> 'pairs')
                        WITH ORDINALITY AS tt(team, tord)) END)
             ORDER BY rord)
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(v_raw -> 'rounds') = 'array'
                    THEN v_raw -> 'rounds' ELSE '[]'::jsonb END)
             WITH ORDINALITY AS rr(r, rord)), '[]'::jsonb));

  -- Conditional keys, added only when the source actually has them — same
  -- treatment get_game_tournament gives currentRound, so the public shape
  -- matches the shape the client's own scoring functions already expect.
  IF v_raw ? 'currentRound' THEN
    v_out := v_out || jsonb_build_object('currentRound', v_raw -> 'currentRound');
  END IF;
  IF v_raw ? 'finishedAt' THEN
    v_out := v_out || jsonb_build_object('finishedAt', v_raw -> 'finishedAt');
  END IF;

  -- Drop keys whose source value was missing/null rather than shipping
  -- explicit nulls. Every client reader treats absent and null identically.
  RETURN jsonb_strip_nulls(v_out);
END $$;

REVOKE EXECUTE ON FUNCTION public.get_shared_board(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_shared_board(text) TO anon, authenticated;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent -- safe to re-run.
   Destroys nothing; no existing row or function is modified.

   VERIFY -- grants
   ---------------------------------------------------------------------------
   SELECT p.proname, p.prosecdef AS security_definer,
          p.proconfig, r.rolname AS grantee
     FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('get_shared_board','set_share_token','get_game_tournament')
      AND a.privilege_type = 'EXECUTE'
    ORDER BY 1, 4;
   -- Expect: get_shared_board  -> anon + authenticated (NOT public/PUBLIC)
   --         set_share_token   -> authenticated only
   --         get_game_tournament -> unchanged by this migration (no anon GRANT
   --           added; it is SECURITY INVOKER and dies on tournaments RLS/grants
   --           if anon ever calls it -- see the anon smoke test below).

   VERIFY -- end to end as the OWNER (authenticated)
   ---------------------------------------------------------------------------
   -- 1. enable sharing on a game you own
   SELECT public.set_share_token('<tournament id>', 'tok-demo-1111');
   -- 2. a non-owner (editor member / friend viewer) must be rejected loudly
   --    (run in a rolled-back tx with a different request.jwt.claims):
   --    ERROR:  not authorized to share tournament ...   [SQLSTATE 42501]

   VERIFY -- the anon read path (this is the security boundary)
   ---------------------------------------------------------------------------
   BEGIN;
     SET LOCAL ROLE anon;

     -- wrong / revoked / rotated token -> NULL, no error, no existence leak
     SELECT public.get_shared_board('nope')  IS NULL AS wrong_token_is_null;
     SELECT public.get_shared_board('')      IS NULL AS blank_is_null;
     SELECT public.get_shared_board(NULL)    IS NULL AS null_is_null;

     -- right token -> ONLY whitelisted top-level keys
     SELECT jsonb_object_keys(public.get_shared_board('tok-demo-1111')) AS key
      ORDER BY 1;
     -- Expect exactly a subset of: createdAt, currentRound, finishedAt, kind,
     -- name, players, rounds, settings.
     -- Expect ABSENT: id, deletedAt, and every other props key.

     -- no player identity survives
     SELECT bool_and(NOT (p ? 'user_id') AND NOT (p ? 'avatar_url')
                     AND NOT (p ? 'gender')) AS players_clean,
            (SELECT array_agg(DISTINCT k ORDER BY k)
               FROM jsonb_array_elements(
                      public.get_shared_board('tok-demo-1111') -> 'players') pl,
                    jsonb_object_keys(pl) k) AS player_keys
       FROM jsonb_array_elements(
              public.get_shared_board('tok-demo-1111') -> 'players') p;
     -- Expect: players_clean = true, player_keys = {handicap,id,name}

     -- no notes / shot details / embedded identity in pairs
     SELECT bool_and(NOT (r ? 'notes') AND NOT (r ? 'shotDetails')) AS rounds_clean,
            bool_and(NOT (m ? 'user_id') AND NOT (m ? 'name')) AS pairs_thin
       FROM jsonb_array_elements(
              public.get_shared_board('tok-demo-1111') -> 'rounds') r
       LEFT JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(r -> 'pairs') = 'array'
                   THEN r -> 'pairs' ELSE '[]'::jsonb END) team ON true
       LEFT JOIN LATERAL jsonb_array_elements(team) m ON true;
     -- Expect: both true (pairs_thin is NULL only when there are no pairs)

     -- anon still cannot reach anything else
     SELECT public.get_game_tournament('<tournament id>');  -- permission denied
     SELECT count(*) FROM public.tournaments;                -- permission denied
   ROLLBACK;

   REVOKE a link
   ---------------------------------------------------------------------------
   SELECT public.set_share_token('<tournament id>', NULL);
   -- every previously shared URL now returns NULL from get_shared_board.

   LIST what is currently shared
   ---------------------------------------------------------------------------
   SELECT id, name, share_token FROM public.tournaments
    WHERE share_token IS NOT NULL AND deleted_at IS NULL;
   =========================================================================== */
