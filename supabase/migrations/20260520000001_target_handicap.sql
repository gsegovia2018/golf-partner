-- supabase/migrations/20260520000001_target_handicap.sql
-- Phase C: add target handicap for Strokes Gained comparison.
alter table profiles
  add column target_handicap numeric
    check (target_handicap is null or target_handicap >= 0);
