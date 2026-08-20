-- "Loan - 2023-09" told you nothing you couldn't already see from the type
-- badge (says "loan") and the surrounding date/borrower context shown
-- everywhere this name appears. Rename every loan to "{Borrower} ·
-- {year-month}" instead, which is the one thing people actually call it.
update loans l
set name = coalesce(b.name, m.name) || ' · ' || to_char(l.start_date, 'YYYY-MM')
from loans l2
left join borrowers b on b.borrower_id = l2.borrower_id
left join members m on m.member_id = l2.member_id
where l.loan_id = l2.loan_id;

-- submit_loan_request never set `name` at insert time -- every existing
-- loan got its name from some other (now-untracked) path. Set it going
-- forward so new loans aren't born nameless.
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
  v_member_name text;
begin
  select name into v_member_name from members where member_id = p_member_id;

  insert into loans (
    member_id, name, principal, interest_type, interest_rate, interest_amount,
    term_months, repayment_frequency, status, start_date, notes
  ) values (
    p_member_id, v_member_name || ' · ' || to_char(p_start_date, 'YYYY-MM'), p_principal, p_interest_type, p_interest_rate, p_interest_amount,
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
