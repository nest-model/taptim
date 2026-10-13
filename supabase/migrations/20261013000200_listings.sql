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
