-- Farm On's loss and Perfume Est 2020's gain were the fund's only two
-- investment_allocations rows with a null allocation_date -- pre-migration
-- events the app already treats as dated 2019-07-15 / 2020-08-24 via a
-- hardcoded fallback (legacyInvestmentDate() in lib/currentValue.ts).
-- Backfilling the real dates doesn't change app behavior (the fallback
-- already resolved to these same dates), but it means any query that
-- doesn't know about that fallback -- ad-hoc SQL, future tooling, another
-- part of the app -- gets the right answer instead of silently treating
-- these 19 rows as undated and excluding them from date-filtered totals.
update public.investment_allocations ia
set allocation_date = '2019-07-15'
from public.investments i
where i.investment_id = ia.investment_id
  and i.name = 'Farm On'
  and ia.allocation_date is null;

update public.investment_allocations ia
set allocation_date = '2020-08-24'
from public.investments i
where i.investment_id = ia.investment_id
  and i.name = 'Perfume Est 2020'
  and ia.allocation_date is null;
