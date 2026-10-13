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
