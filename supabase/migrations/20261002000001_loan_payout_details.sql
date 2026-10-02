-- Where a requested loan should be sent: free-text bank/e-wallet details
-- and/or a photo of the borrower's payment QR code (a path in the private
-- Receipts bucket, named "<member_id>-payout-..." so the borrower can still
-- view their own upload under the existing storage policy).
alter table public.loans
  add column if not exists payout_details text,
  add column if not exists payout_qr_path text;

-- Adding parameters changes the signature, so the old one is renamed out
-- of the way rather than overloaded (an overload would make named-argument
-- calls ambiguous). Both new parameters default to null, so existing
-- callers (a member's Loan Request in NewTransactionSheet) keep working
-- unchanged. The renamed copy is unused and can be dropped later.
alter function public.submit_loan_request(uuid, numeric, text, numeric, numeric, integer, text, date, text, text, uuid)
  rename to submit_loan_request_pre_payout;

create function public.submit_loan_request(
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
as $function$
declare
  v_loan_id uuid;
  v_transaction_id uuid;
  v_member_name text;
begin
  select name into v_member_name from members where member_id = p_member_id;

  insert into loans (
    member_id, name, principal, interest_type, interest_rate, interest_amount,
    term_months, repayment_frequency, status, start_date, notes,
    payout_details, payout_qr_path
  ) values (
    p_member_id, v_member_name || ' · ' || to_char(p_start_date, 'YYYY-MM'), p_principal, p_interest_type, p_interest_rate, p_interest_amount,
    p_term_months, p_repayment_frequency, 'requested', p_start_date, p_notes,
    nullif(btrim(p_payout_details), ''), p_payout_qr_path
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

grant execute on function public.submit_loan_request(uuid, numeric, text, numeric, numeric, integer, text, date, text, text, uuid, text, text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
