-- Storyteller AI Gateway — credits ledger and generation job persistence

create table if not exists public.gateway_user_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 1000 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.gateway_credit_reservations (
  job_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists gateway_credit_reservations_user_id_idx
  on public.gateway_credit_reservations (user_id);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  intent text not null,
  provider text not null check (provider in ('runway', 'higgsfield', 'openai')),
  status text not null check (
    status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  progress integer,
  provider_job_id text,
  credits_reserved integer not null default 0,
  request_json jsonb not null default '{}'::jsonb,
  result_json jsonb,
  error_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists generation_jobs_user_id_idx on public.generation_jobs (user_id);
create index if not exists generation_jobs_project_id_idx on public.generation_jobs (project_id);
create index if not exists generation_jobs_provider_job_id_idx
  on public.generation_jobs (provider_job_id)
  where provider_job_id is not null;

alter table public.gateway_user_credits enable row level security;
alter table public.gateway_credit_reservations enable row level security;
alter table public.generation_jobs enable row level security;

create policy gateway_user_credits_select_own
  on public.gateway_user_credits
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy generation_jobs_select_own
  on public.generation_jobs
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Writes are performed by the gateway service role only (no insert/update policies for authenticated).
