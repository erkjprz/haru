-- Date each member's bank-interest share entry (the Gain Allocation
-- transaction) with the distribution date, like its bank_interest_allocations
-- row. The app now passes Dec 31 of the interest's year when that year is
-- already over (see bankInterestDistributionDate in lib/bankInterest.ts), so
-- a January run for last year's interest shows up in that year everywhere,
-- matching the earlier year-end (Dec 30) distributions. Without txn_date the
-- entry fell back to created_at -- the day it was run.
--
-- Only the transactions insert changes (txn_date added); everything else is
-- as before.
create or replace function public.distribute_bank_interest_group(
  p_bank text,
  p_distribution_date date,
  p_transaction_ids uuid[],
  p_shares jsonb
)
returns void
language plpgsql
as $function$
declare
  v_already_distributed_count int;
begin
  -- interest_distributed is this group's one natural "already handled"
  -- flag -- a double-click, or two admins racing on the same pending
  -- group before either one's distribution lands, would otherwise
  -- double-insert allocations and double-credit every member with no
  -- error either time.
  select count(*) into v_already_distributed_count
  from transactions
  where transaction_id = any(p_transaction_ids) and interest_distributed = true;

  if v_already_distributed_count > 0 then
    raise exception 'This bank interest group has already been distributed.';
  end if;

  insert into bank_interest_allocations (member_id, bank, allocation_date, amount, current_value, pct_share, notes)
  select (s->>'member_id')::uuid, p_bank, p_distribution_date, (s->>'amount')::numeric,
         (s->>'current_value')::numeric, (s->>'pct_share')::numeric, s->>'notes'
  from jsonb_array_elements(p_shares) as s;

  insert into transactions (member_id, bank_account_id, classification, affects_cash, amount, description, status, txn_date)
  select (s->>'member_id')::uuid, null, 'Gain Allocation', 0, (s->>'amount')::numeric, s->>'description', 'approved', p_distribution_date
  from jsonb_array_elements(p_shares) as s
  where (s->>'amount')::numeric != 0;

  update transactions set interest_distributed = true where transaction_id = any(p_transaction_ids);
end;
$function$;
