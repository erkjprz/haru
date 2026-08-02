-- Members had no self-service way to fix a typo'd or changed name -- only
-- admins could update the members table (members_update_admin RLS policy).
-- Narrow SECURITY DEFINER RPC scoped to the caller's own row, matching the
-- same pattern as set_default_contribution_amount /
-- set_default_loan_payment_amount.
create or replace function public.update_my_name(p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_member_id() is null then
    raise exception 'Not an approved member';
  end if;

  if trim(p_name) = '' then
    raise exception 'Name cannot be empty';
  end if;

  update members
  set name = trim(p_name)
  where member_id = current_member_id();
end;
$function$;
