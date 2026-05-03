-- Business OS / Supabase Auth-only companion schema
-- Use this in the Supabase SQL Editor after enabling Auth providers.
-- This does NOT move your business data into Supabase.
-- It only keeps lightweight auth/profile metadata beside auth.users.

create extension if not exists pgcrypto;

create table if not exists public.business_os_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  local_user_id bigint,
  username text,
  providers jsonb not null default '[]'::jsonb,
  email_confirmed boolean not null default false,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.business_os_profiles is
  'Auth-only mirror for Business OS. Business OS Postgres remains the source of truth for app data and permissions.';

create index if not exists idx_business_os_profiles_local_user_id
  on public.business_os_profiles(local_user_id)
  where local_user_id is not null;

create index if not exists idx_business_os_profiles_email
  on public.business_os_profiles(lower(email))
  where email is not null and btrim(email) <> '';

create or replace function public.business_os_sync_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.business_os_profiles (
    id,
    email,
    display_name,
    avatar_url,
    local_user_id,
    username,
    providers,
    email_confirmed,
    last_sign_in_at,
    updated_at
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'local_user_id', '')::bigint,
    coalesce(new.raw_user_meta_data ->> 'username', new.raw_app_meta_data ->> 'username', ''),
    to_jsonb(coalesce(new.raw_app_meta_data -> 'providers', '[]'::jsonb)),
    new.email_confirmed_at is not null,
    new.last_sign_in_at,
    timezone('utc', now())
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        local_user_id = excluded.local_user_id,
        username = excluded.username,
        providers = excluded.providers,
        email_confirmed = excluded.email_confirmed,
        last_sign_in_at = excluded.last_sign_in_at,
        updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists trg_business_os_sync_auth_profile on auth.users;
create trigger trg_business_os_sync_auth_profile
after insert or update on auth.users
for each row
execute function public.business_os_sync_auth_profile();

insert into public.business_os_profiles (
  id,
  email,
  display_name,
  avatar_url,
  local_user_id,
  username,
  providers,
  email_confirmed,
  last_sign_in_at
)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'display_name', u.raw_user_meta_data ->> 'full_name', ''),
  coalesce(u.raw_user_meta_data ->> 'avatar_url', ''),
  nullif(u.raw_user_meta_data ->> 'local_user_id', '')::bigint,
  coalesce(u.raw_user_meta_data ->> 'username', u.raw_app_meta_data ->> 'username', ''),
  to_jsonb(coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb)),
  u.email_confirmed_at is not null,
  u.last_sign_in_at
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      local_user_id = excluded.local_user_id,
      username = excluded.username,
      providers = excluded.providers,
      email_confirmed = excluded.email_confirmed,
      last_sign_in_at = excluded.last_sign_in_at,
      updated_at = timezone('utc', now());

alter table public.business_os_profiles enable row level security;
alter table public.business_os_profiles force row level security;

drop policy if exists "business_os_profiles_select_own" on public.business_os_profiles;
create policy "business_os_profiles_select_own"
on public.business_os_profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "business_os_profiles_update_own" on public.business_os_profiles;
create policy "business_os_profiles_update_own"
on public.business_os_profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

revoke all on public.business_os_profiles from anon;
revoke all on public.business_os_profiles from authenticated;
grant select, update on public.business_os_profiles to authenticated;
