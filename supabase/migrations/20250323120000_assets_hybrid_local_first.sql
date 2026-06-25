-- Local-first / hybrid asset storage: source media is not required in Supabase Storage.

alter table public.assets alter column storage_path drop not null;

alter table public.assets add column if not exists storage_mode text;
alter table public.assets add column if not exists local_path text;
alter table public.assets add column if not exists proxy_path text;
alter table public.assets add column if not exists media_hash text;
alter table public.assets add column if not exists is_uploaded boolean not null default false;

comment on column public.assets.storage_mode is 'local | cloud — primary routing for analysis and export';
comment on column public.assets.local_path is 'Absolute path on the user machine (Electron desktop)';
comment on column public.assets.storage_path is 'Object key in Storage bucket project-media when synced to cloud';
comment on column public.assets.proxy_path is 'Optional lightweight proxy for preview (future)';
comment on column public.assets.media_hash is 'Optional content hash for dedupe/sync';
comment on column public.assets.is_uploaded is 'True when original (or proxy) exists in Supabase Storage';

-- Backfill: rows that already have a storage object are cloud-side
update public.assets
set
  storage_mode = 'cloud',
  is_uploaded = true
where storage_path is not null
  and coalesce(storage_mode, '') = '';

update public.assets
set storage_mode = 'local'
where storage_path is null
  and coalesce(storage_mode, '') = '';

update public.assets
set storage_mode = 'local'
where storage_mode is null;

alter table public.assets alter column storage_mode set default 'local';
alter table public.assets alter column storage_mode set not null;

alter table public.assets drop constraint if exists assets_storage_mode_check;
alter table public.assets add constraint assets_storage_mode_check
  check (storage_mode in ('local', 'cloud'));

create index if not exists assets_project_storage_idx on public.assets (project_id, storage_mode);
