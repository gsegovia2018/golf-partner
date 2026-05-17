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
