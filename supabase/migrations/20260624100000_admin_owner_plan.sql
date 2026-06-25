-- Add `owner` plan to gateway_user_credits plan_id check (beta / operator tier)

alter table public.gateway_user_credits
  drop constraint if exists gateway_user_credits_plan_id_check;

alter table public.gateway_user_credits
  add constraint gateway_user_credits_plan_id_check
  check (plan_id in (
    'starter', 'intro_pro', 'reel_creator', 'studio', 'student', 'owner'
  ));
