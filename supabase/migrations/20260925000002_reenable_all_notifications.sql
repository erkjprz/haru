-- Undoes 20260925000001_disable_all_notifications.sql: turns in-app, push
-- and Telegram notifications back on.

-- In-app notification rows (and therefore their push leg)
alter table public.transactions enable trigger trg_notify_admins_transaction_pending;
alter table public.transactions enable trigger trg_notify_admins_transaction_resubmitted;
alter table public.transactions enable trigger trg_notify_transaction_decided;
alter table public.members enable trigger trg_notify_admins_member_pending;
alter table public.bank_interest_allocations enable trigger trg_notify_bank_interest_allocated;
alter table public.investment_allocations enable trigger trg_notify_investment_allocated;
alter table public.loan_gain_allocations enable trigger trg_notify_loan_gain_allocated;

-- Push delivery
alter table public.notifications enable trigger trg_dispatch_push_notification;

-- Telegram
alter table public.transactions enable trigger trg_notify_telegram_transaction_insert;
