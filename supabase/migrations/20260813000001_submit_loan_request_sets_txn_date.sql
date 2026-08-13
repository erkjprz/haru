-- /transactions/new now lets the submitter pick a date instead of always
-- defaulting to today (see the new Date field there). submit_loan_request's
-- paired "Loan Release" transaction never set txn_date at all, silently
-- falling back to the table's current_date default -- which would drift
-- from the loan's own (now user-chosen) start_date whenever someone
-- backfills a request for a date other than today. p_start_date already
-- carries the intended date; just also write it onto the transaction.
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
  p_submitted_by uuid default null
)
returns table(loan_id uuid, transaction_id uuid)
language plpgsql
as $function$
declare
  v_loan_id uuid;
  v_transaction_id uuid;
begin
  insert into loans (
    member_id, principal, interest_type, interest_rate, interest_amount,
    term_months, repayment_frequency, status, start_date, notes
  ) values (
    p_member_id, p_principal, p_interest_type, p_interest_rate, p_interest_amount,
    p_term_months, p_repayment_frequency, 'requested', p_start_date, p_notes
  )
  returning loans.loan_id into v_loan_id;

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
