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
