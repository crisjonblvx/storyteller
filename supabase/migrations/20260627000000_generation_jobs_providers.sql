-- Extend generation_jobs.provider to match current gateway providers.
-- Original constraint only allowed runway, higgsfield, openai.

alter table public.generation_jobs
  drop constraint if exists generation_jobs_provider_check;

alter table public.generation_jobs
  add constraint generation_jobs_provider_check
  check (provider in (
    'runway', 'higgsfield', 'openai', 'xai', 'gemini', 'ideogram'
  ));
