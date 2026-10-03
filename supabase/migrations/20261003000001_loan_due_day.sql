-- Day of the month a monthly loan's installment is due (1-31). Days past
-- the end of a shorter month fall on that month's last day. Null for
-- lump-sum loans and for loans created before this column existed.
alter table public.loans
  add column if not exists due_day smallint
  check (due_day between 1 and 31);

-- submit_loan_request gains p_due_day. Dropping the old signature first so
-- PostgREST doesn't see two overloads and fail to pick one.
drop function if exists public.submit_loan_request(
  uuid, numeric, text, numeric, numeric, integer, text, date, text, text, uuid, text, text
);

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
  p_payout_qr_path text default null,
  p_due_day smallint default null
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
        payout_details, payout_qr_path, due_day
      ) values (
        p_member_id, v_name, p_principal, p_interest_type, p_interest_rate, p_interest_amount,
        p_term_months, p_repayment_frequency, 'requested', p_start_date, p_notes,
        nullif(btrim(p_payout_details), ''), p_payout_qr_path,
        case when p_repayment_frequency = 'monthly' then p_due_day end
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

grant execute on function public.submit_loan_request(uuid, numeric, text, numeric, numeric, integer, text, date, text, text, uuid, text, text, smallint)
  to anon, authenticated, service_role;

-- Expose due_day on v_loan_summary (appended last, as create or replace
-- view requires) so the overdue flag can count from the actual due date.
-- security_invoker restated so the replace can't drop it.
create or replace view public.v_loan_summary
with (security_invoker = true) as
 SELECT l.loan_id,
    l.name AS loan,
    l.status,
    l.start_date,
    l.principal,
    l.interest_rate,
    l.term_months,
    l.notes,
    COALESCE(b.name, m.name) AS borrower,
    l.member_id AS borrower_member_id,
    COALESCE(sum(
        CASE
            WHEN t.classification = 'Loan Repayment'::text THEN t.amount
            ELSE 0::numeric
        END), 0::numeric) AS repayment,
    COALESCE(sum(
        CASE
            WHEN t.classification = 'Loan Repayment'::text THEN t.amount
            ELSE 0::numeric
        END), 0::numeric) - l.principal AS gain,
        CASE
            WHEN l.status = 'closed'::text THEN 0::numeric
            ELSE GREATEST(0::numeric, l.principal +
            CASE
                WHEN l.interest_type = 'amount'::text THEN COALESCE(l.interest_amount, 0::numeric)
                ELSE l.principal * COALESCE(l.interest_rate, 0::numeric) / 100::numeric
            END - COALESCE(sum(
            CASE
                WHEN t.classification = 'Loan Repayment'::text THEN t.amount
                ELSE 0::numeric
            END), 0::numeric))
        END AS outstanding,
    COALESCE(lga.closed_date,
        CASE
            WHEN l.status = 'closed'::text THEN max(
            CASE
                WHEN t.classification = 'Loan Repayment'::text THEN t.txn_date
                ELSE NULL::date
            END)
            ELSE NULL::date
        END) AS closed_date,
    l.interest_type,
    l.interest_amount,
    l.principal +
        CASE
            WHEN l.interest_type = 'amount'::text THEN COALESCE(l.interest_amount, 0::numeric)
            ELSE l.principal * COALESCE(l.interest_rate, 0::numeric) / 100::numeric
        END AS total_repayable,
    l.repayment_frequency,
    max(
        CASE
            WHEN t.classification = 'Loan Repayment'::text THEN t.txn_date
            ELSE NULL::date
        END) AS last_repayment_date,
    l.due_day
   FROM loans l
     LEFT JOIN borrowers b ON b.borrower_id = l.borrower_id
     LEFT JOIN members m ON m.member_id = l.member_id
     LEFT JOIN transactions t ON t.loan_id = l.loan_id AND t.status = 'approved'::text
     LEFT JOIN ( SELECT loan_gain_allocations.loan_id,
            max(loan_gain_allocations.allocation_date) AS closed_date
           FROM loan_gain_allocations
          GROUP BY loan_gain_allocations.loan_id) lga ON lga.loan_id = l.loan_id
  GROUP BY l.loan_id, l.name, l.status, l.start_date, l.principal, l.interest_rate, l.term_months, l.notes, l.repayment_frequency, b.name, m.name, l.member_id, lga.closed_date, l.interest_type, l.interest_amount, l.due_day
  ORDER BY l.start_date;

revoke all on public.v_loan_summary from anon;

notify pgrst, 'reload schema';
