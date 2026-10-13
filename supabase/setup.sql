-- TAPTIM — полная установка базы одним файлом.
-- Supabase Dashboard → SQL Editor → New query → вставить ВЕСЬ файл → Run.
-- Запускать ОДИН раз на пустом проекте. Сгенерировано из supabase/migrations.

-- ════════ 20261013000100_core.sql ════════
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

-- ════════ 20261013000110_reference_data.sql ════════
-- TAPTIM · 0110 · Reference data (production data, not test seed)
-- New cities/districts/categories are added here (or by admins) — never hard-coded in components.

insert into public.cities (id, name_ru, name_kk, is_active, sort) values
  ('shymkent', 'Шымкент', 'Шымкент', true, 1),
  ('almaty', 'Алматы', 'Алматы', false, 2),
  ('astana', 'Астана', 'Астана', false, 3)
on conflict (id) do nothing;

-- Administrative districts of Shymkent + "not sure" option.
insert into public.districts (id, city_id, name_ru, name_kk, sort) values
  ('shym-abay', 'shymkent', 'Абайский район', 'Абай ауданы', 1),
  ('shym-al-farabi', 'shymkent', 'Аль-Фарабийский район', 'Әл-Фараби ауданы', 2),
  ('shym-enbekshi', 'shymkent', 'Енбекшинский район', 'Еңбекші ауданы', 3),
  ('shym-karatau', 'shymkent', 'Каратауский район', 'Қаратау ауданы', 4),
  ('shym-turan', 'shymkent', 'Туранский район', 'Тұран ауданы', 5),
  ('shym-unknown', 'shymkent', 'Не знаю / по всему городу', 'Білмеймін / бүкіл қала', 99)
on conflict (id) do nothing;

insert into public.categories (id, name_ru, name_kk, icon, listing_types, is_sensitive, allow_photos, sort) values
  ('electronics',   'Электроника',          'Электроника',            'smartphone',   '{lost,found,giveaway,exchange,wanted}', false, true, 10),
  ('phones',        'Телефоны и планшеты',  'Телефондар мен планшеттер', 'tablet-smartphone', '{lost,found}',             false, true, 11),
  ('documents',     'Документы и ключи',    'Құжаттар мен кілттер',   'key-round',    '{lost,found}',                          true,  false, 20),
  ('wallets',       'Кошельки и карты',     'Әмияндар мен карталар',  'wallet',       '{lost,found}',                          true,  true, 21),
  ('bags',          'Сумки и аксессуары',   'Сөмкелер мен аксессуарлар', 'briefcase', '{lost,found,giveaway,exchange,wanted}', false, true, 30),
  ('jewelry',       'Украшения и часы',     'Әшекейлер мен сағаттар', 'watch',        '{lost,found}',                          false, true, 31),
  ('clothes',       'Одежда и обувь',       'Киім мен аяқ киім',      'shirt',        '{lost,found,giveaway,exchange,wanted}', false, true, 40),
  ('home',          'Дом и мебель',         'Үй және жиһаз',          'sofa',         '{giveaway,exchange,wanted}',            false, true, 50),
  ('kids',          'Детские вещи',         'Балалар заттары',        'baby',         '{lost,found,giveaway,exchange,wanted}', false, true, 60),
  ('books',         'Книги и учёба',        'Кітаптар және оқу',      'book-open',    '{lost,found,giveaway,exchange,wanted}', false, true, 70),
  ('sport',         'Спорт',                'Спорт',                  'dumbbell',     '{lost,found,giveaway,exchange,wanted}', false, true, 80),
  ('pets',          'Домашние животные',    'Үй жануарлары',          'paw-print',    '{lost,found,giveaway,exchange,wanted}', false, true, 90),
  ('other',         'Прочее',               'Басқа',                  'package',      '{lost,found,giveaway,exchange,wanted}', false, true, 100)
on conflict (id) do nothing;

-- Terms that trigger manual review (Kazakhstan law: weapons, drugs, prescription meds, documents for sale, etc.).
insert into public.blocked_terms (term, note) values
  ('пистолет', 'оружие'), ('оружие', 'оружие'), ('патрон', 'боеприпасы'), ('травмат', 'оружие'),
  ('наркот', 'наркотики'), ('закладк', 'наркотики'), ('марихуан', 'наркотики'), ('спайс', 'наркотики'),
  ('рецептурн', 'лекарства'), ('продам паспорт', 'документы'), ('куплю паспорт', 'документы'),
  ('фальшив', 'подделки'), ('предоплат', 'мошенничество'), ('переведите деньги', 'мошенничество'),
  ('kaspi перевод', 'мошенничество'), ('интим', '18+')
on conflict (term) do nothing;

-- ════════ 20261013000200_listings.sql ════════
-- TAPTIM · 0200 · Listings, photos, favorites, search

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles (id),
  type public.listing_type not null,
  status public.listing_status not null default 'draft',
  moderation_state public.moderation_state not null default 'ok',
  category_id text references public.categories (id),
  city_id text not null default 'shymkent' references public.cities (id),
  district_id text references public.districts (id),
  -- approximate landmark ("возле ТРЦ"), never an exact home address
  place_hint text check (place_hint is null or char_length(place_hint) <= 120),
  title text not null default '' check (char_length(title) <= 120),
  description text not null default '' check (char_length(description) <= 3000),
  event_date date,                         -- lost/found: when it was lost/found
  item_condition public.item_condition,    -- giveaway/exchange
  quantity smallint check (quantity between 1 and 50),
  quantity_available smallint check (quantity_available >= 0),
  exchange_wish text check (exchange_wish is null or char_length(exchange_wish) <= 500),
  wanted_until date,                       -- wanted: relevance deadline
  is_valuable boolean not null default false, -- found: owner must pass a claim before contact
  published_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('russian'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('russian'::regconfig, coalesce(description, '')), 'B')
  ) stored,
  -- Server-side completeness: nothing incomplete can leave draft.
  constraint listings_publishable check (
    status in ('draft', 'deleted') or (
      char_length(title) >= 3 and char_length(description) >= 10
      and category_id is not null and district_id is not null
      and (type not in ('lost', 'found') or event_date is not null)
      and (type not in ('giveaway', 'exchange') or item_condition is not null)
      and (type <> 'giveaway' or (quantity is not null and quantity_available is not null and quantity_available <= quantity))
      and (type <> 'exchange' or char_length(coalesce(exchange_wish, '')) >= 3)
      and (type <> 'wanted' or wanted_until is not null)
    )
  ),
  constraint listings_valuable_only_found check (not is_valuable or type = 'found')
);

create index listings_feed_idx on public.listings (city_id, type, status, published_at desc);
create index listings_author_idx on public.listings (author_id, created_at desc);
create index listings_category_idx on public.listings (category_id, published_at desc);
create index listings_district_idx on public.listings (district_id, published_at desc);
create index listings_event_date_idx on public.listings (event_date) where event_date is not null;
create index listings_expires_idx on public.listings (expires_at);
create index listings_moderation_idx on public.listings (moderation_state) where moderation_state <> 'ok';
create index listings_search_idx on public.listings using gin (search_vector);
create index listings_title_trgm_idx on public.listings using gin (title extensions.gin_trgm_ops);

create trigger listings_updated_at before update on public.listings
  for each row execute function public.set_updated_at();

-- Allowed status transitions (enforced for every writer, including RPCs).
create function public.listing_transition_allowed(f public.listing_status, t public.listing_status)
returns boolean language sql immutable set search_path = '' as $$
  select f = t or t = 'deleted' or (f, t) in (
    ('draft', 'active'),
    ('active', 'reserved'), ('active', 'resolved'), ('active', 'archived'),
    ('reserved', 'active'), ('reserved', 'resolved'), ('reserved', 'archived'),
    ('resolved', 'archived'),
    ('archived', 'active')
  )
$$;

create function public.listings_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cat public.categories;
  bump boolean := false;
begin
  new.title := coalesce(public.clean_text(new.title), '');
  new.description := coalesce(public.clean_text(new.description), '');
  new.place_hint := nullif(public.clean_text(new.place_hint), '');
  new.exchange_wish := nullif(public.clean_text(new.exchange_wish), '');

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'active') then
      raise exception 'invalid_status' using errcode = 'P0001';
    end if;
    perform public.enforce_rate_limit(uid, 'listing_create_hour', 6, interval '1 hour');
    perform public.enforce_rate_limit(uid, 'listing_create_day', 20, interval '1 day');
    if new.type = 'giveaway' and new.quantity is null then new.quantity := 1; end if;
    if new.type = 'giveaway' and new.quantity_available is null then new.quantity_available := new.quantity; end if;
  else
    if new.author_id <> old.author_id or new.type <> old.type or new.created_at <> old.created_at then
      raise exception 'immutable_field' using errcode = 'P0001';
    end if;
    if old.status = 'deleted' then
      raise exception 'listing_deleted' using errcode = 'P0001';
    end if;
    if not public.listing_transition_allowed(old.status, new.status) then
      raise exception 'invalid_transition' using errcode = 'P0001', detail = old.status || '->' || new.status;
    end if;
  end if;

  -- Type-specific field hygiene: fields of other types are cleared, not trusted.
  if new.type not in ('lost', 'found') then new.event_date := null; end if;
  if new.type not in ('giveaway', 'exchange') then new.item_condition := null; end if;
  if new.type <> 'giveaway' then new.quantity := null; new.quantity_available := null; end if;
  if new.type <> 'exchange' then new.exchange_wish := null; end if;
  if new.type <> 'wanted' then new.wanted_until := null; end if;
  if new.type <> 'found' then new.is_valuable := false; end if;

  if new.category_id is not null then
    select * into cat from public.categories where id = new.category_id;
    if not found or not cat.is_active or not (new.type = any (cat.listing_types)) then
      raise exception 'invalid_category' using errcode = 'P0001';
    end if;
  end if;
  if new.district_id is not null
     and not exists (select 1 from public.districts d where d.id = new.district_id and d.city_id = new.city_id) then
    raise exception 'invalid_district' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cities c where c.id = new.city_id and c.is_active) then
    raise exception 'city_not_available' using errcode = 'P0001';
  end if;

  -- Relative-date rules (cannot be CHECK constraints).
  if new.event_date is not null and (tg_op = 'INSERT' or new.event_date is distinct from old.event_date) then
    if new.event_date > current_date or new.event_date < current_date - 365 then
      raise exception 'invalid_event_date' using errcode = 'P0001';
    end if;
  end if;
  if new.wanted_until is not null and (tg_op = 'INSERT' or new.wanted_until is distinct from old.wanted_until) then
    if new.wanted_until < current_date or new.wanted_until > current_date + 90 then
      raise exception 'invalid_wanted_until' using errcode = 'P0001';
    end if;
  end if;

  -- Publication lifecycle.
  if new.status = 'active' then
    if tg_op = 'INSERT' or old.status = 'draft' then
      bump := true;
    elsif old.status = 'archived' or (old.status = 'active' and old.expires_at <= now()) then
      if coalesce(current_setting('taptim.republish', true), '') = 'on' then
        perform public.enforce_rate_limit(uid, 'listing_republish', 10, interval '1 day');
        if old.published_at > now() - interval '24 hours' then
          raise exception 'republish_too_soon' using errcode = 'P0001';
        end if;
        bump := true;
      elsif old.status = 'archived' and old.expires_at <= now() then
        raise exception 'listing_expired_use_republish' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if bump then
    new.published_at := now();
    new.expires_at := case
      when new.type = 'wanted' then (new.wanted_until + 1)::timestamptz
      else now() + interval '30 days' end;
    new.resolved_at := null;
  elsif new.type = 'wanted' and new.status in ('active', 'reserved') and new.wanted_until is not null then
    new.expires_at := (new.wanted_until + 1)::timestamptz;
  end if;
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status <> 'resolved') then
    new.resolved_at := now();
  end if;

  -- Possibly prohibited content → manual review (no auto-ban on one signal).
  if new.status in ('active', 'reserved') and new.moderation_state = 'ok'
     and (tg_op = 'INSERT' or new.title <> old.title or new.description <> old.description or old.status = 'draft')
     and exists (
       select 1 from public.blocked_terms b
       where position(b.term in lower(new.title || ' ' || new.description)) > 0
     ) then
    new.moderation_state := 'pending_review';
  end if;
  return new;
end $$;

create trigger listings_before_write before insert or update on public.listings
  for each row execute function public.listings_before_write();

create function public.listings_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.moderation_state = 'pending_review'
     and (tg_op = 'INSERT' or old.moderation_state is distinct from 'pending_review') then
    perform public.notify(new.author_id, 'listing_moderation', 'Объявление на проверке',
      'Мы проверим «' || left(new.title, 60) || '» и опубликуем его, если всё в порядке.',
      '/listing/' || new.id, new.id);
  end if;
  return null;
end $$;

create trigger listings_after_write after insert or update on public.listings
  for each row execute function public.listings_after_write();

-- Republish an expired/archived listing (bumps it to the top, rate-limited).
create function public.republish_listing(p_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
begin
  perform set_config('taptim.republish', 'on', true);
  update public.listings set status = 'active'
   where id = p_id and author_id = (select auth.uid()) and moderation_state <> 'hidden'
     and (status = 'archived' or (status = 'active' and expires_at <= now()));
  get diagnostics n = row_count;
  perform set_config('taptim.republish', 'off', true);
  if n = 0 then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end $$;

-- Delete own listing: drafts are removed; published ones are soft-deleted (kept for report handling,
-- invisible to everyone but moderators). Photos are removed by the `photos` Edge Function.
create function public.delete_my_listing(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = p_id and author_id = (select auth.uid()) for update;
  if not found or l.status = 'deleted' then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if l.status = 'draft' then
    delete from public.listings where id = l.id;
    return 'deleted';
  end if;
  update public.listings set status = 'deleted' where id = l.id;
  update public.giveaway_requests set status = 'declined' where listing_id = l.id and status in ('pending', 'approved');
  update public.exchange_offers set status = 'declined' where listing_id = l.id and status in ('pending', 'accepted');
  update public.ownership_claims set status = 'rejected' where listing_id = l.id and status in ('pending', 'approved');
  return 'soft_deleted';
end $$;

-- ───────────────────────────── Photos ─────────────────────────────
-- Rows are written ONLY by the `photos` Edge Function (service role) after
-- server-side validation + metadata stripping. Clients can read and reorder.
create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  owner_id uuid not null references public.profiles (id),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp)$'),
  width integer check (width between 1 and 10000),
  height integer check (height between 1 and 10000),
  sort smallint not null default 0 check (sort between 0 and 20),
  created_at timestamptz not null default now()
);
create index listing_photos_listing_idx on public.listing_photos (listing_id, sort);

create function public.listing_photos_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.listing_photos where listing_id = new.listing_id) >= 8 then
    raise exception 'too_many_photos' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger listing_photos_limit before insert on public.listing_photos
  for each row execute function public.listing_photos_limit();

-- ───────────────────────────── Favorites ─────────────────────────────
create table public.favorites (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index favorites_user_idx on public.favorites (user_id, created_at desc);

create function public.favorites_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.enforce_rate_limit(auth.uid(), 'favorite', 120, interval '1 hour');
  return new;
end $$;
create trigger favorites_rate_limit before insert on public.favorites
  for each row execute function public.favorites_rate_limit();

-- ───────────────────────────── Card view & search ─────────────────────────────
-- security_invoker: RLS of the caller applies to every underlying table.
create view public.listing_cards with (security_invoker = true) as
select
  l.id, l.author_id, l.type, l.status, l.moderation_state, l.category_id, l.city_id, l.district_id,
  l.place_hint, l.title, left(l.description, 220) as excerpt, l.event_date, l.item_condition,
  l.quantity, l.quantity_available, l.wanted_until, l.is_valuable, l.published_at, l.expires_at,
  l.resolved_at, l.created_at, l.updated_at,
  p.display_name as author_name,
  p.avatar_path as author_avatar,
  (select ph.storage_path from public.listing_photos ph
    where ph.listing_id = l.id order by ph.sort, ph.created_at limit 1) as cover_path,
  (select count(*) from public.listing_photos ph where ph.listing_id = l.id)::integer as photo_count
from public.listings l
join public.profiles p on p.id = l.author_id;

create function public.search_listings(
  p_query text default null,
  p_types public.listing_type[] default null,
  p_category text default null,
  p_district text default null,
  p_city text default 'shymkent',
  p_date_from date default null,
  p_date_to date default null,
  p_include_closed boolean default false,
  p_sort text default 'new',
  p_limit integer default 20,
  p_offset integer default 0
) returns setof public.listing_cards
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_q text := nullif(btrim(left(coalesce(p_query, ''), 100)), '');
  v_ts tsquery;
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 2000);
begin
  if p_sort not in ('new', 'relevance', 'event_date') then
    raise exception 'invalid_sort' using errcode = 'P0001';
  end if;
  if v_q is not null then
    v_ts := websearch_to_tsquery('russian'::regconfig, v_q);
    -- escape LIKE metacharacters so user input is matched literally
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select c.*
    from public.listing_cards c
    join public.listings l on l.id = c.id
   where l.city_id = coalesce(p_city, 'shymkent')
     and l.status in ('active', 'reserved', 'resolved')
     and l.moderation_state = 'ok'
     and (p_include_closed or (l.status in ('active', 'reserved') and (l.expires_at is null or l.expires_at > now())))
     and (p_types is null or cardinality(p_types) = 0 or l.type = any (p_types))
     and (p_category is null or l.category_id = p_category)
     and (p_district is null or l.district_id = p_district)
     and (p_date_from is null or coalesce(l.event_date, l.published_at::date) >= p_date_from)
     and (p_date_to is null or coalesce(l.event_date, l.published_at::date) <= p_date_to)
     and (v_q is null or l.search_vector @@ v_ts or l.title ilike v_like)
   order by
     case when p_sort = 'relevance' and v_q is not null then ts_rank(l.search_vector, v_ts) end desc nulls last,
     case when p_sort = 'event_date' then coalesce(l.event_date, l.published_at::date) end desc nulls last,
     l.published_at desc nulls last,
     l.id
   limit v_limit offset v_offset;
end $$;

-- Possible matches for the caller's own listing: lost↔found, wanted↔giveaway/exchange.
create function public.listing_matches(p_listing uuid, p_limit integer default 10)
returns setof public.listing_cards
language plpgsql stable security invoker set search_path = '' as $$
declare
  src public.listings;
begin
  select * into src from public.listings where id = p_listing and author_id = (select auth.uid());
  if not found or src.category_id is null then return; end if;
  return query
  select c.* from public.listing_cards c
   where c.id <> src.id and c.author_id <> src.author_id
     and c.city_id = src.city_id and c.category_id = src.category_id
     and c.status in ('active', 'reserved') and c.moderation_state = 'ok'
     and (c.expires_at is null or c.expires_at > now())
     and (
       (src.type = 'lost' and c.type = 'found' and c.event_date >= src.event_date - 3)
       or (src.type = 'found' and c.type = 'lost' and c.event_date <= src.event_date + 3)
       or (src.type = 'wanted' and c.type in ('giveaway', 'exchange'))
       or (src.type in ('giveaway', 'exchange') and c.type = 'wanted')
     )
   order by (c.district_id = src.district_id) desc, c.published_at desc
   limit least(greatest(p_limit, 1), 20);
end $$;

-- Personal recommendations from the caller's own signals (favorites + wanted requests).
-- Returns nothing when there is not enough data — the UI then hides the block.
create function public.recommended_listings(p_limit integer default 8)
returns setof public.listing_cards
language plpgsql stable security invoker set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  cats text[];
begin
  if uid is null then return; end if;
  select array_agg(distinct category_id) into cats from (
    (select l.category_id from public.favorites f join public.listings l on l.id = f.listing_id
      where f.user_id = uid order by f.created_at desc limit 30)
    union all
    (select l.category_id from public.listings l
      where l.author_id = uid and l.type = 'wanted' and l.status = 'active')
  ) s where category_id is not null;
  if cats is null or cardinality(cats) = 0 then return; end if;
  return query
  select c.* from public.listing_cards c
   where c.category_id = any (cats) and c.author_id <> uid
     and c.type in ('giveaway', 'exchange', 'found')
     and c.status = 'active' and c.moderation_state = 'ok'
     and (c.expires_at is null or c.expires_at > now())
     and not exists (select 1 from public.favorites f where f.user_id = uid and f.listing_id = c.id)
   order by c.published_at desc
   limit least(greatest(p_limit, 1), 20);
end $$;

-- ════════ 20261013000300_interactions.sql ════════
-- TAPTIM · 0300 · Blocks, giveaway requests (queue), exchange offers, ownership claims
-- All state changes go through SECURITY DEFINER RPCs that check the actor and lock the row:
-- clients have INSERT (own rows) and SELECT (own side) only — never UPDATE.

-- ───────────────────────────── Blocks ─────────────────────────────
create table public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- Internal: block in either direction.
create function public.users_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  )
$$;

-- Caller-scoped: is there a block between me and `other`?
create function public.blocked_with(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.users_blocked((select auth.uid()), other)
$$;

create function public.blocks_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.enforce_rate_limit(auth.uid(), 'block', 30, interval '1 day');
  return new;
end $$;
create trigger blocks_rate_limit before insert on public.blocks
  for each row execute function public.blocks_rate_limit();

-- ───────────────────────────── Giveaway requests ─────────────────────────────
create type public.request_status as enum ('pending', 'approved', 'declined', 'cancelled', 'completed');

create table public.giveaway_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  requester_id uuid not null default auth.uid() references public.profiles (id),
  message text check (message is null or char_length(message) <= 500),
  quantity smallint not null default 1 check (quantity between 1 and 10),
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index giveaway_requests_open_uniq on public.giveaway_requests (listing_id, requester_id)
  where status in ('pending', 'approved');
create index giveaway_requests_listing_idx on public.giveaway_requests (listing_id, status, created_at);
create index giveaway_requests_requester_idx on public.giveaway_requests (requester_id, created_at desc);
create trigger giveaway_requests_updated_at before update on public.giveaway_requests
  for each row execute function public.set_updated_at();

create function public.giveaway_requests_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
begin
  new.message := nullif(public.clean_text(new.message), '');
  new.status := 'pending';
  select * into l from public.listings where id = new.listing_id;
  if not found or l.type <> 'giveaway' or l.status <> 'active' or l.moderation_state <> 'ok'
     or l.expires_at <= now() then
    raise exception 'listing_unavailable' using errcode = 'P0001';
  end if;
  if l.author_id = new.requester_id then
    raise exception 'own_listing' using errcode = 'P0001';
  end if;
  if public.users_blocked(l.author_id, new.requester_id) then
    raise exception 'blocked' using errcode = 'P0001';
  end if;
  if new.quantity > l.quantity_available then
    raise exception 'quantity_unavailable' using errcode = 'P0001';
  end if;
  perform public.enforce_rate_limit(new.requester_id, 'giveaway_request', 20, interval '1 day');
  return new;
end $$;
create trigger giveaway_requests_before_insert before insert on public.giveaway_requests
  for each row execute function public.giveaway_requests_before_insert();

create function public.giveaway_requests_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = new.listing_id;
  perform public.notify(l.author_id, 'giveaway_request', 'Новый запрос на вещь',
    'Кто-то хочет забрать «' || left(l.title, 60) || '».', '/listing/' || l.id, new.id);
  return null;
end $$;
create trigger giveaway_requests_after_insert after insert on public.giveaway_requests
  for each row execute function public.giveaway_requests_after_insert();

-- Position in the queue (1 = next). Only the requester or the listing author may ask.
create function public.giveaway_queue_position(p_request uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.giveaway_requests;
  author uuid;
begin
  select * into r from public.giveaway_requests where id = p_request;
  if not found then return null; end if;
  select author_id into author from public.listings where id = r.listing_id;
  if (select auth.uid()) not in (r.requester_id, author) or r.status not in ('pending', 'approved') then
    return null;
  end if;
  return (select count(*) from public.giveaway_requests g
           where g.listing_id = r.listing_id and g.status in ('pending', 'approved')
             and (g.created_at, g.id) <= (r.created_at, r.id))::integer;
end $$;

-- actions: requester → 'cancel'; author → 'approve' | 'decline' | 'complete'
create function public.giveaway_request_action(p_request uuid, p_action text) returns public.request_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.giveaway_requests;
  g public.giveaway_requests;
  l public.listings;
  next_status public.request_status;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into r from public.giveaway_requests where id = p_request for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into l from public.listings where id = r.listing_id for update;

  if p_action = 'cancel' and uid = r.requester_id and r.status in ('pending', 'approved') then
    next_status := 'cancelled';
  elsif uid = l.author_id and p_action = 'approve' and r.status = 'pending' then
    if l.status not in ('active', 'reserved') then raise exception 'listing_unavailable' using errcode = 'P0001'; end if;
    if r.quantity > l.quantity_available then raise exception 'quantity_unavailable' using errcode = 'P0001'; end if;
    next_status := 'approved';
  elsif uid = l.author_id and p_action = 'decline' and r.status in ('pending', 'approved') then
    next_status := 'declined';
  elsif uid = l.author_id and p_action = 'complete' and r.status = 'approved' then
    next_status := 'completed';
  else
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.giveaway_requests set status = next_status where id = r.id;

  if next_status = 'completed' then
    update public.listings
       set quantity_available = greatest(quantity_available - r.quantity, 0)
     where id = l.id
     returning * into l;
    if l.quantity_available = 0 then
      update public.listings set status = 'resolved' where id = l.id;
      -- the rest of the queue gets a polite decline
      for g in
        update public.giveaway_requests set status = 'declined'
         where listing_id = l.id and status in ('pending', 'approved') and id <> r.id
        returning *
      loop
        perform public.notify(g.requester_id, 'giveaway_update', 'Вещь уже передана',
          '«' || left(l.title, 60) || '» передано другому человеку.', '/listing/' || l.id, g.id);
      end loop;
    end if;
  end if;

  if uid = l.author_id then
    perform public.notify(r.requester_id, 'giveaway_update',
      case next_status
        when 'approved' then 'Запрос одобрен'
        when 'declined' then 'Запрос отклонён'
        else 'Передача подтверждена' end,
      '«' || left(l.title, 60) || '»', '/listing/' || l.id, r.id);
  else
    perform public.notify(l.author_id, 'giveaway_update', 'Запрос отменён',
      '«' || left(l.title, 60) || '»', '/listing/' || l.id, r.id);
  end if;
  return next_status;
end $$;

-- ───────────────────────────── Exchange offers ─────────────────────────────
create type public.offer_status as enum ('pending', 'accepted', 'declined', 'cancelled', 'completed');

create table public.exchange_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  offerer_id uuid not null default auth.uid() references public.profiles (id),
  offered_listing_id uuid references public.listings (id) on delete set null,
  message text not null check (char_length(message) between 3 and 1000),
  status public.offer_status not null default 'pending',
  author_confirmed_at timestamptz,
  offerer_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index exchange_offers_open_uniq on public.exchange_offers (listing_id, offerer_id)
  where status in ('pending', 'accepted');
create index exchange_offers_listing_idx on public.exchange_offers (listing_id, status, created_at);
create index exchange_offers_offerer_idx on public.exchange_offers (offerer_id, created_at desc);
create trigger exchange_offers_updated_at before update on public.exchange_offers
  for each row execute function public.set_updated_at();

create function public.exchange_offers_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
  o public.listings;
begin
  new.message := public.clean_text(new.message);
  new.status := 'pending';
  new.author_confirmed_at := null;
  new.offerer_confirmed_at := null;
  select * into l from public.listings where id = new.listing_id;
  if not found or l.type <> 'exchange' or l.status <> 'active' or l.moderation_state <> 'ok'
     or l.expires_at <= now() then
    raise exception 'listing_unavailable' using errcode = 'P0001';
  end if;
  if l.author_id = new.offerer_id then raise exception 'own_listing' using errcode = 'P0001'; end if;
  if public.users_blocked(l.author_id, new.offerer_id) then raise exception 'blocked' using errcode = 'P0001'; end if;
  if new.offered_listing_id is not null then
    select * into o from public.listings where id = new.offered_listing_id;
    if not found or o.author_id <> new.offerer_id or o.type <> 'exchange' or o.status <> 'active'
       or o.moderation_state <> 'ok' then
      raise exception 'invalid_offered_listing' using errcode = 'P0001';
    end if;
  end if;
  perform public.enforce_rate_limit(new.offerer_id, 'exchange_offer', 20, interval '1 day');
  return new;
end $$;
create trigger exchange_offers_before_insert before insert on public.exchange_offers
  for each row execute function public.exchange_offers_before_insert();

create function public.exchange_offers_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = new.listing_id;
  perform public.notify(l.author_id, 'exchange_offer', 'Новое предложение обмена',
    'На «' || left(l.title, 60) || '» предложили обмен.', '/listing/' || l.id, new.id);
  return null;
end $$;
create trigger exchange_offers_after_insert after insert on public.exchange_offers
  for each row execute function public.exchange_offers_after_insert();

-- actions: author → 'accept' | 'decline'; offerer → 'cancel'; both → 'confirm' (after accept)
create function public.exchange_offer_action(p_offer uuid, p_action text) returns public.offer_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  x public.exchange_offers;
  l public.listings;
  next_status public.offer_status;
  other uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into x from public.exchange_offers where id = p_offer for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into l from public.listings where id = x.listing_id for update;

  if uid = l.author_id and p_action = 'accept' and x.status = 'pending' then
    if l.status <> 'active' then raise exception 'listing_unavailable' using errcode = 'P0001'; end if;
    next_status := 'accepted';
    update public.listings set status = 'reserved' where id = l.id;
  elsif uid = l.author_id and p_action = 'decline' and x.status in ('pending', 'accepted') then
    next_status := 'declined';
  elsif uid = x.offerer_id and p_action = 'cancel' and x.status in ('pending', 'accepted') then
    next_status := 'cancelled';
  elsif p_action = 'confirm' and x.status = 'accepted' and uid in (l.author_id, x.offerer_id) then
    if uid = l.author_id then
      update public.exchange_offers set author_confirmed_at = coalesce(author_confirmed_at, now())
       where id = x.id returning * into x;
    else
      update public.exchange_offers set offerer_confirmed_at = coalesce(offerer_confirmed_at, now())
       where id = x.id returning * into x;
    end if;
    if x.author_confirmed_at is not null and x.offerer_confirmed_at is not null then
      next_status := 'completed';
    else
      next_status := 'accepted';
    end if;
  else
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.exchange_offers set status = next_status where id = x.id;

  if next_status in ('declined', 'cancelled') and x.status = 'accepted' and l.status = 'reserved'
     and not exists (select 1 from public.exchange_offers
                      where listing_id = l.id and status = 'accepted' and id <> x.id) then
    update public.listings set status = 'active' where id = l.id;
  end if;

  if next_status = 'completed' then
    update public.listings set status = 'resolved' where id = l.id and status in ('active', 'reserved');
    if x.offered_listing_id is not null then
      update public.listings set status = 'resolved'
       where id = x.offered_listing_id and author_id = x.offerer_id and status in ('active', 'reserved');
    end if;
    update public.exchange_offers set status = 'declined'
     where listing_id = l.id and id <> x.id and status in ('pending', 'accepted');
  end if;

  other := case when uid = l.author_id then x.offerer_id else l.author_id end;
  perform public.notify(other, 'exchange_update',
    case
      when next_status = 'accepted' and p_action = 'accept' then 'Предложение обмена принято'
      when next_status = 'accepted' then 'Собеседник подтвердил обмен'
      when next_status = 'declined' then 'Предложение обмена отклонено'
      when next_status = 'cancelled' then 'Предложение обмена отменено'
      else 'Обмен завершён' end,
    '«' || left(l.title, 60) || '»', '/listing/' || l.id, x.id);
  return next_status;
end $$;

-- ───────────────────────────── Ownership claims (found items) ─────────────────────────────
create type public.claim_status as enum ('pending', 'approved', 'rejected', 'cancelled', 'returned');

create table public.ownership_claims (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  claimant_id uuid not null default auth.uid() references public.profiles (id),
  -- private proof: distinguishing details only the owner knows. Visible to claimant + finder only.
  proof text not null check (char_length(proof) between 10 and 1000),
  status public.claim_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index ownership_claims_open_uniq on public.ownership_claims (listing_id, claimant_id)
  where status in ('pending', 'approved');
create index ownership_claims_listing_idx on public.ownership_claims (listing_id, status, created_at);
create index ownership_claims_claimant_idx on public.ownership_claims (claimant_id, created_at desc);
create trigger ownership_claims_updated_at before update on public.ownership_claims
  for each row execute function public.set_updated_at();

create function public.ownership_claims_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
begin
  new.proof := public.clean_text(new.proof);
  new.status := 'pending';
  new.decided_at := null;
  select * into l from public.listings where id = new.listing_id;
  if not found or l.type <> 'found' or l.status not in ('active', 'reserved') or l.moderation_state <> 'ok' then
    raise exception 'listing_unavailable' using errcode = 'P0001';
  end if;
  if l.author_id = new.claimant_id then raise exception 'own_listing' using errcode = 'P0001'; end if;
  if public.users_blocked(l.author_id, new.claimant_id) then raise exception 'blocked' using errcode = 'P0001'; end if;
  perform public.enforce_rate_limit(new.claimant_id, 'ownership_claim', 10, interval '1 day');
  return new;
end $$;
create trigger ownership_claims_before_insert before insert on public.ownership_claims
  for each row execute function public.ownership_claims_before_insert();

create function public.ownership_claims_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = new.listing_id;
  perform public.notify(l.author_id, 'claim', 'Кто-то узнал свою вещь',
    'Проверьте описание приметы по находке «' || left(l.title, 60) || '».', '/listing/' || l.id, new.id);
  return null;
end $$;
create trigger ownership_claims_after_insert after insert on public.ownership_claims
  for each row execute function public.ownership_claims_after_insert();

-- actions: finder → 'approve' | 'reject' | 'returned'; claimant → 'cancel'
create function public.ownership_claim_action(p_claim uuid, p_action text) returns public.claim_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.ownership_claims;
  l public.listings;
  next_status public.claim_status;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.ownership_claims where id = p_claim for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into l from public.listings where id = c.listing_id for update;

  if uid = l.author_id and p_action = 'approve' and c.status = 'pending' then
    next_status := 'approved';
    update public.listings set status = 'reserved' where id = l.id and status = 'active';
  elsif uid = l.author_id and p_action = 'reject' and c.status in ('pending', 'approved') then
    next_status := 'rejected';
  elsif uid = l.author_id and p_action = 'returned' and c.status = 'approved' then
    next_status := 'returned';
    update public.listings set status = 'resolved' where id = l.id and status in ('active', 'reserved');
    update public.ownership_claims set status = 'rejected', decided_at = now()
     where listing_id = l.id and id <> c.id and status in ('pending', 'approved');
  elsif uid = c.claimant_id and p_action = 'cancel' and c.status in ('pending', 'approved') then
    next_status := 'cancelled';
  else
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.ownership_claims set status = next_status, decided_at = now() where id = c.id;

  if next_status in ('rejected', 'cancelled') and c.status = 'approved' and l.status = 'reserved'
     and not exists (select 1 from public.ownership_claims
                      where listing_id = l.id and status = 'approved' and id <> c.id) then
    update public.listings set status = 'active' where id = l.id;
  end if;

  if uid = l.author_id then
    perform public.notify(c.claimant_id, 'claim_update',
      case next_status
        when 'approved' then 'Нашедший подтвердил вашу заявку'
        when 'rejected' then 'Заявка на находку отклонена'
        else 'Вещь возвращена владельцу' end,
      '«' || left(l.title, 60) || '»', '/listing/' || l.id, c.id);
  else
    perform public.notify(l.author_id, 'claim_update', 'Заявка на находку отменена',
      '«' || left(l.title, 60) || '»', '/listing/' || l.id, c.id);
  end if;
  return next_status;
end $$;

-- ════════ 20261013000400_chat.sql ════════
-- TAPTIM · 0400 · Private chats
-- Conversations are created ONLY by start_conversation() (checks listing, blocks, privacy, rate limits).
-- Messages are readable only by members — enforced by RLS, so changing an ID in a request does nothing.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings (id) on delete set null,
  user_low uuid not null references public.profiles (id),
  user_high uuid not null references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_preview text,
  check (user_low < user_high)
);
create unique index conversations_pair_listing_uniq
  on public.conversations (user_low, user_high, coalesce(listing_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id),
  body text not null check (char_length(body) between 1 and 2000),
  -- client-generated idempotency key: a retried send never duplicates a message
  client_id uuid not null,
  created_at timestamptz not null default now(),
  unique (sender_id, client_id)
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);

-- Caller-scoped membership check (SECURITY DEFINER avoids policy recursion).
create function public.is_conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation and user_id = (select auth.uid())
  )
$$;

-- Caller-scoped: is the conversation frozen by a block (either direction)?
create function public.conversation_blocked(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conversation
       and (select auth.uid()) in (c.user_low, c.user_high)
       and public.users_blocked(c.user_low, c.user_high)
  )
$$;

create function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.body := public.clean_text(new.body);
  if new.body is null or char_length(new.body) = 0 then
    raise exception 'empty_message' using errcode = 'P0001';
  end if;
  new.created_at := now();
  perform public.enforce_rate_limit(new.sender_id, 'message_minute', 20, interval '1 minute');
  perform public.enforce_rate_limit(new.sender_id, 'message_day', 400, interval '1 day');
  return new;
end $$;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

create function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.conversations;
  other uuid;
  sender_name text;
begin
  update public.conversations
     set last_message_at = new.created_at, last_message_preview = left(new.body, 90)
   where id = new.conversation_id
  returning * into c;
  update public.conversation_members set last_read_at = new.created_at
   where conversation_id = new.conversation_id and user_id = new.sender_id;
  other := case when c.user_low = new.sender_id then c.user_high else c.user_low end;
  -- one unread "new messages" notification per conversation, not one per message
  if not exists (select 1 from public.notifications
                  where user_id = other and kind = 'message' and ref_id = c.id and not is_read) then
    select display_name into sender_name from public.profiles where id = new.sender_id;
    perform public.notify(other, 'message', 'Новое сообщение',
      coalesce(sender_name, 'Пользователь') || ' написал(а) вам', '/chats/' || c.id, c.id);
  end if;
  return null;
end $$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- Start (or reuse) a conversation about a listing.
--   * caller is not the author → talks to the author;
--   * caller is the author → may write to someone who interacted with the listing (p_other).
create function public.start_conversation(p_listing uuid, p_other uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  l public.listings;
  other uuid;
  conv uuid;
  lo uuid;
  hi uuid;
  interacted boolean;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if public.user_is_restricted(uid, 'messaging') then raise exception 'restricted' using errcode = 'P0001'; end if;

  select * into l from public.listings where id = p_listing;
  if not found or l.status in ('draft', 'deleted') or l.moderation_state <> 'ok' then
    raise exception 'listing_unavailable' using errcode = 'P0001';
  end if;

  if uid = l.author_id then
    other := p_other;
    if other is null or other = uid then raise exception 'invalid_recipient' using errcode = 'P0001'; end if;
  else
    other := l.author_id;
  end if;

  interacted := exists (select 1 from public.giveaway_requests where listing_id = l.id
                          and requester_id = case when uid = l.author_id then other else uid end
                          and status in ('pending', 'approved', 'completed'))
             or exists (select 1 from public.exchange_offers where listing_id = l.id
                          and offerer_id = case when uid = l.author_id then other else uid end
                          and status in ('pending', 'accepted', 'completed'))
             or exists (select 1 from public.ownership_claims where listing_id = l.id
                          and claimant_id = case when uid = l.author_id then other else uid end
                          and status in ('pending', 'approved', 'returned'));

  if uid = l.author_id and not interacted then
    raise exception 'invalid_recipient' using errcode = 'P0001';
  end if;
  -- Valuable found item: contact only after an ownership claim (protects the real owner).
  if l.type = 'found' and l.is_valuable and uid <> l.author_id and not interacted then
    raise exception 'claim_required' using errcode = 'P0001';
  end if;
  if public.users_blocked(uid, other) then raise exception 'blocked' using errcode = 'P0001'; end if;
  if exists (select 1 from public.profiles where id = other and is_deleted) then
    raise exception 'recipient_unavailable' using errcode = 'P0001';
  end if;
  if not interacted and exists (select 1 from public.profile_private
                                  where user_id = other and messages_from = 'interactions_only') then
    raise exception 'messages_disabled' using errcode = 'P0001';
  end if;

  lo := least(uid, other);
  hi := greatest(uid, other);
  select id into conv from public.conversations
   where user_low = lo and user_high = hi and listing_id = l.id;
  if conv is not null then return conv; end if;

  perform public.enforce_rate_limit(uid, 'conversation_hour', 15, interval '1 hour');
  perform public.enforce_rate_limit(uid, 'conversation_day', 40, interval '1 day');

  insert into public.conversations (listing_id, user_low, user_high, created_by)
  values (l.id, lo, hi, uid)
  on conflict do nothing
  returning id into conv;
  if conv is null then
    select id into conv from public.conversations where user_low = lo and user_high = hi and listing_id = l.id;
    return conv;
  end if;
  insert into public.conversation_members (conversation_id, user_id, last_read_at)
  values (conv, uid, now()), (conv, other, '-infinity');
  return conv;
end $$;

create function public.mark_conversation_read(p_conversation uuid) returns void
language sql security definer set search_path = '' as $$
  update public.conversation_members set last_read_at = now()
   where conversation_id = p_conversation and user_id = (select auth.uid());
  update public.notifications set is_read = true
   where user_id = (select auth.uid()) and kind = 'message' and ref_id = p_conversation and not is_read;
$$;

-- Inbox: only the caller's conversations; exposes only public profile fields of the other side.
create function public.my_conversations(p_limit integer default 50, p_offset integer default 0)
returns table (
  id uuid, listing_id uuid, listing_title text, listing_type public.listing_type,
  other_id uuid, other_name text, other_avatar text, other_deleted boolean,
  last_message_at timestamptz, last_message_preview text, unread_count integer, is_blocked boolean
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.listing_id, l.title, l.type,
         p.id, p.display_name, p.avatar_path, p.is_deleted,
         c.last_message_at, c.last_message_preview,
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.sender_id <> me.user_id and m.created_at > me.last_read_at)::integer,
         public.users_blocked(c.user_low, c.user_high)
    from public.conversation_members me
    join public.conversations c on c.id = me.conversation_id
    join public.profiles p on p.id = case when c.user_low = me.user_id then c.user_high else c.user_low end
    left join public.listings l on l.id = c.listing_id
   where me.user_id = (select auth.uid())
   order by coalesce(c.last_message_at, c.created_at) desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

create function public.unread_messages_count() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((select count(*) from public.messages m
                        where m.conversation_id = me.conversation_id
                          and m.sender_id <> me.user_id and m.created_at > me.last_read_at)), 0)::integer
    from public.conversation_members me
   where me.user_id = (select auth.uid())
$$;

-- ════════ 20261013000500_moderation.sql ════════
-- TAPTIM · 0500 · Reports, moderation, appeals, admin RPCs, account anonymisation
-- Reporter identity is never exposed to the reported person (no policy lets them read reports).
-- Every moderator decision is written to the append-only moderation_actions log.

create type public.report_target as enum ('listing', 'user', 'message');
create type public.report_reason as enum ('fraud', 'prohibited', 'spam', 'abuse', 'dangerous', 'rules', 'other');
create type public.report_status as enum ('new', 'in_review', 'needs_info', 'resolved', 'rejected');

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id),
  target_type public.report_target not null,
  listing_id uuid references public.listings (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  target_user_id uuid references public.profiles (id),
  reason public.report_reason not null,
  description text check (description is null or char_length(description) <= 1000),
  status public.report_status not null default 'new',
  reporter_reply text check (reporter_reply is null or char_length(reporter_reply) <= 1000),
  info_request text check (info_request is null or char_length(info_request) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint reports_target_consistent check (
    (target_type = 'listing' and listing_id is not null)
    or (target_type = 'message' and message_id is not null)
    or (target_type = 'user' and target_user_id is not null)
  )
);
create unique index reports_open_uniq on public.reports
  (reporter_id, target_type, coalesce(listing_id, message_id, target_user_id))
  where status in ('new', 'in_review', 'needs_info');
create index reports_status_idx on public.reports (status, created_at);
create index reports_target_user_idx on public.reports (target_user_id);
create index reports_listing_idx on public.reports (listing_id);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
create trigger reports_updated_at before update on public.reports
  for each row execute function public.set_updated_at();

create function public.reports_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := new.reporter_id;
  l public.listings;
  m public.messages;
begin
  if public.user_is_restricted(uid, 'reporting') then raise exception 'restricted' using errcode = 'P0001'; end if;
  new.description := nullif(public.clean_text(new.description), '');
  new.status := 'new';
  new.reporter_reply := null;
  new.info_request := null;
  new.resolved_at := null;
  if new.target_type = 'listing' then
    select * into l from public.listings where id = new.listing_id;
    if not found or l.status in ('draft', 'deleted') then raise exception 'not_found' using errcode = 'P0001'; end if;
    if l.author_id = uid then raise exception 'cannot_report_self' using errcode = 'P0001'; end if;
    new.target_user_id := l.author_id;
    new.message_id := null;
  elsif new.target_type = 'message' then
    select * into m from public.messages where id = new.message_id;
    if not found or not exists (select 1 from public.conversation_members
                                  where conversation_id = m.conversation_id and user_id = uid) then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    if m.sender_id = uid then raise exception 'cannot_report_self' using errcode = 'P0001'; end if;
    new.target_user_id := m.sender_id;
    new.listing_id := null;
  else
    if new.target_user_id = uid then raise exception 'cannot_report_self' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.profiles where id = new.target_user_id) then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    new.listing_id := null;
    new.message_id := null;
  end if;
  perform public.enforce_rate_limit(uid, 'report', 10, interval '1 day');
  return new;
end $$;
create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

-- Reporter answers an info request.
create function public.reply_to_report(p_report uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t text := public.clean_text(p_text);
begin
  if t is null or char_length(t) < 3 or char_length(t) > 1000 then
    raise exception 'invalid_text' using errcode = 'P0001';
  end if;
  update public.reports set reporter_reply = t, status = 'in_review'
   where id = p_report and reporter_id = (select auth.uid()) and status = 'needs_info';
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;

create table public.report_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index report_notes_report_idx on public.report_notes (report_id, created_at);

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  moderator_id uuid references public.profiles (id),
  action text not null check (action in (
    'listing_hide', 'listing_restore', 'listing_approve', 'restrict_user', 'lift_restriction',
    'report_status', 'view_message_context', 'role_grant', 'role_revoke', 'appeal_decision'
  )),
  report_id uuid references public.reports (id) on delete set null,
  target_user_id uuid references public.profiles (id),
  listing_id uuid references public.listings (id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index moderation_actions_created_idx on public.moderation_actions (created_at desc);
create index moderation_actions_target_idx on public.moderation_actions (target_user_id);

-- Append-only, even for privileged roles.
create function public.forbid_modification() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'append_only' using errcode = 'P0001';
end $$;
create trigger moderation_actions_append_only before update or delete on public.moderation_actions
  for each row execute function public.forbid_modification();

create type public.appeal_status as enum ('new', 'accepted', 'rejected');
create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id),
  listing_id uuid references public.listings (id) on delete cascade,
  restriction_id uuid references public.user_restrictions (id) on delete cascade,
  message text not null check (char_length(message) between 10 and 1000),
  status public.appeal_status not null default 'new',
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((listing_id is null) <> (restriction_id is null))
);
create unique index appeals_open_uniq on public.appeals (user_id, coalesce(listing_id, restriction_id))
  where status = 'new';

create function public.appeals_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.message := public.clean_text(new.message);
  new.status := 'new';
  new.decision_note := null; new.decided_by := null; new.decided_at := null;
  if new.listing_id is not null and not exists (
       select 1 from public.listings where id = new.listing_id and author_id = new.user_id
          and moderation_state in ('hidden', 'pending_review')) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if new.restriction_id is not null and not exists (
       select 1 from public.user_restrictions where id = new.restriction_id and user_id = new.user_id
          and lifted_at is null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.enforce_rate_limit(new.user_id, 'appeal', 5, interval '1 day');
  return new;
end $$;
create trigger appeals_before_insert before insert on public.appeals
  for each row execute function public.appeals_before_insert();

-- ───────────────────────────── Admin RPCs ─────────────────────────────
create function public.assert_moderator() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'forbidden' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create function public.log_moderation(
  p_action text, p_reason text, p_report uuid default null, p_user uuid default null,
  p_listing uuid default null, p_meta jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.moderation_actions (moderator_id, action, reason, report_id, target_user_id, listing_id, metadata)
  values (auth.uid(), p_action, p_reason, p_report, p_user, p_listing, coalesce(p_meta, '{}'::jsonb));
$$;

create function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_moderator();
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles where not is_deleted),
    'users_7d', (select count(*) from public.profiles where not is_deleted and created_at > now() - interval '7 days'),
    'listings_active', (select coalesce(jsonb_object_agg(type, n), '{}'::jsonb) from (
        select type, count(*) n from public.listings
         where status in ('active', 'reserved') and moderation_state = 'ok' and expires_at > now() group by type) s),
    'listings_7d', (select count(*) from public.listings where published_at > now() - interval '7 days'),
    'listings_pending_review', (select count(*) from public.listings
        where moderation_state = 'pending_review' and status not in ('draft', 'deleted')),
    'listings_hidden', (select count(*) from public.listings where moderation_state = 'hidden' and status <> 'deleted'),
    'resolved_30d', (select coalesce(jsonb_object_agg(type, n), '{}'::jsonb) from (
        select type, count(*) n from public.listings where resolved_at > now() - interval '30 days' group by type) s),
    'reports_open', (select count(*) from public.reports where status in ('new', 'in_review', 'needs_info')),
    'reports_7d', (select count(*) from public.reports where created_at > now() - interval '7 days'),
    'appeals_open', (select count(*) from public.appeals where status = 'new'),
    'restrictions_active', (select count(*) from public.user_restrictions
        where lifted_at is null and (expires_at is null or expires_at > now()))
  );
end $$;

-- Moderation queue with prioritisation signals (several distinct reporters, reporter reliability).
create function public.admin_reports(
  p_status public.report_status[] default array['new', 'in_review', 'needs_info']::public.report_status[],
  p_limit integer default 50, p_offset integer default 0
) returns table (
  id uuid, target_type public.report_target, reason public.report_reason, description text,
  status public.report_status, created_at timestamptz, updated_at timestamptz,
  listing_id uuid, listing_title text, message_id uuid, target_user_id uuid, target_user_name text,
  reporter_id uuid, reporter_name text, reporter_reply text, info_request text,
  distinct_reporters integer, reporter_rejected integer, reporter_total integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_moderator();
  return query
  select r.id, r.target_type, r.reason, r.description, r.status, r.created_at, r.updated_at,
         r.listing_id, l.title, r.message_id, r.target_user_id, tu.display_name,
         r.reporter_id, rp.display_name, r.reporter_reply, r.info_request,
         (select count(distinct r2.reporter_id) from public.reports r2
           where r2.target_type = r.target_type
             and coalesce(r2.listing_id, r2.message_id, r2.target_user_id)
                 = coalesce(r.listing_id, r.message_id, r.target_user_id))::integer,
         (select count(*) from public.reports r3 where r3.reporter_id = r.reporter_id and r3.status = 'rejected')::integer,
         (select count(*) from public.reports r4 where r4.reporter_id = r.reporter_id)::integer
    from public.reports r
    left join public.listings l on l.id = r.listing_id
    left join public.profiles tu on tu.id = r.target_user_id
    join public.profiles rp on rp.id = r.reporter_id
   where r.status = any (p_status)
   order by (r.status = 'new') desc, r.created_at asc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

-- Context for a report. For message reports a moderator sees ONLY the reported message and
-- a small window around it — and the access itself is logged. No general access to chats.
create function public.admin_report_context(p_report uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  m public.messages;
  ctx jsonb := '{}'::jsonb;
begin
  perform public.assert_moderator();
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if r.message_id is not null then
    select * into m from public.messages where id = r.message_id;
    if found then
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'sender_id', x.sender_id, 'sender_name', p.display_name,
               'body', x.body, 'created_at', x.created_at, 'is_reported', x.id = m.id)
             order by x.created_at)
        into ctx
        from (
          (select * from public.messages where conversation_id = m.conversation_id and created_at < m.created_at
            order by created_at desc limit 5)
          union all (select * from public.messages where id = m.id)
          union all
          (select * from public.messages where conversation_id = m.conversation_id and created_at > m.created_at
            order by created_at asc limit 5)
        ) x join public.profiles p on p.id = x.sender_id;
      perform public.log_moderation('view_message_context', 'Просмотр контекста жалобы', r.id, r.target_user_id);
      ctx := jsonb_build_object('messages', coalesce(ctx, '[]'::jsonb));
    end if;
  end if;
  return ctx || jsonb_build_object(
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('body', n.body, 'author', p.display_name, 'created_at', n.created_at)
                order by n.created_at), '[]'::jsonb)
                from public.report_notes n join public.profiles p on p.id = n.author_id where n.report_id = r.id),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'created_at', a.created_at)
                order by a.created_at), '[]'::jsonb)
                from public.moderation_actions a where a.report_id = r.id)
  );
end $$;

create function public.admin_update_report(
  p_report uuid, p_status public.report_status, p_note text default null, p_info_request text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.assert_moderator();
  r public.reports;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_status = 'needs_info' and coalesce(btrim(p_info_request), '') = '' then
    raise exception 'info_request_required' using errcode = 'P0001';
  end if;
  update public.reports
     set status = p_status,
         info_request = case when p_status = 'needs_info' then left(public.clean_text(p_info_request), 500) else info_request end,
         resolved_at = case when p_status in ('resolved', 'rejected') then now() else null end
   where id = r.id;
  if coalesce(btrim(p_note), '') <> '' then
    insert into public.report_notes (report_id, author_id, body) values (r.id, uid, left(public.clean_text(p_note), 2000));
  end if;
  perform public.log_moderation('report_status', coalesce(p_note, r.status || ' → ' || p_status), r.id, r.target_user_id,
    r.listing_id, jsonb_build_object('from', r.status, 'to', p_status));
  -- Tell the reporter only that the report was handled — never what happened to the other person.
  if p_status in ('resolved', 'rejected') and r.status not in ('resolved', 'rejected') then
    perform public.notify(r.reporter_id, 'report_update', 'Жалоба рассмотрена',
      'Спасибо, что помогаете сделать TAPTIM безопаснее.', '/me/reports', r.id);
  elsif p_status = 'needs_info' then
    perform public.notify(r.reporter_id, 'report_update', 'Нужны подробности по жалобе',
      'Модератор просит уточнить информацию.', '/me/reports', r.id);
  end if;
end $$;

create function public.admin_set_listing_state(
  p_listing uuid, p_state public.moderation_state, p_reason text, p_report uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
begin
  perform public.assert_moderator();
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required' using errcode = 'P0001'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.listings set moderation_state = p_state where id = l.id;
  perform public.log_moderation(
    case when p_state = 'hidden' then 'listing_hide'
         when l.moderation_state = 'pending_review' then 'listing_approve'
         else 'listing_restore' end,
    p_reason, p_report, l.author_id, l.id, jsonb_build_object('from', l.moderation_state, 'to', p_state));
  perform public.notify(l.author_id, 'listing_moderation',
    case when p_state = 'hidden' then 'Объявление скрыто модератором' else 'Объявление опубликовано' end,
    case when p_state = 'hidden' then left('Причина: ' || p_reason, 300) else '«' || left(l.title, 60) || '» снова видно всем.' end,
    '/listing/' || l.id, l.id);
end $$;

create function public.admin_restrict_user(
  p_user uuid, p_kind public.restriction_kind, p_reason text,
  p_expires_at timestamptz default null, p_report uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.assert_moderator();
  rid uuid;
  hidden uuid[];
begin
  if p_user = uid then raise exception 'cannot_target_self' using errcode = 'P0001'; end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 3 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'invalid_expiry' using errcode = 'P0001'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user) and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.user_restrictions (user_id, kind, reason, expires_at, created_by)
  values (p_user, p_kind, p_reason, p_expires_at, uid) returning id into rid;
  if p_kind = 'ban' then
    with h as (
      update public.listings set moderation_state = 'hidden'
       where author_id = p_user and status in ('active', 'reserved') and moderation_state = 'ok'
      returning id
    ) select array_agg(id) into hidden from h;
    -- also stop token refresh / new logins at the Auth level (best effort; RLS checks apply regardless)
    begin
      update auth.users set banned_until = coalesce(p_expires_at, 'infinity'::timestamptz) where id = p_user;
    exception when insufficient_privilege then
      raise warning 'auth.users not writable; ban enforced by RLS only';
    end;
  end if;
  perform public.log_moderation('restrict_user', p_reason, p_report, p_user, null,
    jsonb_build_object('kind', p_kind, 'restriction_id', rid, 'expires_at', p_expires_at,
                       'hidden_listings', coalesce(to_jsonb(hidden), '[]'::jsonb)));
  return rid;
end $$;

create function public.admin_lift_restriction(p_restriction uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.assert_moderator();
  r public.user_restrictions;
begin
  select * into r from public.user_restrictions where id = p_restriction for update;
  if not found or r.lifted_at is not null then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.user_restrictions set lifted_at = now(), lifted_by = uid where id = r.id;
  if r.kind = 'ban' and not public.user_is_restricted(r.user_id, 'ban') then
    begin
      update auth.users set banned_until = null where id = r.user_id;
    exception when insufficient_privilege then
      raise warning 'auth.users not writable';
    end;
  end if;
  perform public.log_moderation('lift_restriction', p_reason, null, r.user_id, null,
    jsonb_build_object('restriction_id', r.id, 'kind', r.kind));
end $$;

create function public.admin_search_users(p_query text default null, p_limit integer default 30, p_offset integer default 0)
returns table (
  id uuid, display_name text, created_at timestamptz, is_deleted boolean, email text,
  roles public.app_role[], active_restrictions public.restriction_kind[],
  listings_count integer, reports_against integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := nullif(btrim(p_query), '');
  admin boolean := public.is_admin();
begin
  perform public.assert_moderator();
  return query
  select p.id, p.display_name, p.created_at, p.is_deleted,
         case when admin then u.email::text end,
         (select array_agg(ur.role) from public.user_roles ur where ur.user_id = p.id),
         (select array_agg(distinct r.kind) from public.user_restrictions r
           where r.user_id = p.id and r.lifted_at is null and (r.expires_at is null or r.expires_at > now())),
         (select count(*) from public.listings l where l.author_id = p.id and l.status <> 'deleted')::integer,
         (select count(*) from public.reports rp where rp.target_user_id = p.id)::integer
    from public.profiles p
    left join auth.users u on u.id = p.id
   where q is null
      or p.display_name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or p.id::text = q
      or (admin and u.email::text ilike q)
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create function public.admin_user_restrictions(p_user uuid)
returns setof public.user_restrictions
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_moderator();
  return query select * from public.user_restrictions where user_id = p_user order by created_at desc;
end $$;

create function public.admin_set_role(p_user uuid, p_role public.app_role, p_grant boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = uid and not p_grant then raise exception 'cannot_target_self' using errcode = 'P0001'; end if;
  if p_grant then
    insert into public.user_roles (user_id, role, granted_by) values (p_user, p_role, uid) on conflict do nothing;
  else
    delete from public.user_roles where user_id = p_user and role = p_role;
  end if;
  perform public.log_moderation(case when p_grant then 'role_grant' else 'role_revoke' end,
    p_role::text, null, p_user, null, '{}'::jsonb);
end $$;

create function public.admin_decide_appeal(p_appeal uuid, p_accept boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.assert_moderator();
  a public.appeals;
begin
  select * into a from public.appeals where id = p_appeal for update;
  if not found or a.status <> 'new' then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.appeals set status = case when p_accept then 'accepted'::public.appeal_status else 'rejected' end,
         decision_note = left(public.clean_text(p_note), 500), decided_by = uid, decided_at = now()
   where id = a.id;
  if p_accept and a.listing_id is not null then
    update public.listings set moderation_state = 'ok' where id = a.listing_id;
  elsif p_accept and a.restriction_id is not null then
    perform public.admin_lift_restriction(a.restriction_id, coalesce(p_note, 'Апелляция принята'));
  end if;
  perform public.log_moderation('appeal_decision', p_note, null, a.user_id, a.listing_id,
    jsonb_build_object('appeal_id', a.id, 'accepted', p_accept));
  perform public.notify(a.user_id, 'appeal_update',
    case when p_accept then 'Апелляция принята' else 'Апелляция отклонена' end,
    left(coalesce(p_note, ''), 300), '/me', a.id);
end $$;

-- ───────────────────────────── Account deletion (service role only) ─────────────────────────────
-- Deleted: favorites, notifications, blocks, settings, roles, avatar, photos of unreported listings.
-- Anonymised: profile (name → «Удалённый пользователь»), own listings → status 'deleted' (hidden from everyone).
-- Retained (legitimate interest, see docs/PRIVACY.md): messages in existing chats (the other person's
-- history), reports and moderation log — needed to handle abuse; purged by retention jobs.
create function public.anonymize_account(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  avatar text;
  photos text[];
begin
  select avatar_path into avatar from public.profiles where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;

  update public.giveaway_requests set status = 'cancelled'
   where requester_id = p_user and status in ('pending', 'approved');
  update public.giveaway_requests g set status = 'declined' from public.listings l
   where l.id = g.listing_id and l.author_id = p_user and g.status in ('pending', 'approved');
  update public.exchange_offers set status = 'cancelled'
   where offerer_id = p_user and status in ('pending', 'accepted');
  update public.exchange_offers x set status = 'declined' from public.listings l
   where l.id = x.listing_id and l.author_id = p_user and x.status in ('pending', 'accepted');
  update public.ownership_claims set status = 'cancelled'
   where claimant_id = p_user and status in ('pending', 'approved');
  update public.ownership_claims c set status = 'rejected' from public.listings l
   where l.id = c.listing_id and l.author_id = p_user and c.status in ('pending', 'approved');

  update public.listings set status = 'deleted' where author_id = p_user and status <> 'deleted';

  with del as (
    delete from public.listing_photos ph
     where ph.owner_id = p_user
       and not exists (select 1 from public.reports r where r.listing_id = ph.listing_id)
    returning storage_path
  ) select array_agg(storage_path) into photos from del;

  delete from public.favorites where user_id = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.blocks where blocker_id = p_user;
  delete from public.user_roles where user_id = p_user;
  delete from public.profile_private where user_id = p_user;
  delete from public.rate_limit_events where user_id = p_user;
  update public.profiles
     set display_name = 'Удалённый пользователь', bio = null, avatar_path = null, is_deleted = true
   where id = p_user;

  return jsonb_build_object('avatar', avatar, 'photos', coalesce(to_jsonb(photos), '[]'::jsonb));
end $$;

-- ───────────────────────────── Maintenance (pg_cron, service role) ─────────────────────────────
create function public.run_maintenance() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.rate_limit_events where created_at < now() - interval '2 days';
  delete from public.notifications where is_read and created_at < now() - interval '90 days';
  -- expired listings are already hidden from feeds; archive them for clarity in "My listings"
  update public.listings set status = 'archived'
   where status in ('active', 'reserved') and expires_at < now() - interval '7 days';
end $$;

-- ════════ 20261013000900_security.sql ════════
-- TAPTIM · 0900 · Access control: RLS policies, column grants, function grants, storage, realtime.
-- This file is the single place to audit "who can do what". See docs/SECURITY.md for the matrix.

-- ═════════════════════ 1. Start from zero ═════════════════════
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

grant usage on schema public to anon, authenticated;

alter table public.cities               enable row level security;
alter table public.districts            enable row level security;
alter table public.categories           enable row level security;
alter table public.blocked_terms        enable row level security;
alter table public.profiles             enable row level security;
alter table public.profile_private      enable row level security;
alter table public.user_roles           enable row level security;
alter table public.user_restrictions    enable row level security;
alter table public.rate_limit_events    enable row level security;
alter table public.notifications        enable row level security;
alter table public.listings             enable row level security;
alter table public.listing_photos       enable row level security;
alter table public.favorites            enable row level security;
alter table public.blocks               enable row level security;
alter table public.giveaway_requests    enable row level security;
alter table public.exchange_offers      enable row level security;
alter table public.ownership_claims     enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.reports              enable row level security;
alter table public.report_notes         enable row level security;
alter table public.moderation_actions   enable row level security;
alter table public.appeals              enable row level security;

-- ═════════════════════ 2. Reference data ═════════════════════
-- read: everyone · write: admins (categories) · blocked_terms: admins only (not public, to avoid evasion)
grant select on public.cities, public.districts, public.categories to anon, authenticated;
create policy cities_read on public.cities for select to anon, authenticated using (true);
create policy districts_read on public.districts for select to anon, authenticated using (true);
create policy categories_read on public.categories for select to anon, authenticated using (true);

grant insert, update on public.categories to authenticated;
create policy categories_admin_insert on public.categories for insert to authenticated
  with check ((select public.is_admin()));
create policy categories_admin_update on public.categories for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, delete on public.blocked_terms to authenticated;
create policy blocked_terms_admin_read on public.blocked_terms for select to authenticated using ((select public.is_admin()));
create policy blocked_terms_admin_insert on public.blocked_terms for insert to authenticated with check ((select public.is_admin()));
create policy blocked_terms_admin_delete on public.blocked_terms for delete to authenticated using ((select public.is_admin()));

-- ═════════════════════ 3. Profiles ═════════════════════
-- profiles: public fields only. read: everyone · update: owner, 3 columns · insert/delete: server only
grant select on public.profiles to anon, authenticated;
grant update (display_name, bio, city_id) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to anon, authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and not is_deleted)
  with check (id = (select auth.uid()));

-- profile_private: owner only. terms_* are not updatable by the client.
grant select on public.profile_private to authenticated;
grant update (notify_messages, notify_requests, notify_offers, notify_listing_updates, notify_reports, messages_from)
  on public.profile_private to authenticated;
create policy profile_private_read_own on public.profile_private for select to authenticated
  using (user_id = (select auth.uid()));
create policy profile_private_update_own on public.profile_private for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- roles & restrictions: read own / moderators. No client writes at all (privilege escalation guard).
grant select on public.user_roles, public.user_restrictions to authenticated;
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_moderator()));
create policy user_restrictions_read on public.user_restrictions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_moderator()));

-- rate_limit_events: RLS on, no grants, no policies → invisible to clients.

-- notifications: owner reads, marks read, deletes. Created by server functions only.
grant select, delete on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- ═════════════════════ 4. Listings ═════════════════════
-- read: published+approved for everyone; own (except deleted) for author; all for moderators
-- insert: author = caller (default auth.uid(), column not granted), not restricted
-- update: author, content columns only — never author_id/type/moderation_state/published_at
-- delete: author, drafts only (published listings are soft-deleted via status = 'deleted')
grant select on public.listings to anon, authenticated;
grant insert (type, status, category_id, city_id, district_id, place_hint, title, description, event_date,
              item_condition, quantity, quantity_available, exchange_wish, wanted_until, is_valuable)
  on public.listings to authenticated;
grant update (status, category_id, city_id, district_id, place_hint, title, description, event_date,
              item_condition, quantity, quantity_available, exchange_wish, wanted_until, is_valuable)
  on public.listings to authenticated;
grant delete on public.listings to authenticated;

create policy listings_read_public on public.listings for select to anon, authenticated
  using (status in ('active', 'reserved', 'resolved') and moderation_state = 'ok');
create policy listings_read_own on public.listings for select to authenticated
  using (author_id = (select auth.uid()) and status <> 'deleted');
create policy listings_read_moderator on public.listings for select to authenticated
  using ((select public.is_moderator()));
create policy listings_insert_own on public.listings for insert to authenticated
  with check (author_id = (select auth.uid()) and not (select public.i_am_restricted('posting')));
create policy listings_update_own on public.listings for update to authenticated
  using (author_id = (select auth.uid()) and status <> 'deleted' and not (select public.i_am_restricted('posting')))
  with check (author_id = (select auth.uid()));
create policy listings_delete_own_draft on public.listings for delete to authenticated
  using (author_id = (select auth.uid()) and status = 'draft');

grant select on public.listing_cards to anon, authenticated;

-- photos: read if the listing is readable (RLS of listings applies inside EXISTS); owner may reorder.
grant select on public.listing_photos to anon, authenticated;
grant update (sort) on public.listing_photos to authenticated;
create policy listing_photos_read on public.listing_photos for select to anon, authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));
create policy listing_photos_reorder_own on public.listing_photos for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- favorites: strictly own; can only favorite listings the caller can see.
grant select, insert, delete on public.favorites to authenticated;
create policy favorites_read_own on public.favorites for select to authenticated using (user_id = (select auth.uid()));
create policy favorites_insert_own on public.favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.listings l where l.id = listing_id));
create policy favorites_delete_own on public.favorites for delete to authenticated using (user_id = (select auth.uid()));

-- ═════════════════════ 5. Interactions ═════════════════════
grant select, insert, delete on public.blocks to authenticated;
create policy blocks_read_own on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));
create policy blocks_insert_own on public.blocks for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy blocks_delete_own on public.blocks for delete to authenticated using (blocker_id = (select auth.uid()));

-- requests / offers / claims: visible to the two parties; created by the caller; state via RPC only.
grant select on public.giveaway_requests, public.exchange_offers, public.ownership_claims to authenticated;
grant insert (listing_id, message, quantity) on public.giveaway_requests to authenticated;
grant insert (listing_id, offered_listing_id, message) on public.exchange_offers to authenticated;
grant insert (listing_id, proof) on public.ownership_claims to authenticated;

create policy giveaway_requests_read on public.giveaway_requests for select to authenticated
  using (requester_id = (select auth.uid())
         or exists (select 1 from public.listings l where l.id = listing_id and l.author_id = (select auth.uid())));
create policy giveaway_requests_insert on public.giveaway_requests for insert to authenticated
  with check (requester_id = (select auth.uid()) and not (select public.i_am_restricted('posting')));

create policy exchange_offers_read on public.exchange_offers for select to authenticated
  using (offerer_id = (select auth.uid())
         or exists (select 1 from public.listings l where l.id = listing_id and l.author_id = (select auth.uid())));
create policy exchange_offers_insert on public.exchange_offers for insert to authenticated
  with check (offerer_id = (select auth.uid()) and not (select public.i_am_restricted('posting')));

create policy ownership_claims_read on public.ownership_claims for select to authenticated
  using (claimant_id = (select auth.uid())
         or exists (select 1 from public.listings l where l.id = listing_id and l.author_id = (select auth.uid())));
create policy ownership_claims_insert on public.ownership_claims for insert to authenticated
  with check (claimant_id = (select auth.uid()) and not (select public.i_am_restricted('posting')));

-- ═════════════════════ 6. Chat ═════════════════════
-- conversations/members: members only; created via start_conversation() only.
-- messages: members read; members send as themselves unless blocked/restricted. No edit/delete
-- (messages are evidence for reports).
grant select on public.conversations, public.conversation_members to authenticated;
create policy conversations_read_members on public.conversations for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));
create policy conversation_members_read on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));

grant select on public.messages to authenticated;
grant insert (conversation_id, body, client_id) on public.messages to authenticated;
create policy messages_read_members on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy messages_insert_member on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
    and not public.conversation_blocked(conversation_id)
    and not (select public.i_am_restricted('messaging'))
  );

-- ═════════════════════ 7. Moderation ═════════════════════
grant select on public.reports to authenticated;
grant insert (target_type, listing_id, message_id, target_user_id, reason, description) on public.reports to authenticated;
create policy reports_read on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_moderator()));
create policy reports_insert_own on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));

grant select on public.report_notes, public.moderation_actions to authenticated;
create policy report_notes_moderators on public.report_notes for select to authenticated
  using ((select public.is_moderator()));
create policy moderation_actions_moderators on public.moderation_actions for select to authenticated
  using ((select public.is_moderator()));

grant select on public.appeals to authenticated;
grant insert (listing_id, restriction_id, message) on public.appeals to authenticated;
create policy appeals_read on public.appeals for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_moderator()));
create policy appeals_insert_own on public.appeals for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ═════════════════════ 8. Function grants (explicit allow-list) ═════════════════════
-- Policy helpers (caller-scoped, return booleans about the caller only)
grant execute on function public.is_moderator(), public.is_admin(), public.has_role(public.app_role),
  public.i_am_restricted(public.restriction_kind), public.blocked_with(uuid),
  public.is_conversation_member(uuid), public.conversation_blocked(uuid), public.clean_text(text)
  to authenticated;
grant execute on function public.clean_text(text), public.current_terms_version() to anon, authenticated;

-- Public read RPCs
grant execute on function public.search_listings(text, public.listing_type[], text, text, text, date, date, boolean, text, integer, integer)
  to anon, authenticated;

-- Authenticated RPCs (each validates the caller internally)
grant execute on function
  public.republish_listing(uuid),
  public.delete_my_listing(uuid),
  public.listing_matches(uuid, integer),
  public.recommended_listings(integer),
  public.giveaway_queue_position(uuid),
  public.giveaway_request_action(uuid, text),
  public.exchange_offer_action(uuid, text),
  public.ownership_claim_action(uuid, text),
  public.start_conversation(uuid, uuid),
  public.mark_conversation_read(uuid),
  public.my_conversations(integer, integer),
  public.unread_messages_count(),
  public.reply_to_report(uuid, text),
  -- admin RPCs: callable, but each starts with assert_moderator()/is_admin()
  public.admin_dashboard(),
  public.admin_reports(public.report_status[], integer, integer),
  public.admin_report_context(uuid),
  public.admin_update_report(uuid, public.report_status, text, text),
  public.admin_set_listing_state(uuid, public.moderation_state, text, uuid),
  public.admin_restrict_user(uuid, public.restriction_kind, text, timestamptz, uuid),
  public.admin_lift_restriction(uuid, text),
  public.admin_search_users(text, integer, integer),
  public.admin_user_restrictions(uuid),
  public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_decide_appeal(uuid, boolean, text)
  to authenticated;

-- Server-only (Edge Functions / cron with the service role)
grant execute on function public.anonymize_account(uuid), public.run_maintenance(),
  public.enforce_rate_limit(uuid, text, integer, interval) to service_role;

-- ═════════════════════ 9. Storage ═════════════════════
-- uploads: PRIVATE staging. A user may only write into "<own uid>/<random>.ext".
-- listing-photos / avatars: PUBLIC read by design (listing photos are meant to be seen), but
-- written ONLY by the `photos` Edge Function after magic-byte validation and EXIF/GPS stripping.
-- File names are 128-bit random → no enumeration, no overwriting someone else's file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('uploads', 'uploads', false, 12582912, array['image/jpeg', 'image/png', 'image/webp']),
  ('listing-photos', 'listing-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "uploads: insert into own folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp)$'
  );
create policy "uploads: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No SELECT/UPDATE policies: clients cannot list buckets, read staging files or overwrite anything.

-- ═════════════════════ 10. Realtime ═════════════════════
-- postgres_changes respect RLS: a subscriber only receives rows they may SELECT.
-- Only these two tables are published; their rows contain no private profile fields.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications;
  end if;
end $$;

-- ═════════════════════ 11. Scheduled maintenance (if pg_cron is available) ═════════════════════
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('taptim-maintenance', '17 3 * * *', 'select public.run_maintenance()');
exception when others then
  raise notice 'pg_cron unavailable (%). Schedule public.run_maintenance() manually.', sqlerrm;
end $$;

-- ═════════════════════ 12. Self-check: fail the migration if hardening is incomplete ═════════════════════
do $$
declare
  r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    raise exception 'RLS is disabled on public.%', r.relname;
  end loop;
  for r in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
  loop
    raise exception 'SECURITY DEFINER function public.% has no fixed search_path', r.proname;
  end loop;
  for r in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('anonymize_account', 'run_maintenance', 'enforce_rate_limit',
                                                 'notify', 'user_is_restricted', 'users_blocked', 'log_moderation')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    raise exception 'internal function public.% is executable by clients', r.proname;
  end loop;
end $$;

-- ════════ 20261013001000_search_v2.sql ════════
-- TAPTIM · 1000 · Search v2 (design pass): "Только с фото" filter, exchange wish on cards,
-- exclusion parameter for "Похожие объявления".

-- New columns may only be appended to an existing view.
create or replace view public.listing_cards with (security_invoker = true) as
select
  l.id, l.author_id, l.type, l.status, l.moderation_state, l.category_id, l.city_id, l.district_id,
  l.place_hint, l.title, left(l.description, 220) as excerpt, l.event_date, l.item_condition,
  l.quantity, l.quantity_available, l.wanted_until, l.is_valuable, l.published_at, l.expires_at,
  l.resolved_at, l.created_at, l.updated_at,
  p.display_name as author_name,
  p.avatar_path as author_avatar,
  (select ph.storage_path from public.listing_photos ph
    where ph.listing_id = l.id order by ph.sort, ph.created_at limit 1) as cover_path,
  (select count(*) from public.listing_photos ph where ph.listing_id = l.id)::integer as photo_count,
  left(l.exchange_wish, 80) as exchange_wish
from public.listings l
join public.profiles p on p.id = l.author_id;

drop function public.search_listings(text, public.listing_type[], text, text, text, date, date, boolean, text, integer, integer);

create function public.search_listings(
  p_query text default null,
  p_types public.listing_type[] default null,
  p_category text default null,
  p_district text default null,
  p_city text default 'shymkent',
  p_date_from date default null,
  p_date_to date default null,
  p_include_closed boolean default false,
  p_sort text default 'new',
  p_limit integer default 20,
  p_offset integer default 0,
  p_with_photo boolean default false,
  p_exclude uuid default null
) returns setof public.listing_cards
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_q text := nullif(btrim(left(coalesce(p_query, ''), 100)), '');
  v_ts tsquery;
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 2000);
begin
  if p_sort not in ('new', 'relevance', 'event_date') then
    raise exception 'invalid_sort' using errcode = 'P0001';
  end if;
  if v_q is not null then
    v_ts := websearch_to_tsquery('russian'::regconfig, v_q);
    -- escape LIKE metacharacters so user input is matched literally
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select c.*
    from public.listing_cards c
    join public.listings l on l.id = c.id
   where l.city_id = coalesce(p_city, 'shymkent')
     and l.status in ('active', 'reserved', 'resolved')
     and l.moderation_state = 'ok'
     and (p_include_closed or (l.status in ('active', 'reserved') and (l.expires_at is null or l.expires_at > now())))
     and (p_types is null or cardinality(p_types) = 0 or l.type = any (p_types))
     and (p_category is null or l.category_id = p_category)
     and (p_district is null or l.district_id = p_district)
     and (p_date_from is null or coalesce(l.event_date, l.published_at::date) >= p_date_from)
     and (p_date_to is null or coalesce(l.event_date, l.published_at::date) <= p_date_to)
     and (not p_with_photo or exists (select 1 from public.listing_photos ph where ph.listing_id = l.id))
     and (p_exclude is null or l.id <> p_exclude)
     and (v_q is null or l.search_vector @@ v_ts or l.title ilike v_like)
   order by
     case when p_sort = 'relevance' and v_q is not null then ts_rank(l.search_vector, v_ts) end desc nulls last,
     case when p_sort = 'event_date' then coalesce(l.event_date, l.published_at::date) end desc nulls last,
     l.published_at desc nulls last,
     l.id
   limit v_limit offset v_offset;
end $$;

revoke execute on function public.search_listings(text, public.listing_type[], text, text, text, date, date, boolean, text, integer, integer, boolean, uuid) from public;
grant execute on function public.search_listings(text, public.listing_type[], text, text, text, date, date, boolean, text, integer, integer, boolean, uuid)
  to anon, authenticated;
grant select on public.listing_cards to anon, authenticated;

-- ════════ 20261013001100_photo_budget.sql ════════
-- TAPTIM · 1100 · Photo budget for the Supabase Free plan (1 GB storage, 5 GB egress / month)
--   * small thumbnail per photo (cards & lists load ~15–25 KB instead of the full image)
--   * max 5 photos per listing
--   * tight bucket size limits (the client compresses to WebP/JPEG before upload)
--   * photos of listings closed/deleted > 30 days ago are purged (unless under an open report)

alter table public.listing_photos
  add column thumb_path text
  check (thumb_path is null or thumb_path ~ '^[0-9a-f-]{36}/[0-9a-f]{32}_t\.(jpg|png|webp)$');

create or replace function public.listing_photos_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.listing_photos where listing_id = new.listing_id) >= 5 then
    raise exception 'too_many_photos' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Cards show the thumbnail; the full image is used only on the listing page.
create or replace view public.listing_cards with (security_invoker = true) as
select
  l.id, l.author_id, l.type, l.status, l.moderation_state, l.category_id, l.city_id, l.district_id,
  l.place_hint, l.title, left(l.description, 220) as excerpt, l.event_date, l.item_condition,
  l.quantity, l.quantity_available, l.wanted_until, l.is_valuable, l.published_at, l.expires_at,
  l.resolved_at, l.created_at, l.updated_at,
  p.display_name as author_name,
  p.avatar_path as author_avatar,
  (select coalesce(ph.thumb_path, ph.storage_path) from public.listing_photos ph
    where ph.listing_id = l.id order by ph.sort, ph.created_at limit 1) as cover_path,
  (select count(*) from public.listing_photos ph where ph.listing_id = l.id)::integer as photo_count,
  left(l.exchange_wish, 80) as exchange_wish
from public.listings l
join public.profiles p on p.id = l.author_id;

update storage.buckets set file_size_limit = 2097152 where id = 'uploads';          -- 2 MB staging
update storage.buckets set file_size_limit = 1572864 where id = 'listing-photos';   -- 1.5 MB
update storage.buckets set file_size_limit = 524288 where id = 'avatars';           -- 512 KB

-- Server-only: photos that may be removed to free storage.
create function public.photos_to_purge(p_limit integer default 500)
returns table (id uuid, storage_path text, thumb_path text)
language sql stable security definer set search_path = '' as $$
  select ph.id, ph.storage_path, ph.thumb_path
    from public.listing_photos ph
    join public.listings l on l.id = ph.listing_id
   where l.status in ('resolved', 'archived', 'deleted')
     and l.updated_at < now() - interval '30 days'
     and not exists (
       select 1 from public.reports r
        where r.listing_id = l.id and r.status in ('new', 'in_review', 'needs_info'))
   order by l.updated_at
   limit least(greatest(p_limit, 1), 1000)
$$;
revoke execute on function public.photos_to_purge(integer) from public, anon, authenticated;
grant execute on function public.photos_to_purge(integer) to service_role;

-- Account deletion must also return thumbnail paths for Storage cleanup.
create or replace function public.anonymize_account(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  avatar text;
  photos text[];
begin
  select avatar_path into avatar from public.profiles where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;

  update public.giveaway_requests set status = 'cancelled'
   where requester_id = p_user and status in ('pending', 'approved');
  update public.giveaway_requests g set status = 'declined' from public.listings l
   where l.id = g.listing_id and l.author_id = p_user and g.status in ('pending', 'approved');
  update public.exchange_offers set status = 'cancelled'
   where offerer_id = p_user and status in ('pending', 'accepted');
  update public.exchange_offers x set status = 'declined' from public.listings l
   where l.id = x.listing_id and l.author_id = p_user and x.status in ('pending', 'accepted');
  update public.ownership_claims set status = 'cancelled'
   where claimant_id = p_user and status in ('pending', 'approved');
  update public.ownership_claims c set status = 'rejected' from public.listings l
   where l.id = c.listing_id and l.author_id = p_user and c.status in ('pending', 'approved');

  update public.listings set status = 'deleted' where author_id = p_user and status <> 'deleted';

  with del as (
    delete from public.listing_photos ph
     where ph.owner_id = p_user
       and not exists (select 1 from public.reports r where r.listing_id = ph.listing_id)
    returning storage_path, thumb_path
  ) select array_agg(x) filter (where x is not null) into photos
      from del, unnest(array[del.storage_path, del.thumb_path]) as x;

  delete from public.favorites where user_id = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.blocks where blocker_id = p_user;
  delete from public.user_roles where user_id = p_user;
  delete from public.profile_private where user_id = p_user;
  delete from public.rate_limit_events where user_id = p_user;
  update public.profiles
     set display_name = 'Удалённый пользователь', bio = null, avatar_path = null, is_deleted = true
   where id = p_user;

  return jsonb_build_object('avatar', avatar, 'photos', coalesce(to_jsonb(photos), '[]'::jsonb));
end $$;
revoke execute on function public.anonymize_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_account(uuid) to service_role;
