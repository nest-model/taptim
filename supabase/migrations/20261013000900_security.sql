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
