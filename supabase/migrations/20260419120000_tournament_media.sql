-- Bucket for tournament photos and short videos. Public-read so the
-- existing anon-key client can show media without signed URLs. The 4
-- friends share the anon key; if real auth is added later, switch to
-- signed URLs and RLS in a follow-up migration.
insert into storage.buckets (id, name, public)
values ('tournament-media', 'tournament-media', true)
on conflict (id) do nothing;

-- Permissive storage policies for the anon role on this bucket only.
create policy "tournament-media public read"
on storage.objects for select
using (bucket_id = 'tournament-media');

create policy "tournament-media anon insert"
on storage.objects for insert
with check (bucket_id = 'tournament-media');

create policy "tournament-media anon delete"
on storage.objects for delete
using (bucket_id = 'tournament-media');

-- Metadata table.
create table if not exists public.tournament_media (
  id              uuid primary key,
  tournament_id   text not null,
  round_id        text not null,
  hole_index      int,
  kind            text not null check (kind in ('photo', 'video')),
  storage_path    text not null,
  thumb_path      text not null,
  duration_s      numeric,
  caption         text,
  uploader_label  text,
  created_at      timestamptz not null default now()
);

create index if not exists tournament_media_tournament_idx
  on public.tournament_media (tournament_id, created_at desc);

create index if not exists tournament_media_round_idx
  on public.tournament_media (round_id, created_at desc);

-- RLS off to mirror the existing tournaments table (no auth in this app yet).
alter table public.tournament_media disable row level security;
