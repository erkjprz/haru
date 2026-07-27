-- These three allocation tables only ever receive rows at the moment an
-- admin actually distributes a gain/loss (loan close, bank interest
-- distribution, investment gain/loss) -- there is no separate pending
-- state to wait on, so notifying on insert is notifying at the right
-- moment, unlike a plain transaction which has a pending step first.
create or replace function public.notify_loan_gain_allocated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(
    new.member_id,
    'loan_gain_allocation',
    case when new.amount >= 0 then 'Loan Gain Distributed' else 'Loan Loss Allocated' end,
    case
      when new.amount >= 0 then 'You received a share of a closed loan''s gain.'
      else 'A share of a closed loan''s loss was allocated to you.'
    end,
    '/transactions'
  );
  return new;
end;
$$;

create trigger trg_notify_loan_gain_allocated
after insert on public.loan_gain_allocations
for each row execute function public.notify_loan_gain_allocated();

create or replace function public.notify_bank_interest_allocated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(
    new.member_id,
    'bank_interest_allocation',
    'Bank Interest Distributed',
    'You received a share of a bank interest distribution.',
    '/transactions'
  );
  return new;
end;
$$;

create trigger trg_notify_bank_interest_allocated
after insert on public.bank_interest_allocations
for each row execute function public.notify_bank_interest_allocated();

create or replace function public.notify_investment_allocated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(
    new.member_id,
    'investment_allocation',
    case when new.allocation_type = 'Investment Loss' then 'Investment Loss Allocated' else 'Investment Gain Distributed' end,
    case
      when new.allocation_type = 'Investment Loss' then 'A share of an investment loss was allocated to you.'
      else 'You received a share of an investment gain.'
    end,
    '/transactions'
  );
  return new;
end;
$$;

create trigger trg_notify_investment_allocated
after insert on public.investment_allocations
for each row execute function public.notify_investment_allocated();
