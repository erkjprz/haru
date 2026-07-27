-- Inserts one notification row. SECURITY DEFINER so it can write on behalf
-- of a recipient who isn't the acting user (e.g. an admin approving someone
-- else's transaction), bypassing notifications' owner-only RLS by design.
create or replace function public.create_notification(
  p_member_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (member_id, type, title, body, link)
  values (p_member_id, p_type, p_title, p_body, p_link);
$$;

-- Same, fanned out to every approved admin -- the recipient list for
-- anything sitting in an admin approval queue.
create or replace function public.notify_admins(
  p_type text,
  p_title text,
  p_body text,
  p_link text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (member_id, type, title, body, link)
  select member_id, p_type, p_title, p_body, p_link
  from public.members
  where role = 'admin' and status = 'approved';
$$;

-- Fires the push leg for a freshly inserted notification. Best-effort and
-- async (pg_net queues the HTTP call and returns immediately) -- the
-- notifications row itself, not this call, is the durable record, so a
-- dropped push never loses the notification, only the phone buzz.
create or replace function public.dispatch_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'push_dispatch_secret';

  if v_secret is not null then
    perform net.http_post(
      url := 'https://kepwsajtixlcjbabfxlk.supabase.co/functions/v1/send-push',
      body := jsonb_build_object('notification_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret)
    );
  end if;

  return new;
end;
$$;

create trigger trg_dispatch_push_notification
after insert on public.notifications
for each row execute function public.dispatch_push_notification();
