-- Backfill: recompute historical loan gain + bank interest allocations under
-- the current methodology (borrower included in their own loan's gain when
-- linked to a contributing member; both distribution types split by
-- "current value" instead of bank interest's old net-contribution-only
-- basis). Values below come from a chronological replay of all 6 closed
-- loans + 10 bank-interest distributions in date order (bank interest now
-- depends on prior loan gains too, so both event types had to be replayed
-- as one interleaved timeline, not two independent passes) -- computed and
-- verified outside the database: every event's old total exactly equals its
-- new total (money only moves between members, none created or destroyed),
-- and no member's corrected balance goes negative at any historical
-- withdrawal. This is a one-time rewrite, not a repeatable migration -- if
-- the methodology changes again, this needs to be regenerated and rerun,
-- not reapplied.
--
-- Same-date tie-break note: BDO vs Maya bank interest land on the same
-- year-end date in 2023/2024/2025. created_at on both allocation tables is
-- a bulk-import artifact (one identical timestamp per table, not real
-- historical order), so there's no way to recover which was actually
-- distributed first. The replay breaks the tie alphabetically (BDO before
-- Maya) -- arbitrary but deterministic; the resulting drift is sub-peso.

begin;

-- Suppress the "you received a gain distribution" push/in-app notification
-- for this backfill only -- these tables have no status column and no
-- separate pending step, so the insert trigger firing here would look
-- exactly like a brand-new distribution landing today, even though the
-- underlying loan closed years ago. Re-enabled before commit.
alter table loan_gain_allocations disable trigger trg_notify_loan_gain_allocated;
alter table bank_interest_allocations disable trigger trg_notify_bank_interest_allocated;

-- Update existing loan_gain_allocations rows to corrected amount/current_value/pct_share
do $$
declare v_count int;
begin
  update loan_gain_allocations t
  set amount = v.amount, current_value = v.current_value, pct_share = v.pct_share
  from (values
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 168.71::numeric, 13627.233333333332::numeric, 3.37::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 342.05::numeric, 27629.05333333333::numeric, 6.84::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 936.87::numeric, 75675.20333333334::numeric, 18.74::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 552.85::numeric, 44656.27333333333::numeric, 11.06::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 912.11::numeric, 73675.20333333334::numeric, 18.24::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 912.07::numeric, 73672.29333333333::numeric, 18.24::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 714.19::numeric, 57688.69333333333::numeric, 14.28::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 293.1::numeric, 23675.20333333333::numeric, 5.86::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 224.27::numeric, 26813.433333333327::numeric, 5.61::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 334.56::numeric, 39999.67333333333::numeric, 8.36::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 515.72::numeric, 61658.84333333332::numeric, 12.89::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 378.45::numeric, 45247.14333333333::numeric, 9.46::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 724.79::numeric, 86655.08333333333::numeric, 18.12::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 758.24::numeric, 90653.79333333333::numeric, 18.96::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 631.13::numeric, 75457.04333333333::numeric, 15.78::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 317.8::numeric, 37995.18333333333::numeric, 7.94::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 65.29::numeric, 68363.18333333333::numeric, 13.06::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 16.41::numeric, 17179.713333333333::numeric, 3.28::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 43.6::numeric, 45651.223333333335::numeric, 8.72::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 112.17::numeric, 117439.07333333332::numeric, 22.43::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 96.91::numeric, 101468.99333333333::numeric, 19.38::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 83.22::numeric, 87136.53333333334::numeric, 16.64::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 13.25::numeric, 13876.763333333334::numeric, 2.65::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 69.09::numeric, 72344.61333333333::numeric, 13.82::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 205.46::numeric, 8212.413333333336::numeric, 2.05::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 2377.92::numeric, 95048.58333333333::numeric, 23.78::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 433.8::numeric, 17339.393333333333::numeric, 4.34::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 1152.72::numeric, 46075.543333333335::numeric, 11.53::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 13.91::numeric, 555.8433333333323::numeric, 0.14::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 2562.13::numeric, 102412.10333333333::numeric, 25.62::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 323.89::numeric, 12946.433333333332::numeric, 3.24::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 2478.87::numeric, 99083.67333333334::numeric, 24.79::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 1115.35::numeric, 51039.70333333333::numeric, 11.18::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 2622.7::numeric, 120017.20333333334::numeric, 26.28::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 390.65::numeric, 17876.70333333333::numeric, 3.91::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 1038.07::numeric, 47503.31333333333::numeric, 10.4::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 12.52::numeric, 573.0633333333335::numeric, 0.13::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 1870.27::numeric, 85585.60333333333::numeric, 18.74::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 291.68::numeric, 13347.613333333333::numeric, 2.92::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 2232.34::numeric, 102154.04333333333::numeric, 22.37::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 2762.62::numeric, 83057.07333333333::numeric, 16.19::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 4467.22::numeric, 134305.7633333333::numeric, 26.18::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 615.47::numeric, 18503.913333333338::numeric, 3.61::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 1635.48::numeric, 49169.98333333334::numeric, 9.58::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 19.73::numeric, 593.1633333333339::numeric, 0.12::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 2946.6::numeric, 88588.40333333332::numeric, 17.27::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 459.54::numeric, 13815.923333333334::numeric, 2.69::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 640.31::numeric, 19250.56333333333::numeric, 3.75::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 3517.03::numeric, 105738.16333333333::numeric, 20.61::numeric)
  ) as v(loan_id, member_id, amount, current_value, pct_share)
  where t.loan_id = v.loan_id and t.member_id = v.member_id;
  get diagnostics v_count = row_count;
  if v_count <> 49 then
    raise exception 'loan_gain_allocations update: expected 49 rows, got %', v_count;
  end if;
  raise notice 'loan_gain_allocations update: % rows', v_count;
end $$;

-- Insert new loan_gain_allocations rows for the borrower's own newly-included share
do $$
declare v_count int;
begin
  insert into loan_gain_allocations (loan_id, member_id, amount, allocation_date, current_value, pct_share, notes)
  select * from (values
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 168.05::numeric, '2021-09-15'::date, 13574.323333333332::numeric, 3.36::numeric, 'Backfilled 2021-09-15: borrower-inclusion methodology correction, share of ₱5000.00 gain from loan closed 2021-09-15'),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 115.04::numeric, '2022-04-08'::date, 13753.933333333332::numeric, 2.88::numeric, 'Backfilled 2022-04-08: borrower-inclusion methodology correction, share of ₱4000.00 gain from loan closed 2022-04-08'),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 0.06::numeric, '2023-08-14'::date, 61.873333333332994::numeric, 0.01::numeric, 'Backfilled 2023-08-14: borrower-inclusion methodology correction, share of ₱500.00 gain from loan closed 2023-08-14'),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 451.3::numeric, '2024-11-06'::date, 18039.06333333333::numeric, 4.51::numeric, 'Backfilled 2024-11-06: borrower-inclusion methodology correction, share of ₱10000.00 gain from loan closed 2024-11-06'),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 406.42::numeric, '2025-10-12'::date, 18598.043333333335::numeric, 4.07::numeric, 'Backfilled 2025-10-12: borrower-inclusion methodology correction, share of ₱9980.00 gain from loan closed 2025-10-12')
  ) as v(loan_id, member_id, amount, allocation_date, current_value, pct_share, notes);
  get diagnostics v_count = row_count;
  if v_count <> 5 then
    raise exception 'loan_gain_allocations insert: expected 5 rows, got %', v_count;
  end if;
  raise notice 'loan_gain_allocations insert: % rows', v_count;
end $$;

-- Update existing Gain Allocation transactions (loans) to corrected amount
do $$
declare v_count int;
begin
  update transactions t
  set amount = v.amount
  from (values
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 168.71::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 342.05::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 936.87::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 552.85::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 912.11::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 912.07::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 714.19::numeric),
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 293.1::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 224.27::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 334.56::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 515.72::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 378.45::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 724.79::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 758.24::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 631.13::numeric),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 317.8::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 65.29::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 16.41::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 43.6::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 112.17::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 96.91::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 83.22::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 13.25::numeric),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 69.09::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 205.46::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 2377.92::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 433.8::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 1152.72::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 13.91::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 2562.13::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 323.89::numeric),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 2478.87::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 1115.35::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 2622.7::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 390.65::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 1038.07::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 12.52::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 1870.27::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 291.68::numeric),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 2232.34::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 2762.62::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 4467.22::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 615.47::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 1635.48::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 19.73::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 2946.6::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 459.54::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 640.31::numeric),
    ('f64352fb-c281-43b0-a799-4f555e77e377'::uuid, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 3517.03::numeric)
  ) as v(loan_id, member_id, amount)
  where t.loan_id = v.loan_id and t.member_id = v.member_id and t.classification = 'Gain Allocation';
  get diagnostics v_count = row_count;
  if v_count <> 49 then
    raise exception 'loan transactions update: expected 49 rows, got %', v_count;
  end if;
  raise notice 'loan transactions update: % rows', v_count;
end $$;

-- Insert new Gain Allocation transactions (loans) for the borrower's newly-included share, dated to the loan's actual closing date
do $$
declare v_count int;
begin
  insert into transactions (member_id, bank_account_id, loan_id, classification, affects_cash, amount, description, status, txn_date)
  select member_id, null, loan_id, 'Gain Allocation', 0, amount, description, 'approved', txn_date
  from (values
    ('e9078858-99a4-4b3d-af2d-4a42de5e1497'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 168.05::numeric, '2021-09-15'::date, 'Backfilled: share of 2021 loan gain (Loan - 2021-07)'),
    ('1459dc1d-3a61-4b9c-85db-29f7b37af445'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 115.04::numeric, '2022-04-08'::date, 'Backfilled: share of 2022 loan gain (Loan - 2021-09)'),
    ('b7c0d9dd-8b12-49d0-9bec-8d9607aa4539'::uuid, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 0.06::numeric, '2023-08-14'::date, 'Backfilled: share of 2023 loan gain (Loan - 2023-06)'),
    ('d787e262-29fd-467b-b9fe-50fe2d231541'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 451.3::numeric, '2024-11-06'::date, 'Backfilled: share of 2024 loan gain (Loan - 2023-11)'),
    ('50deccc4-8606-438f-9108-f2593cff63ed'::uuid, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 406.42::numeric, '2025-10-12'::date, 'Backfilled: share of 2025 loan gain (Loan - 2024-11)')
  ) as v(loan_id, member_id, amount, txn_date, description);
  get diagnostics v_count = row_count;
  if v_count <> 5 then
    raise exception 'loan transactions insert: expected 5 rows, got %', v_count;
  end if;
  raise notice 'loan transactions insert: % rows', v_count;
end $$;

-- Update existing bank_interest_allocations rows to corrected amount/current_value/pct_share
do $$
declare v_count int;
begin
  update bank_interest_allocations t
  set amount = v.amount, current_value = v.current_value, pct_share = v.pct_share
  from (values
    ('BDO', '2019-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 58.28::numeric, 25633.333333333336::numeric, 9.58::numeric),
    ('BDO', '2019-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 67.37::numeric, 29633.333333333336::numeric, 11.07::numeric),
    ('BDO', '2019-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 74.19::numeric, 32633.333333333336::numeric, 12.19::numeric),
    ('BDO', '2019-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 74.19::numeric, 32633.333333333336::numeric, 12.19::numeric),
    ('BDO', '2019-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 74.19::numeric, 32633.333333333336::numeric, 12.19::numeric),
    ('BDO', '2019-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 74.19::numeric, 32633.333333333336::numeric, 12.19::numeric),
    ('BDO', '2019-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 83.31::numeric, 36633.333333333336::numeric, 13.68::numeric),
    ('BDO', '2019-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 28.72::numeric, 12633.333333333334::numeric, 4.72::numeric),
    ('BDO', '2019-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 74.19::numeric, 32633.333333333336::numeric, 12.19::numeric),
    ('BDO', '2020-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 51.82::numeric, 35575.41333333333::numeric, 8.49::numeric),
    ('BDO', '2020-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 44.55::numeric, 30584.503333333334::numeric, 7.29::numeric),
    ('BDO', '2020-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 83.88::numeric, 57591.323333333334::numeric, 13.74::numeric),
    ('BDO', '2020-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 64.95::numeric, 44591.323333333334::numeric, 10.64::numeric),
    ('BDO', '2020-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 83.88::numeric, 57591.323333333334::numeric, 13.74::numeric),
    ('BDO', '2020-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 80.97::numeric, 55591.323333333334::numeric, 13.26::numeric),
    ('BDO', '2020-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 88.25::numeric, 60600.44333333333::numeric, 14.45::numeric),
    ('BDO', '2020-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 28.47::numeric, 19545.853333333333::numeric, 4.66::numeric),
    ('BDO', '2020-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 83.88::numeric, 57591.323333333334::numeric, 13.74::numeric),
    ('BDO', '2021-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 17.49::numeric, 20795.94333333333::numeric, 4.85::numeric),
    ('BDO', '2021-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 28.57::numeric, 33971.10333333333::numeric, 7.92::numeric),
    ('BDO', '2021-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 46.77::numeric, 55612.073333333334::numeric, 12.97::numeric),
    ('BDO', '2021-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 38.02::numeric, 45209.12333333333::numeric, 10.54::numeric),
    ('BDO', '2021-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 67.77::numeric, 80587.31333333334::numeric, 18.79::numeric),
    ('BDO', '2021-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 69.43::numeric, 82584.36333333334::numeric, 19.26::numeric),
    ('BDO', '2021-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 54.16::numeric, 64402.88333333333::numeric, 15.02::numeric),
    ('BDO', '2021-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 11.56::numeric, 13742.373333333331::numeric, 3.2::numeric),
    ('BDO', '2021-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 26.88::numeric, 31968.30333333333::numeric, 7.45::numeric),
    ('BDO', '2022-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 24.17::numeric, 43037.70333333333::numeric, 8.4::numeric),
    ('BDO', '2022-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 28.95::numeric, 51534.23333333333::numeric, 10.06::numeric),
    ('BDO', '2022-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 5.15::numeric, 9174.563333333334::numeric, 1.79::numeric),
    ('BDO', '2022-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 25.63::numeric, 45625.59333333334::numeric, 8.9::numeric),
    ('BDO', '2022-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 59.2::numeric, 105379.87333333332::numeric, 20.56::numeric),
    ('BDO', '2022-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 56.96::numeric, 101412.03333333333::numeric, 19.79::numeric),
    ('BDO', '2022-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 48.36::numeric, 86088.17333333334::numeric, 16.8::numeric),
    ('BDO', '2022-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 7.79::numeric, 13868.973333333333::numeric, 2.71::numeric),
    ('BDO', '2022-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 31.63::numeric, 56312.98333333332::numeric, 10.99::numeric),
    ('BDO', '2023-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 7.71::numeric, 18061.933333333334::numeric, 4.08::numeric),
    ('BDO', '2023-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 31.79::numeric, 74428.47333333333::numeric, 16.8::numeric),
    ('BDO', '2023-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 7.34::numeric, 17196.123333333337::numeric, 3.88::numeric),
    ('BDO', '2023-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 19.52::numeric, 45694.823333333334::numeric, 10.31::numeric),
    ('BDO', '2023-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 0.24::numeric, 551.2433333333338::numeric, 0.12::numeric),
    ('BDO', '2023-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 43.38::numeric, 101565.90333333334::numeric, 22.93::numeric),
    ('BDO', '2023-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 37.25::numeric, 87219.75333333333::numeric, 19.69::numeric),
    ('BDO', '2023-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 7.64::numeric, 17890.013333333336::numeric, 4.04::numeric),
    ('BDO', '2023-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 34.34::numeric, 80413.70333333334::numeric, 18.15::numeric),
    ('Maya', '2023-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 142.77::numeric, 18069.643333333333::numeric, 4.08::numeric),
    ('Maya', '2023-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 588.32::numeric, 74460.26333333332::numeric, 16.8::numeric),
    ('Maya', '2023-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 135.93::numeric, 17203.463333333333::numeric, 3.88::numeric),
    ('Maya', '2023-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 361.2::numeric, 45714.34333333333::numeric, 10.31::numeric),
    ('Maya', '2023-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 4.36::numeric, 551.4833333333336::numeric, 0.12::numeric),
    ('Maya', '2023-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 802.82::numeric, 101609.28333333333::numeric, 22.93::numeric),
    ('Maya', '2023-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 689.43::numeric, 87257.00333333333::numeric, 19.69::numeric),
    ('Maya', '2023-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 141.41::numeric, 17897.653333333335::numeric, 4.04::numeric),
    ('Maya', '2023-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 635.63::numeric, 80448.04333333333::numeric, 18.15::numeric),
    ('BDO', '2024-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 6::numeric, 20917.87333333333::numeric, 4.91::numeric),
    ('BDO', '2024-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 29.09::numeric, 101426.50333333334::numeric, 23.8::numeric),
    ('BDO', '2024-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 5.1::numeric, 17773.19333333333::numeric, 4.17::numeric),
    ('BDO', '2024-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 13.54::numeric, 47228.263333333336::numeric, 11.08::numeric),
    ('BDO', '2024-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 0.16::numeric, 569.7533333333322::numeric, 0.13::numeric),
    ('BDO', '2024-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 30.1::numeric, 104974.23333333334::numeric, 24.63::numeric),
    ('BDO', '2024-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 3.81::numeric, 13270.323333333332::numeric, 3.11::numeric),
    ('BDO', '2024-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 5.3::numeric, 18490.363333333335::numeric, 4.34::numeric),
    ('BDO', '2024-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 29.13::numeric, 101562.54333333333::numeric, 23.83::numeric),
    ('Maya', '2024-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 115.83::numeric, 20923.87333333333::numeric, 4.91::numeric),
    ('Maya', '2024-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 561.61::numeric, 101455.59333333334::numeric, 23.8::numeric),
    ('Maya', '2024-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 98.41::numeric, 17778.293333333335::numeric, 4.17::numeric),
    ('Maya', '2024-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 261.51::numeric, 47241.80333333334::numeric, 11.08::numeric),
    ('Maya', '2024-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 3.15::numeric, 569.913333333332::numeric, 0.13::numeric),
    ('Maya', '2024-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 581.27::numeric, 105004.33333333334::numeric, 24.63::numeric),
    ('Maya', '2024-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 73.48::numeric, 13274.133333333333::numeric, 3.11::numeric),
    ('Maya', '2024-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 102.38::numeric, 18495.66333333333::numeric, 4.34::numeric),
    ('Maya', '2024-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 562.37::numeric, 101591.67333333332::numeric, 23.83::numeric),
    ('BDO', '2025-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 19.1::numeric, 69655.05333333334::numeric, 14.21::numeric),
    ('BDO', '2025-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 35.28::numeric, 128639.90333333332::numeric, 26.24::numeric),
    ('BDO', '2025-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 5.01::numeric, 18267.353333333333::numeric, 3.73::numeric),
    ('BDO', '2025-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 13.31::numeric, 48541.38333333333::numeric, 9.9::numeric),
    ('BDO', '2025-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 0.16::numeric, 585.5833333333339::numeric, 0.12::numeric),
    ('BDO', '2025-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 23.98::numeric, 87455.87333333332::numeric, 17.84::numeric),
    ('BDO', '2025-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 3.74::numeric, 13639.293333333333::numeric, 2.78::numeric),
    ('BDO', '2025-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 5.21::numeric, 19004.463333333333::numeric, 3.88::numeric),
    ('BDO', '2025-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 28.62::numeric, 104386.38333333333::numeric, 21.3::numeric),
    ('Maya', '2025-12-30'::date, 'd9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 882.92::numeric, 69674.15333333334::numeric, 14.21::numeric),
    ('Maya', '2025-12-30'::date, 'ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 1630.58::numeric, 128675.18333333332::numeric, 26.24::numeric),
    ('Maya', '2025-12-30'::date, '2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 231.55::numeric, 18272.363333333335::numeric, 3.73::numeric),
    ('Maya', '2025-12-30'::date, '39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 615.29::numeric, 48554.693333333336::numeric, 9.9::numeric),
    ('Maya', '2025-12-30'::date, '686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 7.42::numeric, 585.7433333333338::numeric, 0.12::numeric),
    ('Maya', '2025-12-30'::date, '5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 1108.55::numeric, 87479.85333333333::numeric, 17.84::numeric),
    ('Maya', '2025-12-30'::date, 'e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 172.89::numeric, 13643.033333333335::numeric, 2.78::numeric),
    ('Maya', '2025-12-30'::date, '464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 240.89::numeric, 19009.673333333332::numeric, 3.88::numeric),
    ('Maya', '2025-12-30'::date, 'c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 1323.16::numeric, 104415.00333333333::numeric, 21.3::numeric)
  ) as v(bank, allocation_date, member_id, amount, current_value, pct_share)
  where t.bank = v.bank and t.allocation_date = v.allocation_date and t.member_id = v.member_id;
  get diagnostics v_count = row_count;
  if v_count <> 90 then
    raise exception 'bank_interest_allocations update: expected 90 rows, got %', v_count;
  end if;
  raise notice 'bank_interest_allocations update: % rows', v_count;
end $$;

-- Update existing Gain Allocation transactions (bank interest) to corrected amount
do $$
declare v_count int;
begin
  update transactions t
  set amount = v.amount
  from (values
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2019 BDO bank interest', 58.28::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2019 BDO bank interest', 67.37::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2019 BDO bank interest', 74.19::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2019 BDO bank interest', 74.19::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2019 BDO bank interest', 74.19::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2019 BDO bank interest', 74.19::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2019 BDO bank interest', 83.31::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2019 BDO bank interest', 28.72::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2019 BDO bank interest', 74.19::numeric),
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2020 BDO bank interest', 51.82::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2020 BDO bank interest', 44.55::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2020 BDO bank interest', 83.88::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2020 BDO bank interest', 64.95::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2020 BDO bank interest', 83.88::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2020 BDO bank interest', 80.97::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2020 BDO bank interest', 88.25::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2020 BDO bank interest', 28.47::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2020 BDO bank interest', 83.88::numeric),
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2021 BDO bank interest', 17.49::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2021 BDO bank interest', 28.57::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2021 BDO bank interest', 46.77::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2021 BDO bank interest', 38.02::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2021 BDO bank interest', 67.77::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2021 BDO bank interest', 69.43::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2021 BDO bank interest', 54.16::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2021 BDO bank interest', 11.56::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2021 BDO bank interest', 26.88::numeric),
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2022 BDO bank interest', 24.17::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2022 BDO bank interest', 28.95::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2022 BDO bank interest', 5.15::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2022 BDO bank interest', 25.63::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2022 BDO bank interest', 59.2::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2022 BDO bank interest', 56.96::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2022 BDO bank interest', 48.36::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2022 BDO bank interest', 7.79::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2022 BDO bank interest', 31.63::numeric),
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2023 BDO bank interest', 7.71::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2023 BDO bank interest', 31.79::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2023 BDO bank interest', 7.34::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2023 BDO bank interest', 19.52::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2023 BDO bank interest', 0.24::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2023 BDO bank interest', 43.38::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2023 BDO bank interest', 37.25::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2023 BDO bank interest', 7.64::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2023 BDO bank interest', 34.34::numeric),
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2023 Maya bank interest', 142.77::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2023 Maya bank interest', 588.32::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2023 Maya bank interest', 135.93::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2023 Maya bank interest', 361.2::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2023 Maya bank interest', 4.36::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2023 Maya bank interest', 802.82::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2023 Maya bank interest', 689.43::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2023 Maya bank interest', 141.41::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2023 Maya bank interest', 635.63::numeric),
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2024 BDO bank interest', 6::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2024 BDO bank interest', 29.09::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2024 BDO bank interest', 5.1::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2024 BDO bank interest', 13.54::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2024 BDO bank interest', 0.16::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2024 BDO bank interest', 30.1::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2024 BDO bank interest', 3.81::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2024 BDO bank interest', 5.3::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2024 BDO bank interest', 29.13::numeric),
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2024 Maya bank interest', 115.83::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2024 Maya bank interest', 561.61::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2024 Maya bank interest', 98.41::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2024 Maya bank interest', 261.51::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2024 Maya bank interest', 3.15::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2024 Maya bank interest', 581.27::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2024 Maya bank interest', 73.48::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2024 Maya bank interest', 102.38::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2024 Maya bank interest', 562.37::numeric),
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2025 BDO bank interest', 19.1::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2025 BDO bank interest', 35.28::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2025 BDO bank interest', 5.01::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2025 BDO bank interest', 13.31::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2025 BDO bank interest', 0.16::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2025 BDO bank interest', 23.98::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2025 BDO bank interest', 3.74::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2025 BDO bank interest', 5.21::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2025 BDO bank interest', 28.62::numeric),
    ('d9de90b7-341f-4df4-a442-2f34b3547ac1'::uuid, 'Share of 2025 Maya bank interest', 882.92::numeric),
    ('ae2ba009-98da-4392-a7c8-3d8b84be9db9'::uuid, 'Share of 2025 Maya bank interest', 1630.58::numeric),
    ('2d5ee7ba-e84b-4c71-8c93-1ad78a8c0b1c'::uuid, 'Share of 2025 Maya bank interest', 231.55::numeric),
    ('39dc0526-61cc-4da0-b78d-cf5c08874dc6'::uuid, 'Share of 2025 Maya bank interest', 615.29::numeric),
    ('686c2e75-2ec8-4a1a-9a06-ac2ecf54f060'::uuid, 'Share of 2025 Maya bank interest', 7.42::numeric),
    ('5d46ca89-6ef5-4999-959e-e818f436ca68'::uuid, 'Share of 2025 Maya bank interest', 1108.55::numeric),
    ('e8eb5df1-fe47-4f3a-bb50-1b675d859243'::uuid, 'Share of 2025 Maya bank interest', 172.89::numeric),
    ('464cea5d-846a-42a5-b780-2ca00bc7c28f'::uuid, 'Share of 2025 Maya bank interest', 240.89::numeric),
    ('c06d8a1e-2f9f-4aec-a69c-2cf261b26468'::uuid, 'Share of 2025 Maya bank interest', 1323.16::numeric)
  ) as v(member_id, description, amount)
  where t.member_id = v.member_id and t.description = v.description and t.classification = 'Gain Allocation' and t.loan_id is null;
  get diagnostics v_count = row_count;
  if v_count <> 90 then
    raise exception 'bank transactions update: expected 90 rows, got %', v_count;
  end if;
  raise notice 'bank transactions update: % rows', v_count;
end $$;

alter table loan_gain_allocations enable trigger trg_notify_loan_gain_allocated;
alter table bank_interest_allocations enable trigger trg_notify_bank_interest_allocated;

commit;
