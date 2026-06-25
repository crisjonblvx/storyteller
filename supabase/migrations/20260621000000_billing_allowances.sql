-- Storyteller Billing Phase 2
-- 1. Fix plan_id CHECK constraint (was missing intro_pro, reel_creator, student).
-- 2. Add stripe_customer_id to link accounts to Stripe.
-- 3. Create monthly allowance usage ledger.
-- 4. Add atomic try_consume_allowance() RPC to avoid over-consumption race conditions.

-- ─── Fix plan_id constraint ───────────────────────────────────────────────────
alter table public.gateway_user_credits
  drop constraint if exists gateway_user_credits_plan_id_check;

alter table public.gateway_user_credits
  add constraint gateway_user_credits_plan_id_check
  check (plan_id in ('starter', 'intro_pro', 'reel_creator', 'studio', 'student'));

-- ─── Stripe customer linkage ─────────────────────────────────────────────────
alter table public.gateway_user_credits
  add column if not exists stripe_customer_id text;

create unique index if not exists gateway_user_credits_stripe_customer_id_idx
  on public.gateway_user_credits (stripe_customer_id)
  where stripe_customer_id is not null;

-- ─── Monthly allowance usage ledger ─────────────────────────────────────────
-- Tracks how many metering units each user has consumed in a given billing period.
-- period format: 'YYYY-MM' (UTC calendar month).
create table if not exists public.gateway_user_allowances (
  user_id          uuid    not null references auth.users (id) on delete cascade,
  period           text    not null, -- 'YYYY-MM'
  episode_passes_used integer not null default 0 check (episode_passes_used >= 0),
  clip_batches_used   integer not null default 0 check (clip_batches_used   >= 0),
  ai_videos_used      integer not null default 0 check (ai_videos_used      >= 0),
  updated_at       timestamptz not null default now(),
  primary key (user_id, period)
);

create index if not exists gateway_user_allowances_user_id_idx
  on public.gateway_user_allowances (user_id);

alter table public.gateway_user_allowances enable row level security;

create policy gateway_user_allowances_select_own
  on public.gateway_user_allowances
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ─── Atomic conditional increment ────────────────────────────────────────────
-- Upserts the usage row for the period and increments the given unit column
-- only when the current count is below the allowed limit.
-- Returns TRUE  → unit was consumed (caller may proceed).
-- Returns FALSE → limit already reached or unknown unit (caller must reject).
create or replace function public.try_consume_allowance(
  p_user_id uuid,
  p_period  text,
  p_unit    text,
  p_limit   integer
) returns boolean
language plpgsql security definer
as $$
declare
  v_rowcount integer;
  v_col      text;
begin
  v_col := case p_unit
    when 'episode_pass' then 'episode_passes_used'
    when 'clip_batch'   then 'clip_batches_used'
    when 'ai_video'     then 'ai_videos_used'
    else null
  end;

  if v_col is null then
    return false;
  end if;

  -- Ensure a row exists for this billing period.
  insert into public.gateway_user_allowances (user_id, period)
  values (p_user_id, p_period)
  on conflict (user_id, period) do nothing;

  -- Atomically increment, but only if under the limit.
  execute format(
    'update public.gateway_user_allowances
       set %I = %I + 1, updated_at = now()
     where user_id = $1 and period = $2 and %I < $3',
    v_col, v_col, v_col
  ) using p_user_id, p_period, p_limit;

  get diagnostics v_rowcount = row_count;
  return v_rowcount > 0;
end;
$$;
