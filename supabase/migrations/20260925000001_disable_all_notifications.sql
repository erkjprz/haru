-- Per request: turn off every notification -- in-app, push and Telegram.
-- Every notification originates from one of these triggers (nothing in the
-- app or edge functions inserts into public.notifications directly), so
-- disabling them silences everything without dropping any code. Fully
-- reversible: swap "disable" for "enable" in a later migration.

-- In-app notification rows (and therefore their push leg)
alter table public.transactions disable trigger trg_notify_admins_transaction_pending;
alter table public.transactions disable trigger trg_notify_admins_transaction_resubmitted;
alter table public.transactions disable trigger trg_notify_transaction_decided;
alter table public.members disable trigger trg_notify_admins_member_pending;
alter table public.bank_interest_allocations disable trigger trg_notify_bank_interest_allocated;
alter table public.investment_allocations disable trigger trg_notify_investment_allocated;
alter table public.loan_gain_allocations disable trigger trg_notify_loan_gain_allocated;

-- Push delivery
alter table public.notifications disable trigger trg_dispatch_push_notification;

-- Telegram
alter table public.transactions disable trigger trg_notify_telegram_transaction_insert;
