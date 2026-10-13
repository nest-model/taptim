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
