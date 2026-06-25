-- Storyteller v1 — initial schema (Supabase / Postgres)

-- Extensions
create extension if not exists "uuid-ossp";

-- Profiles (synced from auth.users via trigger or app upsert)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text,
  organization text,
  created_at timestamptz not null default now()
);

-- Projects
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  mode text not null check (mode in ('story', 'journalism', 'creator')),
  description text,
  status text not null default 'draft',
  settings_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects (user_id);

-- Assets
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  asset_type text not null check (asset_type in ('video', 'audio', 'image')),
  storage_path text not null,
  duration_seconds double precision,
  width integer,
  height integer,
  fps double precision,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assets_project_id_idx on public.assets (project_id);

-- Transcript segments
create table if not exists public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  speaker_label text,
  start_time double precision not null,
  end_time double precision not null,
  text text not null,
  confidence double precision,
  created_at timestamptz not null default now()
);

create index if not exists transcript_segments_project_id_idx on public.transcript_segments (project_id);

-- Silence regions
create table if not exists public.silence_regions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  start_time double precision not null,
  end_time double precision not null,
  severity double precision,
  created_at timestamptz not null default now()
);

-- Soundbite candidates
create table if not exists public.soundbite_candidates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  start_time double precision not null,
  end_time double precision not null,
  transcript_text text not null,
  score_social double precision,
  score_emotional double precision,
  score_clarity double precision,
  tags_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Story plans
create table if not exists public.story_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  mode text not null,
  user_prompt text,
  plan_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- B-roll prompts
create table if not exists public.broll_prompts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  segment_start double precision not null,
  segment_end double precision not null,
  prompt_type text not null check (prompt_type in ('literal', 'emotional', 'symbolic')),
  prompt_text text not null,
  priority_score double precision,
  created_at timestamptz not null default now()
);

-- Text events
create table if not exists public.text_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  preset_id text not null,
  start_time double precision not null,
  end_time double precision not null,
  content text not null,
  styling_json jsonb default '{}'::jsonb,
  render_mode text not null check (render_mode in ('burnin', 'alpha', 'separate')),
  created_at timestamptz not null default now()
);

-- Timelines (canonical JSON)
create table if not exists public.timelines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version integer not null default 1,
  timeline_json jsonb not null,
  created_at timestamptz not null default now()
);

-- Export jobs
create table if not exists public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  export_type text not null check (export_type in ('mp4', 'xml_package', 'alpha_overlay')),
  status text not null default 'queued',
  output_path text,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.silence_regions enable row level security;
alter table public.soundbite_candidates enable row level security;
alter table public.story_plans enable row level security;
alter table public.broll_prompts enable row level security;
alter table public.text_events enable row level security;
alter table public.timelines enable row level security;
alter table public.export_jobs enable row level security;

-- Policies: owner-only via auth.uid()
create policy "profiles_own" on public.profiles for all using (auth.uid() = id);

create policy "projects_own" on public.projects for all using (auth.uid() = user_id);

create policy "assets_own" on public.assets for all
  using (exists (select 1 from public.projects p where p.id = assets.project_id and p.user_id = auth.uid()));

create policy "transcript_own" on public.transcript_segments for all
  using (exists (select 1 from public.projects p where p.id = transcript_segments.project_id and p.user_id = auth.uid()));

create policy "silence_own" on public.silence_regions for all
  using (exists (select 1 from public.projects p where p.id = silence_regions.project_id and p.user_id = auth.uid()));

create policy "soundbite_own" on public.soundbite_candidates for all
  using (exists (select 1 from public.projects p where p.id = soundbite_candidates.project_id and p.user_id = auth.uid()));

create policy "story_plan_own" on public.story_plans for all
  using (exists (select 1 from public.projects p where p.id = story_plans.project_id and p.user_id = auth.uid()));

create policy "broll_own" on public.broll_prompts for all
  using (exists (select 1 from public.projects p where p.id = broll_prompts.project_id and p.user_id = auth.uid()));

create policy "text_events_own" on public.text_events for all
  using (exists (select 1 from public.projects p where p.id = text_events.project_id and p.user_id = auth.uid()));

create policy "timelines_own" on public.timelines for all
  using (exists (select 1 from public.projects p where p.id = timelines.project_id and p.user_id = auth.uid()));

create policy "export_jobs_own" on public.export_jobs for all
  using (exists (select 1 from public.projects p where p.id = export_jobs.project_id and p.user_id = auth.uid()));

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
