-- Submitter notification when their own pending transaction is finally
-- decided. Scoped to the pending->approved/rejected edge only, so a
-- self-service pending->cancelled update (transactions_update_own_pending)
-- never notifies -- that's the submitter's own action, not news to them.
create or replace function public.notify_transaction_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    v_recipient := coalesce(new.submitted_by, new.member_id);
    if v_recipient is not null then
      perform public.create_notification(
        v_recipient,
        'transaction_' || new.status,
        case when new.status = 'approved' then new.classification || ' Approved' else new.classification || ' Not Approved' end,
        case
          when new.status = 'approved' then 'Your ' || new.classification || ' was approved.'
          else 'Your ' || new.classification || ' was not approved.'
        end,
        '/transactions/' || new.transaction_id
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_notify_transaction_decided
after update on public.transactions
for each row execute function public.notify_transaction_decided();

-- Admin notification when a new transaction lands in the pending queue.
-- Admin-inserted transactions (e.g. Bank Interest, which is recorded
-- straight to status='approved') never hit this, by construction -- only
-- rows that actually need someone's approval do.
create or replace function public.notify_admins_transaction_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    perform public.notify_admins(
      'transaction_pending',
      'Pending Approval',
      'A new ' || new.classification || ' needs your approval.',
      '/admin'
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_admins_transaction_pending
after insert on public.transactions
for each row execute function public.notify_admins_transaction_pending();

-- Admin notification for a new signup (member or borrower role alike --
-- both land in members with status='pending' and both need an admin to
-- act, just from two different admin-page tabs).
create or replace function public.notify_admins_member_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    perform public.notify_admins(
      'member_pending',
      'New Signup',
      coalesce(new.name, 'Someone') || ' signed up and needs approval.',
      '/admin'
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_admins_member_pending
after insert on public.members
for each row execute function public.notify_admins_member_pending();
