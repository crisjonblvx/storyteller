-- Add plan tier to gateway credit accounts (Phase 2 commercial readiness)

alter table public.gateway_user_credits
  add column if not exists plan_id text not null default 'starter'
  check (plan_id in ('starter', 'creator', 'studio'));
