-- 20260720000100_profile_settings.sql
-- Per-user app settings blob (see docs/superpowers/specs/2026-07-20-user-settings-design.md).
-- Defaults live in client code; missing keys fall back there, so '{}' is a
-- complete valid value and no backfill is needed.
alter table public.profiles
  add column if not exists settings jsonb not null default '{}'::jsonb;
