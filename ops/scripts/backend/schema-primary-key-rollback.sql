-- Rollback for the guarded settings/import_jobs primary-key hardening.
-- Use only after restoring or validating a backup package.

ALTER TABLE IF EXISTS public.import_jobs
  DROP CONSTRAINT IF EXISTS import_jobs_pkey;

ALTER TABLE IF EXISTS public.import_jobs
  ALTER COLUMN id DROP NOT NULL;

ALTER TABLE IF EXISTS public.settings
  DROP CONSTRAINT IF EXISTS settings_pkey;

ALTER TABLE IF EXISTS public.settings
  ALTER COLUMN key DROP NOT NULL;
