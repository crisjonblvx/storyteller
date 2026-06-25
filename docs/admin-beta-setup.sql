-- Storyteller admin / beta user setup
-- Run manually in Supabase SQL editor (or apply via migration).
--
-- The `owner` plan (packages/ai-gateway/src/plans.ts) gives 9999 monthly
-- allowances and is intended for beta testers and the operator account.

-- ─── 1. Add `owner` to plan_id constraint ───────────────────────────────────
alter table public.gateway_user_credits
  drop constraint if exists gateway_user_credits_plan_id_check;

alter table public.gateway_user_credits
  add constraint gateway_user_credits_plan_id_check
  check (plan_id in (
    'starter', 'intro_pro', 'reel_creator', 'studio', 'student', 'owner'
  ));

-- ─── 2. Assign beta access by email ─────────────────────────────────────────
-- Look up the user's UUID from Authentication → Users, or:
--   select id, email from auth.users where email = 'beta@example.com';

-- Example: grant owner plan + high credit balance
-- update public.gateway_user_credits
-- set plan_id = 'owner', balance = 500000, updated_at = now()
-- where user_id = '00000000-0000-0000-0000-000000000000';

-- If the user has no gateway row yet (first gateway call creates one), insert:
-- insert into public.gateway_user_credits (user_id, balance, plan_id)
-- select id, 500000, 'owner'
-- from auth.users
-- where email = 'beta@example.com'
-- on conflict (user_id) do update
-- set plan_id = excluded.plan_id, balance = excluded.balance, updated_at = now();

-- ─── 3. Assign beta access by UUID ──────────────────────────────────────────
-- update public.gateway_user_credits
-- set plan_id = 'owner', balance = 500000, updated_at = now()
-- where user_id = 'YOUR-USER-UUID-HERE';

-- ─── 4. Verify ──────────────────────────────────────────────────────────────
-- select u.email, c.plan_id, c.balance, c.updated_at
-- from public.gateway_user_credits c
-- join auth.users u on u.id = c.user_id
-- order by c.updated_at desc;

-- ─── 5. Reset monthly allowance counters (optional) ─────────────────────────
-- delete from public.gateway_user_allowances
-- where user_id = 'YOUR-USER-UUID-HERE' and period = to_char(now() at time zone 'utc', 'YYYY-MM');
