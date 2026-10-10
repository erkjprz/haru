-- The Receipts bucket had no DELETE policy, so every
-- supabase.storage.from("Receipts").remove(...) in the app (rolling back an
-- upload whose insert failed, clearing a receipt replaced by an edit, etc.)
-- silently removed nothing.
--
-- Deleting is only allowed for a file nothing points at anymore, so a
-- receipt or payout QR that's still attached to a transaction or loan can't
-- be removed out from under it. On top of that, a member can only delete
-- files they uploaded themselves; admins can delete any unreferenced file
-- (an admin edit replacing a member's receipt, orphaned receipts after a
-- reopen).

-- security definer so the check sees every row, not just the ones the
-- caller's own RLS lets them read.
create or replace function public.receipt_file_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.transactions where receipt_url = p_name)
      or exists (select 1 from public.transactions where payout_qr_path = p_name)
      or exists (select 1 from public.loans where payout_qr_path = p_name);
$$;

revoke execute on function public.receipt_file_in_use(text) from public, anon;
grant execute on function public.receipt_file_in_use(text) to authenticated;

create policy "Uploaders and admins can delete unused receipts"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'Receipts'
    and (owner_id = auth.uid()::text or public.is_admin())
    and not public.receipt_file_in_use(name)
  );
