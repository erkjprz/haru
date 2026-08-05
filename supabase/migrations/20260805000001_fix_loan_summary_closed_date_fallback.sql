-- v_loan_summary's closed_date was derived solely from
-- max(loan_gain_allocations.allocation_date), which is NULL for any loan
-- closed with exactly zero gain/loss -- close_loan_and_distribute_gain only
-- inserts loan_gain_allocations rows when there are shares to write
-- (splitProportionally returns [] for a totalAmount of exactly 0), so a
-- 0%-interest loan repaid to the peso never gets a gain row at all. Two real
-- loans (Loan - 2025-12, Loan - 2026-03) hit this today, showing a blank
-- closed date anywhere the app reads it (LoanDetailPanel's "Closed" row,
-- and the new "time to pay off" figure on the Loans list).
--
-- Nothing else timestamps the moment a loan's status flips to 'closed', so
-- fall back to the loan's last approved "Loan Repayment" transaction date --
-- in practice the app closes a loan immediately after its final repayment
-- is approved, so this lines up with the true closing date.
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
      end as total_repayable
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
  b.name, m.name, l.member_id, lga.closed_date, l.interest_type, l.interest_amount
order by l.start_date;
