-- Loan names are "<member> · YYYY-MM" and loans.name is unique, so a second
-- request in the same month (or a second loan for a namesake) failed with
-- a raw 'duplicate key value violates unique constraint "loans_name_key"'.
-- Now the name gets a " (2)", " (3)", ... suffix when taken. The clash is
-- caught at insert time rather than checked up front: this function runs
-- with the caller's RLS, and a borrower can't see other members' loans to
-- know which names are taken.
create or replace function public.submit_loan_request(
  p_member_id uuid,
  p_principal numeric,
  p_interest_type text,
  p_interest_rate numeric,
  p_interest_amount numeric,
  p_term_months integer,
  p_repayment_frequency text,
  p_start_date date,
  p_notes text,
  p_description text,
  p_submitted_by uuid default null,
  p_payout_details text default null,
  p_payout_qr_path text default null
)
returns table(loan_id uuid, transaction_id uuid)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_loan_id uuid;
  v_transaction_id uuid;
  v_base_name text;
  v_name text;
  v_attempt integer := 1;
  v_constraint text;
begin
  select name || ' · ' || to_char(p_start_date, 'YYYY-MM') into v_base_name
  from members where member_id = p_member_id;
  v_name := v_base_name;

  loop
    begin
      insert into loans (
        member_id, name, principal, interest_type, interest_rate, interest_amount,
        term_months, repayment_frequency, status, start_date, notes,
        payout_details, payout_qr_path
      ) values (
        p_member_id, v_name, p_principal, p_interest_type, p_interest_rate, p_interest_amount,
        p_term_months, p_repayment_frequency, 'requested', p_start_date, p_notes,
        nullif(btrim(p_payout_details), ''), p_payout_qr_path
      )
      returning loans.loan_id into v_loan_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'loans_name_key' or v_attempt >= 50 then
        raise;
      end if;
      v_attempt := v_attempt + 1;
      v_name := v_base_name || ' (' || v_attempt || ')';
    end;
  end loop;

  insert into transactions (
    member_id, bank_account_id, loan_id, classification, amount,
    description, receipt_url, status, submitted_by, txn_date
  ) values (
    p_member_id, null, v_loan_id, 'Loan Release', -p_principal,
    p_description, null, 'pending', p_submitted_by, p_start_date
  )
  returning transactions.transaction_id into v_transaction_id;

  return query select v_loan_id, v_transaction_id;
end;
$function$;
