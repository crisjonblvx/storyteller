-- Creator workflow: clip role classification for creator-cut auto-assembly

alter table public.assets
  add column if not exists creator_clip_role text
  check (creator_clip_role in ('hook', 'hero', 'broll', 'testimonial', 'recap', 'transition', 'unassigned'));

alter table public.assets
  alter column creator_clip_role set default 'unassigned';

comment on column public.assets.creator_clip_role is
  'Creator clip role: hook | hero | broll | testimonial | recap | transition | unassigned';

create index if not exists assets_project_creator_clip_role_idx
  on public.assets (project_id, creator_clip_role)
  where creator_clip_role is not null;
