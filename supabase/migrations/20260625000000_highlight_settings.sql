alter table public.projects
  add column if not exists highlight_settings jsonb not null default '{}'::jsonb;

comment on column public.projects.highlight_settings is 'Structured settings for sports highlight reel projects (sport, style, beat-sync, etc.)';
