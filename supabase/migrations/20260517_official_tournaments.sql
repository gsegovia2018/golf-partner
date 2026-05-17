-- ============================================================================
-- Official Tournament Core — schema.
-- Spec: docs/superpowers/specs/2026-05-17-official-tournament-core-design.md
-- Safe to re-run (every statement idempotent). Apply in the Supabase SQL editor.
-- ============================================================================

-- 1) Tournament type. Casual is unchanged; official tournaments score
--    through the relational tables below instead of the JSONB blob.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'casual';
ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_kind_check;
ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_kind_check CHECK (kind IN ('casual','official'));

-- 2) Roster: one row per player in an official tournament.
CREATE TABLE IF NOT EXISTS public.tournament_roster (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  handicap      numeric NOT NULL DEFAULT 0,
  magic_token   text NOT NULL UNIQUE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  withdrawn     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 3) Rounds (relational — casual rounds stay in the blob).
CREATE TABLE IF NOT EXISTS public.tournament_rounds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_index   int NOT NULL,
  course        jsonb NOT NULL DEFAULT '{}'::jsonb,
  format        text NOT NULL DEFAULT 'stableford'
                  CHECK (format IN ('gross_net','stableford','pairs','match')),
  status        text NOT NULL DEFAULT 'setup'
                  CHECK (status IN ('setup','live','locked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, round_index)
);

-- 4) Parties — groups of ~4, per round.
CREATE TABLE IF NOT EXISTS public.tournament_parties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      uuid NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  number        int NOT NULL,
  locked        boolean NOT NULL DEFAULT false,
  UNIQUE (round_id, number)
);

-- 5) Party members. seat defines round-robin order; marks_roster_id is who
--    this player marks (round-robin default, admin-overridable).
CREATE TABLE IF NOT EXISTS public.tournament_party_members (
  party_id        uuid NOT NULL REFERENCES public.tournament_parties(id) ON DELETE CASCADE,
  roster_id       uuid NOT NULL REFERENCES public.tournament_roster(id) ON DELETE CASCADE,
  seat            int NOT NULL,
  marks_roster_id uuid REFERENCES public.tournament_roster(id) ON DELETE SET NULL,
  pair_id         text,
  PRIMARY KEY (party_id, roster_id)
);

-- 6) Per-cell score rows. Two per player per hole (self + marker).
CREATE TABLE IF NOT EXISTS public.tournament_scores (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          uuid NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  hole              int NOT NULL CHECK (hole BETWEEN 1 AND 18),
  subject_roster_id uuid NOT NULL REFERENCES public.tournament_roster(id) ON DELETE CASCADE,
  source            text NOT NULL CHECK (source IN ('self','marker')),
  author_roster_id  uuid NOT NULL REFERENCES public.tournament_roster(id) ON DELETE CASCADE,
  strokes           int CHECK (strokes IS NULL OR strokes BETWEEN 1 AND 20),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, hole, subject_roster_id, source)
);

-- 7) Append-only audit of every value written.
CREATE TABLE IF NOT EXISTS public.tournament_score_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          uuid NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  hole              int NOT NULL CHECK (hole BETWEEN 1 AND 18),
  subject_roster_id uuid NOT NULL,
  source            text NOT NULL,
  strokes           int,
  author_roster_id  uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 8) Attestations — one row per player per round.
CREATE TABLE IF NOT EXISTS public.tournament_attestations (
  round_id    uuid NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  roster_id   uuid NOT NULL REFERENCES public.tournament_roster(id) ON DELETE CASCADE,
  attested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, roster_id)
);

-- 9) In-app admin notifications.
CREATE TABLE IF NOT EXISTS public.tournament_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_id      uuid REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roster_tournament_idx     ON public.tournament_roster (tournament_id);
CREATE INDEX IF NOT EXISTS rounds_tournament_idx     ON public.tournament_rounds (tournament_id);
CREATE INDEX IF NOT EXISTS parties_round_idx         ON public.tournament_parties (round_id);
CREATE INDEX IF NOT EXISTS parties_tournament_idx    ON public.tournament_parties (tournament_id);
CREATE INDEX IF NOT EXISTS party_members_roster_idx  ON public.tournament_party_members (roster_id);
CREATE INDEX IF NOT EXISTS scores_round_idx          ON public.tournament_scores (round_id);
CREATE INDEX IF NOT EXISTS notifications_tourn_idx   ON public.tournament_notifications (tournament_id);

-- Row-level security. The admin (tournament owner) is an authenticated user.
-- Guests are NOT authenticated — they reach data only through the RPCs in
-- Task 2, so the score tables get owner-only policies and no guest policy.
ALTER TABLE public.tournament_roster        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_rounds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_parties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_party_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_scores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_score_audit   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_attestations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_notifications ENABLE ROW LEVEL SECURITY;

-- Owner-only policy helper: a row is admin-visible when its tournament is
-- owned by the caller. Applied per table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tournament_roster','tournament_rounds','tournament_parties','tournament_notifications'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_owner ON public.%I FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM public.tournaments tt
                        WHERE tt.id = %I.tournament_id AND tt.created_by = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments tt
                        WHERE tt.id = %I.tournament_id AND tt.created_by = auth.uid()))
    $p$, t, t, t, t);
  END LOOP;
END $$;

-- Child tables reached via round_id → round → tournament owner.
DROP POLICY IF EXISTS party_members_owner ON public.tournament_party_members;
CREATE POLICY party_members_owner ON public.tournament_party_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tournament_parties p
                   JOIN public.tournaments tt ON tt.id = p.tournament_id
                  WHERE p.id = tournament_party_members.party_id AND tt.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournament_parties p
                   JOIN public.tournaments tt ON tt.id = p.tournament_id
                  WHERE p.id = tournament_party_members.party_id AND tt.created_by = auth.uid()));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tournament_scores','tournament_score_audit','tournament_attestations'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_owner ON public.%I FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM public.tournament_rounds r
                         JOIN public.tournaments tt ON tt.id = r.tournament_id
                        WHERE r.id = %I.round_id AND tt.created_by = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM public.tournament_rounds r
                         JOIN public.tournaments tt ON tt.id = r.tournament_id
                        WHERE r.id = %I.round_id AND tt.created_by = auth.uid()))
    $p$, t, t, t, t);
  END LOOP;
END $$;

/* VERIFY
   SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'tournament_%';
   SELECT relname, relrowsecurity FROM pg_class
    WHERE relname LIKE 'tournament_%';
*/

-- ============================================================================
-- Token-validated RPCs. Guests call these with their magic_token; the
-- function validates the exact operation before acting. SECURITY DEFINER so
-- they bypass RLS, but each one re-checks authorization itself.
-- ============================================================================

-- Resolve a token to its roster player + tournament context.
CREATE OR REPLACE FUNCTION public.redeem_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT ro.id, ro.display_name, ro.handicap, ro.tournament_id, ro.withdrawn
    INTO r FROM public.tournament_roster ro WHERE ro.magic_token = p_token;
  IF r.id IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  RETURN jsonb_build_object(
    'roster_id', r.id, 'display_name', r.display_name,
    'handicap', r.handicap, 'tournament_id', r.tournament_id,
    'withdrawn', r.withdrawn);
END $$;

-- Optional account linking: when an authenticated user opens a link, bind
-- the roster row to their account so the round reaches their history.
CREATE OR REPLACE FUNCTION public.link_token_to_user(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.tournament_roster
     SET user_id = auth.uid()
   WHERE magic_token = p_token AND user_id IS NULL;
END $$;

-- Full round state visible to the token holder: parties, members, scores,
-- attestations. Scores are returned for the caller's whole party.
CREATE OR REPLACE FUNCTION public.get_round_state(p_token text, p_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_roster uuid; v_party uuid;
BEGIN
  SELECT id INTO v_roster FROM public.tournament_roster WHERE magic_token = p_token;
  IF v_roster IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  SELECT pm.party_id INTO v_party
    FROM public.tournament_party_members pm
    JOIN public.tournament_parties pa ON pa.id = pm.party_id
   WHERE pm.roster_id = v_roster AND pa.round_id = p_round_id;
  IF v_party IS NULL THEN RAISE EXCEPTION 'not in this round'; END IF;
  RETURN jsonb_build_object(
    'party_id', v_party,
    'my_roster_id', v_roster,
    'round', (SELECT to_jsonb(r) FROM public.tournament_rounds r WHERE r.id = p_round_id),
    'members', (SELECT jsonb_agg(jsonb_build_object(
                  'roster_id', pm.roster_id, 'seat', pm.seat,
                  'marks_roster_id', pm.marks_roster_id, 'pair_id', pm.pair_id,
                  'display_name', ro.display_name, 'handicap', ro.handicap,
                  'withdrawn', ro.withdrawn) ORDER BY pm.seat)
                FROM public.tournament_party_members pm
                JOIN public.tournament_roster ro ON ro.id = pm.roster_id
               WHERE pm.party_id = v_party),
    'scores', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'hole', s.hole, 'subject_roster_id', s.subject_roster_id,
                  'source', s.source, 'strokes', s.strokes)), '[]'::jsonb)
                FROM public.tournament_scores s
                WHERE s.round_id = p_round_id
                  AND s.subject_roster_id IN (
                    SELECT roster_id FROM public.tournament_party_members WHERE party_id = v_party)),
    'attestations', (SELECT COALESCE(jsonb_agg(a.roster_id), '[]'::jsonb)
                FROM public.tournament_attestations a
               WHERE a.round_id = p_round_id
                 AND a.roster_id IN (
                   SELECT roster_id FROM public.tournament_party_members WHERE party_id = v_party)));
END $$;

-- Write one score cell. Validates: self => subject is the caller; marker =>
-- subject is the caller's markee. Rejects writes to a locked party.
CREATE OR REPLACE FUNCTION public.submit_score(
  p_token text, p_round_id uuid, p_hole int,
  p_subject uuid, p_source text, p_strokes int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_roster uuid; v_party uuid; v_locked boolean; v_markee uuid;
BEGIN
  SELECT id INTO v_roster FROM public.tournament_roster WHERE magic_token = p_token;
  IF v_roster IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  SELECT pm.party_id, pa.locked, pm.marks_roster_id
    INTO v_party, v_locked, v_markee
    FROM public.tournament_party_members pm
    JOIN public.tournament_parties pa ON pa.id = pm.party_id
   WHERE pm.roster_id = v_roster AND pa.round_id = p_round_id;
  IF v_party IS NULL THEN RAISE EXCEPTION 'not in this round'; END IF;
  IF v_locked THEN RAISE EXCEPTION 'party locked'; END IF;
  IF p_source NOT IN ('self','marker') THEN RAISE EXCEPTION 'bad source'; END IF;
  IF p_hole IS NULL OR p_hole < 1 OR p_hole > 18 THEN
    RAISE EXCEPTION 'hole out of range'; END IF;
  IF p_strokes IS NOT NULL AND (p_strokes < 1 OR p_strokes > 20) THEN
    RAISE EXCEPTION 'strokes out of range'; END IF;
  IF p_source = 'self' AND p_subject <> v_roster THEN
    RAISE EXCEPTION 'self score must be your own'; END IF;
  IF p_source = 'marker' AND v_markee IS NULL THEN
    RAISE EXCEPTION 'no markee assigned'; END IF;
  IF p_source = 'marker' AND p_subject <> v_markee THEN
    RAISE EXCEPTION 'marker score must be your markee'; END IF;

  INSERT INTO public.tournament_scores
    (round_id, hole, subject_roster_id, source, author_roster_id, strokes, updated_at)
  VALUES (p_round_id, p_hole, p_subject, p_source, v_roster, p_strokes, now())
  ON CONFLICT (round_id, hole, subject_roster_id, source)
  DO UPDATE SET strokes = excluded.strokes,
                author_roster_id = excluded.author_roster_id,
                updated_at = now();
  INSERT INTO public.tournament_score_audit
    (round_id, hole, subject_roster_id, source, strokes, author_roster_id)
  VALUES (p_round_id, p_hole, p_subject, p_source, p_strokes, v_roster);
END $$;

-- Attest the caller's own card. Allowed only when none of the caller's holes
-- are in discrepancy (both entries present and unequal).
CREATE OR REPLACE FUNCTION public.attest_card(p_token text, p_round_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_roster uuid; v_conflicts int;
BEGIN
  SELECT id INTO v_roster FROM public.tournament_roster WHERE magic_token = p_token;
  IF v_roster IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  SELECT count(*) INTO v_conflicts FROM (
    SELECT hole FROM public.tournament_scores
     WHERE round_id = p_round_id AND subject_roster_id = v_roster
     GROUP BY hole
    HAVING count(*) FILTER (WHERE source='self')   = 1
       AND count(*) FILTER (WHERE source='marker') = 1
       AND max(strokes) FILTER (WHERE source='self')
         <> max(strokes) FILTER (WHERE source='marker')
  ) c;
  IF v_conflicts > 0 THEN RAISE EXCEPTION 'resolve discrepancies first'; END IF;
  INSERT INTO public.tournament_attestations (round_id, roster_id)
  VALUES (p_round_id, v_roster) ON CONFLICT DO NOTHING;
END $$;

GRANT EXECUTE ON FUNCTION public.redeem_token(text)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_token_to_user(text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_state(text,uuid)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_score(text,uuid,int,uuid,text,int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attest_card(text,uuid)        TO anon, authenticated;

-- ============================================================================
-- Party / round locking. When every member of a party has attested, lock the
-- party; when every party in a round is locked, lock the round. Each step
-- writes an admin notification.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.on_attestation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_party uuid; v_tourn bigint; v_open int; v_round_open int;
BEGIN
  SELECT pm.party_id INTO v_party
    FROM public.tournament_party_members pm
    JOIN public.tournament_parties pa ON pa.id = pm.party_id
   WHERE pm.roster_id = NEW.roster_id AND pa.round_id = NEW.round_id;
  IF v_party IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_open
    FROM public.tournament_party_members pm
    JOIN public.tournament_roster ro ON ro.id = pm.roster_id
   WHERE pm.party_id = v_party AND ro.withdrawn = false
     AND NOT EXISTS (SELECT 1 FROM public.tournament_attestations a
                      WHERE a.round_id = NEW.round_id AND a.roster_id = pm.roster_id);
  IF v_open = 0 THEN
    UPDATE public.tournament_parties SET locked = true WHERE id = v_party;
    SELECT tournament_id INTO v_tourn FROM public.tournament_parties WHERE id = v_party;
    INSERT INTO public.tournament_notifications (tournament_id, round_id, kind, body)
    VALUES (v_tourn, NEW.round_id, 'party_locked',
            'A party finished and locked its scores.');

    SELECT count(*) INTO v_round_open
      FROM public.tournament_parties WHERE round_id = NEW.round_id AND locked = false;
    IF v_round_open = 0 THEN
      UPDATE public.tournament_rounds SET status = 'locked' WHERE id = NEW.round_id;
      INSERT INTO public.tournament_notifications (tournament_id, round_id, kind, body)
      VALUES (v_tourn, NEW.round_id, 'round_locked', 'A round is complete.');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_on_attestation ON public.tournament_attestations;
CREATE TRIGGER trg_on_attestation
  AFTER INSERT ON public.tournament_attestations
  FOR EACH ROW EXECUTE FUNCTION public.on_attestation();
