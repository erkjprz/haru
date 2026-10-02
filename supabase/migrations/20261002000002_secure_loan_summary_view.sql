-- v_loan_summary ran with its owner's rights (security definer), so the
-- loans/transactions row-level security never applied to it, and anon still
-- had SELECT on it: anyone holding the public API key could read every
-- loan (borrower, principal, notes, repayments) without logging in, and a
-- borrower could read everyone else's loans through it.
--
-- security_invoker makes it apply the caller's RLS like the base tables do.
-- Members and admins already see every loan under that RLS, so Fund
-- Breakdown / LoanDetailPanel are unchanged (verified row-for-row); a
-- borrower now sees only their own loan, and anon is refused outright.
alter view public.v_loan_summary set (security_invoker = true);
revoke all on public.v_loan_summary from anon;
