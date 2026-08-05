-- Exposes what's needed to flag a missed monthly payment on the Loans list:
-- repayment_frequency (only 'monthly' loans have a payment cadence to miss --
-- 'lump_sum' loans are due at term end, not on a schedule) and
-- last_repayment_date (the most recent approved "Loan Repayment" txn_date,
-- distinct from closed_date which only applies once the loan is closed).
create or replace view public.v_loan_summary as
select
  l.loan_id,
  l.name as loan,
  l.status,
  l.start_date,
  l.principal,
  l.interest_rate,
  l.term_months,
  l.notes,
  coalesce(b.name, m.name) as borrower,
  l.member_id as borrower_member_id,
  coalesce(sum(case when t.classification = 'Loan Repayment' then t.amount else 0 end), 0) as repayment,
  coalesce(sum(case when t.classification = 'Loan Repayment' then t.amount else 0 end), 0) - l.principal as gain,
  case
    when l.status = 'closed' then 0
    else greatest(
      0,
      l.principal
        + case
            when l.interest_type = 'amount' then coalesce(l.interest_amount, 0)
            else l.principal * coalesce(l.interest_rate, 0) / 100
          end
        - coalesce(sum(case when t.classification = 'Loan Repayment' then t.amount else 0 end), 0)
    )
  end as outstanding,
  coalesce(
    lga.closed_date,
    case when l.status = 'closed' then max(case when t.classification = 'Loan Repayment' then t.txn_date end) end
  ) as closed_date,
  l.interest_type,
  l.interest_amount,
  l.principal
    + case
        when l.interest_type = 'amount' then coalesce(l.interest_amount, 0)
        else l.principal * coalesce(l.interest_rate, 0) / 100
      end as total_repayable,
  l.repayment_frequency,
  max(case when t.classification = 'Loan Repayment' then t.txn_date end) as last_repayment_date
from loans l
left join borrowers b on b.borrower_id = l.borrower_id
left join members m on m.member_id = l.member_id
left join transactions t on t.loan_id = l.loan_id and t.status = 'approved'
left join (
  select loan_id, max(allocation_date) as closed_date
  from loan_gain_allocations
  group by loan_id
) lga on lga.loan_id = l.loan_id
group by l.loan_id, l.name, l.status, l.start_date, l.principal, l.interest_rate, l.term_months, l.notes,
  l.repayment_frequency, b.name, m.name, l.member_id, lga.closed_date, l.interest_type, l.interest_amount
order by l.start_date;
