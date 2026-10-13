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
