-- Lets an admin record why a transaction was rejected, so the submitter's
-- "not approved" notification (see notify_transaction_decided) can explain
-- what to fix instead of just reporting the outcome.
alter table public.transactions
  add column rejection_reason text;

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
          when new.rejection_reason is not null and btrim(new.rejection_reason) <> '' then
            'Your ' || new.classification || ' was not approved: ' || new.rejection_reason
          else 'Your ' || new.classification || ' was not approved.'
        end,
        '/transactions/' || new.transaction_id
      );
    end if;
  end if;
  return new;
end;
$$;
