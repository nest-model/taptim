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
