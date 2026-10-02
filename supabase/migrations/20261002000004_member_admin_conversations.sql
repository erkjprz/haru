-- Member <-> admin-team messaging. One conversation is always between a
-- single member (conversations.member_id) and the admin team as a whole --
-- any approved admin can read and reply, and the member only ever sees
-- "Admins" on the other side. Either party can start one: an admin for
-- any approved member, a member only for themselves (start_conversation
-- enforces that, since there's no direct insert policy on conversations).

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(member_id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 1 and 120),
  created_by uuid not null references public.members(member_id),
  -- 'closed' only files the thread away in the admin inbox. A new message
  -- from either side reopens it (see handle_conversation_message), so a
  -- member is never stuck unable to follow up.
  status text not null default 'open' check (status in ('open', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists conversations_member_id_idx on public.conversations (member_id);
create index if not exists conversations_last_message_at_idx on public.conversations (last_message_at desc);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.members(member_id),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists conversation_messages_conversation_idx
  on public.conversation_messages (conversation_id, created_at);

-- Per-reader read marker. Needed (rather than a single read flag) because
-- several admins share every thread and each has their own unread state.
create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  member_id uuid not null references public.members(member_id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, member_id)
);

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_reads enable row level security;

create policy conversations_select on public.conversations
  for select to authenticated
  using (member_id = current_member_id() or is_admin());

create policy conversation_messages_select on public.conversation_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.member_id = current_member_id() or is_admin())
    )
  );

-- Messages are the one thing written directly from the client. Only as
-- yourself, and only into a thread you're a party to.
create policy conversation_messages_insert on public.conversation_messages
  for insert to authenticated
  with check (
    sender_id = current_member_id()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.member_id = current_member_id() or is_admin())
    )
  );

create policy conversation_reads_select_own on public.conversation_reads
  for select to authenticated
  using (member_id = current_member_id());

-- Bumps the thread, records that the sender has read up to their own
-- message, and notifies the other side through the existing notifications
-- table (so the bell and push delivery come for free).
--
-- Notifications are coalesced: a recipient who already has an unread
-- message notification for this thread doesn't get another one, so a
-- quick back-and-forth doesn't buzz their phone for every line.
-- mark_conversation_read clears those notifications when the thread is
-- opened, re-arming the next one.
create or replace function public.handle_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.conversations%rowtype;
  v_sender_name text;
  v_link text;
  v_preview text;
begin
  update public.conversations
  set last_message_at = new.created_at, status = 'open'
  where id = new.conversation_id
  returning * into v_conv;

  insert into public.conversation_reads (conversation_id, member_id, last_read_at)
  values (new.conversation_id, new.sender_id, new.created_at)
  on conflict (conversation_id, member_id)
  do update set last_read_at = greatest(conversation_reads.last_read_at, excluded.last_read_at);

  v_link := '/messages/' || new.conversation_id;
  v_preview := left(regexp_replace(btrim(new.body), '\s+', ' ', 'g'), 140);

  if new.sender_id = v_conv.member_id then
    select name into v_sender_name from public.members where member_id = new.sender_id;

    insert into public.notifications (member_id, type, title, body, link)
    select m.member_id, 'message', 'Message from ' || coalesce(v_sender_name, 'a member'), v_preview, v_link
    from public.members m
    where m.role = 'admin'
      and m.status = 'approved'
      and m.member_id <> new.sender_id
      and not exists (
        select 1 from public.notifications n
        where n.member_id = m.member_id and n.type = 'message' and n.link = v_link and not n.read
      );
  else
    if not exists (
      select 1 from public.notifications n
      where n.member_id = v_conv.member_id and n.type = 'message' and n.link = v_link and not n.read
    ) then
      perform public.create_notification(v_conv.member_id, 'message', 'Message from the admins', v_preview, v_link);
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_handle_conversation_message
after insert on public.conversation_messages
for each row execute function public.handle_conversation_message();

-- Opens a thread and posts its first message in one step. Admins may open
-- one with any approved member; everyone else only with themselves.
create or replace function public.start_conversation(
  p_member_id uuid,
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_member_id();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in.';
  end if;

  if p_member_id is distinct from v_me and not is_admin() then
    raise exception 'You can only start a conversation for yourself.';
  end if;

  if not exists (select 1 from public.members where member_id = p_member_id and status = 'approved') then
    raise exception 'That member isn''t active.';
  end if;

  insert into public.conversations (member_id, subject, created_by)
  values (p_member_id, btrim(p_subject), v_me)
  returning id into v_id;

  insert into public.conversation_messages (conversation_id, sender_id, body)
  values (v_id, v_me, btrim(p_body));

  return v_id;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_member_id();
begin
  if v_me is null then
    raise exception 'Not signed in.';
  end if;

  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and (c.member_id = v_me or is_admin())
  ) then
    raise exception 'Conversation not found.';
  end if;

  insert into public.conversation_reads (conversation_id, member_id, last_read_at)
  values (p_conversation_id, v_me, now())
  on conflict (conversation_id, member_id) do update set last_read_at = now();

  update public.notifications
  set read = true
  where member_id = v_me and type = 'message' and link = '/messages/' || p_conversation_id and not read;
end;
$$;

-- Admin-only filing. Done through a function rather than an update policy
-- so admins can only ever flip status, never reassign member_id/subject.
create or replace function public.set_conversation_status(p_conversation_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admins can change a conversation''s status.';
  end if;
  if p_status not in ('open', 'closed') then
    raise exception 'Invalid status.';
  end if;

  update public.conversations set status = p_status where id = p_conversation_id;
end;
$$;

-- Inbox listing: every thread the caller can see (RLS applies -- this runs
-- as the caller), with the latest message and the caller's own unread
-- flag. Unread means someone else posted after the caller last read it.
create or replace function public.list_conversations()
returns table (
  id uuid,
  member_id uuid,
  member_name text,
  subject text,
  status text,
  last_message_at timestamptz,
  last_message_body text,
  last_message_sender_id uuid,
  unread boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.member_id,
    m.name,
    c.subject,
    c.status,
    c.last_message_at,
    lm.body,
    lm.sender_id,
    (lm.sender_id is distinct from current_member_id()
      and lm.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)) as unread
  from public.conversations c
  left join public.members m on m.member_id = c.member_id
  left join public.conversation_reads r on r.conversation_id = c.id and r.member_id = current_member_id()
  left join lateral (
    select cm.body, cm.sender_id, cm.created_at
    from public.conversation_messages cm
    where cm.conversation_id = c.id
    order by cm.created_at desc
    limit 1
  ) lm on true
  order by c.last_message_at desc;
$$;

revoke execute on function public.handle_conversation_message() from public, anon, authenticated;
revoke execute on function public.start_conversation(uuid, text, text) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.set_conversation_status(uuid, text) from public, anon;
revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.start_conversation(uuid, text, text) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.set_conversation_status(uuid, text) to authenticated;
grant execute on function public.list_conversations() to authenticated;

-- Live thread updates while a conversation is open. Realtime enforces the
-- select policies above, so each subscriber only receives rows they could
-- already query.
alter publication supabase_realtime add table public.conversation_messages;
