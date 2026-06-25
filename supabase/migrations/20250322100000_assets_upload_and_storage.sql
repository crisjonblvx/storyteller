-- Assets: upload/probe fields, photo type, sort order
-- Storage: bucket + policies for project-scoped paths

-- 1) Extend asset_type (keep legacy `image`, add `photo`)
alter table public.assets drop constraint if exists assets_asset_type_check;
alter table public.assets add constraint assets_asset_type_check
  check (asset_type in ('video', 'audio', 'image', 'photo'));

alter table public.assets add column if not exists original_filename text;
alter table public.assets add column if not exists mime_type text;
alter table public.assets add column if not exists upload_status text not null default 'pending';
alter table public.assets add column if not exists probe_status text not null default 'pending';
alter table public.assets add column if not exists sort_order integer not null default 0;

-- Optional: relax NOT NULL on storage_path for draft rows — keep NOT NULL for v1 (path known before upload)
comment on column public.assets.upload_status is 'pending | uploading | complete | failed';
comment on column public.assets.probe_status is 'pending | success | skipped | error';

create index if not exists assets_project_sort_idx on public.assets (project_id, sort_order);

-- 2) Helper: path projects/{projectId}/...
create or replace function public.user_owns_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid and p.user_id = auth.uid()
  );
$$;

-- 3) Storage bucket (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'project-media', 'project-media', false, 524288000, null
where not exists (select 1 from storage.buckets where id = 'project-media');

-- 4) Storage RLS policies — path: projects/{projectId}/assets/...
drop policy if exists "project-media select own" on storage.objects;
drop policy if exists "project-media insert own" on storage.objects;
drop policy if exists "project-media update own" on storage.objects;
drop policy if exists "project-media delete own" on storage.objects;

create policy "project-media select own"
on storage.objects for select to authenticated
using (
  bucket_id = 'project-media'
  and public.user_owns_project((split_part(name, '/', 2))::uuid)
);

create policy "project-media insert own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-media'
  and (split_part(name, '/', 1)) = 'projects'
  and public.user_owns_project((split_part(name, '/', 2))::uuid)
  and (split_part(name, '/', 3)) = 'assets'
);

create policy "project-media update own"
on storage.objects for update to authenticated
using (
  bucket_id = 'project-media'
  and public.user_owns_project((split_part(name, '/', 2))::uuid)
)
with check (
  bucket_id = 'project-media'
  and public.user_owns_project((split_part(name, '/', 2))::uuid)
);

create policy "project-media delete own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'project-media'
  and public.user_owns_project((split_part(name, '/', 2))::uuid)
);
