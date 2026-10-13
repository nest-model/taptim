-- TAPTIM · 0100 · Core: reference data, profiles, roles, restrictions, notifications, rate limiting
-- Conventions:
--   * Every table in `public` has RLS enabled (enforced by the final hardening migration).
--   * SECURITY DEFINER functions always `set search_path = ''` and fully qualify names.
--   * Clients never set ownership columns: they default to auth.uid() and are not granted.
--   * Error messages are stable machine codes (e.g. 'rate_limited'); the client maps them to Russian text.

create extension if not exists pg_trgm with schema extensions;

-- ───────────────────────────── Enums ─────────────────────────────
create type public.listing_type as enum ('lost', 'found', 'giveaway', 'exchange', 'wanted');
create type public.listing_status as enum ('draft', 'active', 'reserved', 'resolved', 'archived', 'deleted');
create type public.moderation_state as enum ('ok', 'pending_review', 'hidden');
create type public.item_condition as enum ('new', 'good', 'used', 'for_parts');
create type public.app_role as enum ('moderator', 'admin');
create type public.restriction_kind as enum ('ban', 'posting', 'messaging', 'reporting');
create type public.notification_kind as enum (
  'message', 'giveaway_request', 'giveaway_update', 'exchange_offer', 'exchange_update',
  'claim', 'claim_update', 'listing_moderation', 'report_update', 'appeal_update', 'system'
);

-- ───────────────────────────── Utilities ─────────────────────────────
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Removes control characters (except \n, \t) and bidi-override / zero-width characters
-- used for spoofing ("text direction" attacks, invisible links).
create function public.clean_text(t text) returns text
language sql immutable set search_path = '' as $$
  select case when t is null then null else
    btrim(regexp_replace(
      regexp_replace(t, E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', '', 'g'),
      E'[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', '', 'g'))
  end
$$;

-- ───────────────────────────── Reference data ─────────────────────────────
create table public.cities (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name_ru text not null,
  name_kk text,
  is_active boolean not null default false,
  sort smallint not null default 0
);

create table public.districts (
  id text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  city_id text not null references public.cities (id),
  name_ru text not null,
  name_kk text,
  sort smallint not null default 0
);
create index districts_city_idx on public.districts (city_id, sort);

create table public.categories (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name_ru text not null,
  name_kk text,
  icon text not null default 'package',
  listing_types public.listing_type[] not null,
  -- sensitive: documents/cards — extra warnings; photos forbidden when allow_photos = false
  is_sensitive boolean not null default false,
  allow_photos boolean not null default true,
  is_active boolean not null default true,
  sort smallint not null default 0
);

-- Admin-managed list of terms that send a listing to manual review (not auto-reject).
create table public.blocked_terms (
  term text primary key check (term = lower(term) and char_length(term) between 3 and 60),
  note text
);

-- ───────────────────────────── Profiles ─────────────────────────────
-- Public profile: only fields safe to show anyone. No email/phone/flags here.
-- No FK to auth.users on purpose: on account deletion the auth row is removed,
-- while this row stays in anonymised form so chats/reports keep referential integrity.
create table public.profiles (
  id uuid primary key,
  display_name text not null check (char_length(display_name) between 2 and 40),
  avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp)$'),
  bio text check (bio is null or char_length(bio) <= 300),
  city_id text not null default 'shymkent' references public.cities (id),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Private settings: readable/editable only by the owner.
create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  terms_version text not null,
  terms_accepted_at timestamptz not null default now(),
  notify_messages boolean not null default true,
  notify_requests boolean not null default true,
  notify_offers boolean not null default true,
  notify_listing_updates boolean not null default true,
  notify_reports boolean not null default true,
  -- privacy: who may start a new conversation with me
  messages_from text not null default 'everyone' check (messages_from in ('everyone', 'interactions_only')),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger profile_private_updated_at before update on public.profile_private
  for each row execute function public.set_updated_at();

create function public.profiles_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.display_name := public.clean_text(new.display_name);
  new.bio := nullif(public.clean_text(new.bio), '');
  if tg_op = 'UPDATE' and new.id <> old.id then
    raise exception 'immutable_field' using errcode = 'P0001';
  end if;
  if not new.is_deleted and lower(new.display_name) ~ '(taptim|таптим|модератор|moderator|админ|admin|поддержка|support)' then
    raise exception 'display_name_reserved' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger profiles_before_write before insert or update on public.profiles
  for each row execute function public.profiles_before_write();

-- ───────────────────────────── Roles & restrictions ─────────────────────────────
create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.user_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.restriction_kind not null,
  reason text not null check (char_length(reason) between 3 and 500),
  expires_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references public.profiles (id)
);
create index user_restrictions_active_idx on public.user_restrictions (user_id, kind) where lifted_at is null;

-- Caller-scoped helpers (safe to expose: they only answer about the caller).
create function public.has_role(r public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and (ur.role = r or ur.role = 'admin')
  )
$$;

create function public.is_moderator() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('moderator')
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role = 'admin')
$$;

-- Internal: is user restricted for kind (a ban implies every kind).
create function public.user_is_restricted(p_user uuid, k public.restriction_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_restrictions r
    where r.user_id = p_user and r.lifted_at is null
      and (r.expires_at is null or r.expires_at > now())
      and (r.kind = k or r.kind = 'ban')
  )
$$;

create function public.i_am_restricted(k public.restriction_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.user_is_restricted((select auth.uid()), k)
$$;

-- ───────────────────────────── Rate limiting (DB-backed, global) ─────────────────────────────
-- Stored in Postgres, so limits hold across all API nodes / Edge Function instances.
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_lookup_idx on public.rate_limit_events (user_id, action, created_at desc);

create function public.enforce_rate_limit(p_user uuid, p_action text, p_max integer, p_window interval)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_user is null then
    return; -- trusted server context (service role / migrations)
  end if;
  -- serialise concurrent attempts of the same user+action
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_action, 0));
  select count(*) into n from public.rate_limit_events
   where user_id = p_user and action = p_action and created_at > now() - p_window;
  if n >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001', detail = p_action,
      hint = greatest(1, ceil(extract(epoch from p_window) / 60))::text;
  end if;
  insert into public.rate_limit_events (user_id, action) values (p_user, p_action);
end $$;

-- ───────────────────────────── Notifications ─────────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.notification_kind not null,
  title text not null check (char_length(title) <= 120),
  body text check (char_length(body) <= 300),
  -- in-app relative path only (prevents open redirects)
  link text check (link is null or link ~ '^/[A-Za-z0-9/_?=&.%-]*$'),
  ref_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where not is_read;

-- Internal: honours per-type preferences; never notifies deleted accounts.
create function public.notify(
  p_user uuid, p_kind public.notification_kind, p_title text, p_body text, p_link text, p_ref uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pp public.profile_private;
begin
  if p_user is null then return; end if;
  select * into pp from public.profile_private where user_id = p_user;
  if not found then return; end if;
  if (p_kind = 'message' and not pp.notify_messages)
     or (p_kind in ('giveaway_request', 'giveaway_update', 'claim', 'claim_update') and not pp.notify_requests)
     or (p_kind in ('exchange_offer', 'exchange_update') and not pp.notify_offers)
     or (p_kind = 'listing_moderation' and not pp.notify_listing_updates)
     or (p_kind in ('report_update', 'appeal_update') and not pp.notify_reports) then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, link, ref_id)
  values (p_user, p_kind, left(p_title, 120), left(p_body, 300), p_link, p_ref);
end $$;

-- ───────────────────────────── New user bootstrap ─────────────────────────────
-- Current terms version. Signup must send user_metadata.terms_version equal to this.
create function public.current_terms_version() returns text
language sql immutable set search_path = '' as $$ select '2026-10-13' $$;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_terms text;
begin
  v_terms := coalesce(new.raw_user_meta_data ->> 'terms_version', '');
  if v_terms <> public.current_terms_version() then
    raise exception 'terms_not_accepted' using errcode = 'P0001';
  end if;
  v_name := public.clean_text(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if char_length(v_name) < 2 or char_length(v_name) > 40
     or lower(v_name) ~ '(taptim|таптим|модератор|moderator|админ|admin|поддержка|support)' then
    v_name := 'Пользователь';
  end if;
  insert into public.profiles (id, display_name) values (new.id, v_name);
  insert into public.profile_private (user_id, terms_version) values (new.id, v_terms);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
