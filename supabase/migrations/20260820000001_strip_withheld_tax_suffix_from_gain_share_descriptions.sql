-- The "(corrected for withheld tax)" suffix on 2019-2025 BDO bank interest
-- Gain Allocation descriptions was an internal note that ended up visible
-- in the transaction list. Strip it, leaving the plain
-- "Share of <year> BDO bank interest" description.
update transactions
set description = regexp_replace(description, '\s*\(corrected for withheld tax\)$', '')
where description ilike '%corrected for withheld tax%';
