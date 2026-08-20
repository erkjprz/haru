-- Relabel every Bank Write-off transaction's description to reflect that
-- the underlying BDO pending refund was never resolved.
update transactions
set description = 'Unresolved Fraud Debit'
where classification = 'Bank Write-off';
