-- ============================================================================
-- Shared board, phase 1.5: the anon read path for a shared tournament's
-- photos and videos.
-- ============================================================================
--
-- WHAT THIS ADDS
-- --------------
--   public.get_shared_board_media(text) -> jsonb
--     Same bearer-token key as public.get_shared_board (20260816000000):
--     resolve tournaments.share_token, return a WHITELISTED jsonb ARRAY of
--     that tournament's media rows, or NULL when the token does not resolve.
--
-- Nothing else changes. No new column, no new policy, no existing function or
-- row is touched. tournament_media keeps its authenticated-only RLS from
-- 20260516000001 exactly as it is — this RPC is a SECURITY DEFINER bypass for
-- one specific, whitelisted projection, not a loosening of that policy.
--
-- ----------------------------------------------------------------------------
-- (1) WHY THIS RPC EXISTS AT ALL
-- ----------------------------------------------------------------------------
-- The `tournament-media` Storage bucket is PUBLIC-read by design: the policy
-- "tournament-media public read" (20260419120000) has no auth predicate, and
-- 20260516000001 deliberately KEPT it while locking down insert/update/delete
--   ("The bucket stays public-read because the app builds plain public CDN
--    URLs for media"), so `getPublicUrl()` already works logged-out.
--
-- What an anonymous viewer lacks is DISCOVERY: public.tournament_media itself
-- is RLS'd `TO authenticated` (media_select, 20260516000001), so nobody can
-- learn WHICH object keys exist without being a member/owner/friend. That is
-- the entire gap this RPC closes — it hands out object keys for one tournament
-- whose owner published a share token, and nothing more.
--
--   >> REVOCATION CAVEAT — read this before promising anyone "unshare" <<
--   Because the bucket is public-CDN, rotating or revoking the share token
--   (set_share_token(..., NULL)) stops DISCOVERY of new URLs, but does NOT
--   invalidate a URL somebody already copied, screenshotted, or has cached.
--   Those object URLs keep returning 200 until the object is deleted from
--   Storage. Revocation is "the board goes dark", not "the photos are recalled".
--   Genuinely un-sharing a photo means deleting the Storage object (or moving
--   the whole bucket to private + signed URLs, which is the follow-up
--   20260516000001 already flagged). The share UI must not claim otherwise.
--
-- ----------------------------------------------------------------------------
-- (2) THE WHITELIST, key by key
-- ----------------------------------------------------------------------------
-- Same construction rule as get_shared_board: NOTHING is passed through. Every
-- element is rebuilt with jsonb_build_object from an explicit column list, so
-- any column added to tournament_media in the future is excluded BY
-- CONSTRUCTION rather than by somebody remembering to strip it.
--
-- Keys are camelCase because src/store/sharedBoard.js consumes them directly,
-- mirroring rowToMedia() in src/store/mediaStore.js:13 (which does the same
-- snake -> camel mapping for the authenticated path). Same names, same
-- meanings, so the board's media model and the app's media model agree.
--
--   id           <- id            React keys, stories/lightbox selection.
--   roundId      <- round_id      groups media under the round it belongs to
--                                 (the board renders a per-round strip/rail).
--   holeIndex    <- hole_index    "hole 7" caption-free context; nullable.
--   kind         <- kind          'photo' | 'video' — picks the renderer.
--   storagePath  <- storage_path  fed to getPublicUrl() client-side for the
--                                 full-size asset (bucket is public — see (1)).
--   thumbPath    <- thumb_path    ditto for the grid/rail thumbnail. NOT NULL
--                                 in the schema; mediaUpload.js falls back to
--                                 the original when thumbnailing fails.
--   durationS    <- duration_s    video length badge; NULL for photos.
--   createdAt    <- created_at    ordering + "when"; formatted with the SAME
--                                 to_char pattern get_game_tournament uses for
--                                 its createdAt (20260811000000:57), so the
--                                 board sees one timestamp format everywhere.
--
--   DELIBERATELY EXCLUDED — identity and free text stay off the public page:
--     uploader_id     an auth.users UUID. get_shared_board already strips
--                     player user_id for exactly this reason; leaking it here
--                     instead would make that stripping pointless.
--     uploader_label  a legacy display-name string. Same objection: it names a
--                     real person to an audience that holds only a link.
--     caption         free text written about real people, by people who were
--                     writing for four friends and not for the open internet.
--                     It is the single most sensitive field on the row — the
--                     same call the sibling RPC made about round `notes`.
--     tournament_id   the real tournament id. The token is the ONLY capability
--                     the shared board hands out; exposing the id would let a
--                     viewer pivot to id-addressed RPCs and would survive a
--                     token rotation. Identical reasoning to get_shared_board
--                     dropping the tournament id.
--
-- ----------------------------------------------------------------------------
-- (3) ORDERING AND THE CAP
-- ----------------------------------------------------------------------------
-- Newest-first (created_at DESC), which is how the feed reads and what the
-- stories rail wants. `id` is a tiebreak only, so two photos uploaded in the
-- same millisecond come back in a stable order across polls instead of
-- flickering. This is served straight off the existing index
-- tournament_media_tournament_idx (tournament_id, created_at DESC).
--
-- LIMIT 200 is a PAYLOAD GUARD, not a product decision: a weekend tournament
-- realistically carries a few dozen items, so the cap never binds in practice —
-- it exists so a pathological (or malicious-uploader) tournament cannot make an
-- unauthenticated, unthrottled endpoint return an unbounded response. If it
-- ever does bind, the board silently shows the 200 most recent items; there is
-- no pagination, and adding one would mean a cursor parameter here.
--
-- ----------------------------------------------------------------------------
-- (4) RETURN CONTRACT
-- ----------------------------------------------------------------------------
--   NULL          token is NULL / blank / unknown / rotated / revoked, or the
--                 tournament is soft-deleted. One indistinguishable answer for
--                 all of them: no existence leak, no error, nothing to probe.
--   '[]'::jsonb   token resolves, tournament simply has no media. An EMPTY
--                 ARRAY, never NULL — the client distinguishes "board is gone"
--                 (NULL) from "board is fine, no photos yet" (empty), and only
--                 the first is an error state.
--   jsonb array   the whitelisted rows above, newest first.
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_shared_board_media(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
BEGIN
  -- Blank never matches. NULLIF+btrim is verbatim set_share_token /
  -- get_shared_board normalisation so the three can never disagree about what
  -- "no token" means.
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

  -- COALESCE turns "no rows" into [] rather than NULL: absent media is not a
  -- broken board (see the return contract above).
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id',          m.id,
             'roundId',     m.round_id,
             'holeIndex',   m.hole_index,
             'kind',        m.kind,
             'storagePath', m.storage_path,
             'thumbPath',   m.thumb_path,
             'durationS',   m.duration_s,
             'createdAt',   to_char(m.created_at AT TIME ZONE 'UTC',
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
           ORDER BY m.created_at DESC, m.id)
      FROM (
        SELECT mm.id, mm.round_id, mm.hole_index, mm.kind,
               mm.storage_path, mm.thumb_path, mm.duration_s, mm.created_at
          FROM public.tournament_media mm
         WHERE mm.tournament_id = v_id
         ORDER BY mm.created_at DESC, mm.id
         LIMIT 200                  -- payload guard; see (3)
      ) m), '[]'::jsonb);
END $$;

COMMENT ON FUNCTION public.get_shared_board_media(text) IS
  'Anon read path for a shared tournament''s media, keyed on '
  'tournaments.share_token. Returns a whitelisted jsonb array (id, roundId, '
  'holeIndex, kind, storagePath, thumbPath, durationS, createdAt), newest '
  'first, capped at 200; NULL for an unknown/blank/revoked token or a deleted '
  'tournament; [] when there is simply no media. Excludes uploader_id, '
  'uploader_label, caption and tournament_id on purpose. NOTE: the bucket is '
  'public-CDN, so revoking the token stops discovery of new URLs but does not '
  'invalidate already-copied ones.';

REVOKE EXECUTE ON FUNCTION public.get_shared_board_media(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_shared_board_media(text) TO anon, authenticated;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent -- safe to re-run.
   Destroys nothing; no table, policy, row or existing function is modified.
   Requires 20260816000000_shared_board.sql (the share_token column) first.

   VERIFY -- grants
   ---------------------------------------------------------------------------
   SELECT p.proname, p.prosecdef AS security_definer,
          p.proconfig, r.rolname AS grantee
     FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('get_shared_board_media','get_shared_board')
      AND a.privilege_type = 'EXECUTE'
    ORDER BY 1, 4;
   -- Expect: get_shared_board_media -> anon + authenticated (NOT public/PUBLIC),
   --         security_definer = true, proconfig = {search_path=public}.

   -- tournament_media RLS is UNCHANGED by this migration:
   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'tournament_media';
   -- Expect: relrowsecurity = true (still authenticated-only via media_select).

   VERIFY -- the anon read path (this is the security boundary)
   ---------------------------------------------------------------------------
   -- Set up first, as the owner:  SELECT public.set_share_token('<tid>','tok-demo-1111');

   BEGIN;
     SET LOCAL ROLE anon;

     -- wrong / revoked / rotated / blank token -> NULL, no error, no leak
     SELECT public.get_shared_board_media('nope') IS NULL AS wrong_token_is_null;
     SELECT public.get_shared_board_media('')     IS NULL AS blank_is_null;
     SELECT public.get_shared_board_media(NULL)   IS NULL AS null_is_null;

     -- right token -> a jsonb ARRAY (never NULL); [] is the empty-media answer
     SELECT jsonb_typeof(public.get_shared_board_media('tok-demo-1111')) AS should_be_array;

     -- elements carry EXACTLY the whitelisted keys, nothing else
     SELECT (SELECT array_agg(DISTINCT k ORDER BY k)
               FROM jsonb_array_elements(
                      public.get_shared_board_media('tok-demo-1111')) el,
                    jsonb_object_keys(el) k) AS element_keys;
     -- Expect: {createdAt,durationS,holeIndex,id,kind,roundId,storagePath,thumbPath}
     -- (holeIndex / durationS arrive as explicit nulls when the column is NULL;
     --  this RPC does NOT jsonb_strip_nulls, so the key set is constant.)

     -- no uploader identity, no free text, no tournament id
     SELECT bool_and(NOT (el ? 'uploader_id') AND NOT (el ? 'uploaderId')
                 AND NOT (el ? 'uploader_label') AND NOT (el ? 'uploaderLabel')
                 AND NOT (el ? 'caption')
                 AND NOT (el ? 'tournament_id') AND NOT (el ? 'tournamentId')) AS elements_clean
       FROM jsonb_array_elements(
              public.get_shared_board_media('tok-demo-1111')) el;
     -- Expect: elements_clean = true (NULL only when there is no media at all)

     -- newest first, and capped
     SELECT jsonb_array_length(public.get_shared_board_media('tok-demo-1111')) <= 200 AS capped;
     SELECT bool_and(prev >= cur) AS newest_first FROM (
       SELECT (el ->> 'createdAt') AS cur,
              lag(el ->> 'createdAt') OVER (ORDER BY ord) AS prev
         FROM jsonb_array_elements(
                public.get_shared_board_media('tok-demo-1111'))
              WITH ORDINALITY AS e(el, ord)) s
      WHERE prev IS NOT NULL;
     -- Expect: capped = true, newest_first = true

     -- anon still cannot reach the table itself
     SELECT count(*) FROM public.tournament_media;   -- permission denied
   ROLLBACK;

   VERIFY -- the tombstone guard
   ---------------------------------------------------------------------------
   -- Soft-delete a shared game and the media goes dark with the board:
   --   UPDATE public.tournaments SET deleted_at = now() WHERE id = '<tid>';
   --   SET LOCAL ROLE anon;
   --   SELECT public.get_shared_board_media('tok-demo-1111') IS NULL;  -- true
   -- (run inside a transaction you ROLLBACK)
   =========================================================================== */
