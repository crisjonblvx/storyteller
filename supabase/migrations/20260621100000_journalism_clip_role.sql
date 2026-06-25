-- Journalism workflow: clip role classification for news package assembly

alter table public.assets
  add column if not exists clip_role text
  check (clip_role in ('sot', 'standup', 'broll', 'voiceover', 'nat-sound', 'anchor', 'unassigned'));

alter table public.assets
  alter column clip_role set default 'unassigned';

comment on column public.assets.clip_role is
  'Journalism clip role: sot (sound on tape) | standup | broll | voiceover | nat-sound | anchor | unassigned';

create index if not exists assets_project_clip_role_idx
  on public.assets (project_id, clip_role)
  where clip_role is not null;
