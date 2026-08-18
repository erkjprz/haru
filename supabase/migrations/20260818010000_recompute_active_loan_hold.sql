-- Recompute the frozen hold shares for the one currently active loan
-- ("Loan - 2026-01", released 2026-01-06) now that the historical gain-share
-- backfill (20260818000001) has corrected the ledger it was originally
-- snapshotted from.
--
-- loan_hold_allocations.share is a one-time snapshot taken at release time
-- by approveLoanRelease -- it is never recomputed automatically, so it kept
-- reflecting the old (pre-backfill) numbers even after the backfill ran.
-- This loan's release date (2026-01-06) falls after 5 of the 6 backfilled
-- loan closings and 9 of the 10 backfilled bank-interest distributions, so
-- its snapshot was meaningfully stale: it still excluded the borrower from
-- their own past loan gains and used bank interest's old net-contribution-
-- only basis.
--
-- Values below are computeCurrentValueByMember('2026-01-06') against the
-- now-corrected ledger, replicating approveLoanRelease's own logic exactly.
-- Membership is unchanged (same 9 eligible members as the existing snapshot)
-- -- only the per-member share reweights, so this is an UPDATE only, no
-- insert/delete.

begin;

do $$
declare v_count int;
begin
  update loan_hold_allocations t
  set share = v.share
  from (values
    ('0e483467-2c76-4b27-8066-54d5a74b9357'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 0.26243653658573754412::numeric),
    ('0e483467-2c76-4b27-8066-54d5a74b9357'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 0.21295725269765140430::numeric),
    ('0e483467-2c76-4b27-8066-54d5a74b9357'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 0.17841754008215195961::numeric),
    ('0e483467-2c76-4b27-8066-54d5a74b9357'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 0.14210234055310702825::numeric),
    ('0e483467-2c76-4b27-8066-54d5a74b9357'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 0.09902862160416418482::numeric),
    ('0e483467-2c76-4b27-8066-54d5a74b9357'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 0.03877074228559492232::numeric),
    ('0e483467-2c76-4b27-8066-54d5a74b9357'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 0.03726698500710457257::numeric),
    ('0e483467-2c76-4b27-8066-54d5a74b9357'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 0.02782534691162479667::numeric),
    ('0e483467-2c76-4b27-8066-54d5a74b9357'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 0.00119463427286358734::numeric)
  ) as v(loan_id, member_id, share)
  where t.loan_id = v.loan_id and t.member_id = v.member_id;
  get diagnostics v_count = row_count;
  if v_count <> 9 then
    raise exception 'loan_hold_allocations update: expected 9 rows, got %', v_count;
  end if;
  raise notice 'loan_hold_allocations update: % rows', v_count;
end $$;

commit;
