-- notify_transaction_decided's link pointed at '/transactions/<id>', but no
-- such page exists -- only '/transactions/<id>/edit' does. Tapping the
-- notification 404'd regardless of status. Now that a rejected row is
-- editable again (see the app's transactions/[id]/edit page), this also
-- takes the submitter straight to the form that fixes it.
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
        '/transactions/' || new.transaction_id || '/edit'
      );
    end if;
  end if;
  return new;
end;
$$;

-- Resubmitting a rejected row (editing and saving it flips status back to
-- pending, see the app's handleSave) is otherwise invisible to admins --
-- notify_admins_transaction_pending only ever fired on insert, so a
-- corrected row silently re-entered the queue with no ping. Reuse the same
-- function on the rejected->pending edge specifically, mirroring how
-- notify_transaction_decided is scoped to its own edge, so an ordinary
-- update of an already-pending row (or an admin-entered row cycling through
-- some other transition) never fires this twice.
create trigger trg_notify_admins_transaction_resubmitted
after update on public.transactions
for each row
when (old.status = 'rejected' and new.status = 'pending')
execute function public.notify_admins_transaction_pending();
