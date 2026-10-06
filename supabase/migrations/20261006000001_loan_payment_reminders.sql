-- Push reminders for loan payments, sent once a day by pg_cron.
--
-- Each payment due date gets up to three reminders to the borrower:
--   upcoming  3 days before the due date
--   due       on the due date
--   overdue   the day after, if it's still unpaid
--
-- Monthly loans use due_day; lump-sum loans are due once, at start_date +
-- term_months. Monthly loans with no due_day (created before that column
-- existed) have no date to remind ahead of, so they fall back to the same
-- 45-day rule as paymentOverdueLabel: an overdue reminder on the first day
-- past 45 days since the last approved repayment (or start_date), then
-- every 30 days after that while still unpaid.
--
-- "Paid" mirrors paymentOverdueLabel/nextDueDate in lib/loanFormat.ts: a
-- monthly due date is covered once the first due date more than 15 days
-- after the last approved repayment (or start_date) lies beyond it.
-- Reminders are also held while a Loan Repayment for the loan is pending
-- approval, so a borrower who already paid isn't nagged in the meantime.

-- One row per reminder actually sent. The primary key is what keeps a
-- re-run (or a manual call on the same day) from double-sending.
create table if not exists public.loan_payment_reminders (
  loan_id uuid not null references public.loans(loan_id) on delete cascade,
  due_date date not null,
  kind text not null check (kind in ('upcoming', 'due', 'overdue')),
  sent_at timestamptz not null default now(),
  primary key (loan_id, due_date, kind)
);

-- Internal log only; no policies, so nothing is visible over PostgREST.
alter table public.loan_payment_reminders enable row level security;

-- The due day in a given month (1-12), clamped to that month's last day.
create or replace function public.loan_due_date_in_month(p_year integer, p_month integer, p_due_day integer)
returns date
language sql
immutable
set search_path = public
as $$
  select make_date(p_year, p_month, 1) + (least(
    p_due_day,
    extract(day from (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day'))::integer
  ) - 1);
$$;

-- First due date more than 15 days after p_from -- the next installment
-- owed after a payment or release on that date. Same as nextDueDate in
-- lib/loanFormat.ts.
create or replace function public.loan_next_due_date(p_from date, p_due_day integer)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_from)::date;
  v_due date;
begin
  loop
    v_due := public.loan_due_date_in_month(
      extract(year from v_month)::integer, extract(month from v_month)::integer, p_due_day
    );
    exit when v_due > p_from + 15;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  return v_due;
end;
$$;

create or replace function public.send_loan_payment_reminders(
  p_today date default (now() at time zone 'Asia/Manila')::date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_sent integer := 0;
  v_link text;
  v_amount numeric;
  v_amount_text text;
  v_next date;
  v_day date;
  v_missed integer;
  v_days integer;
  v_kind text;
  v_due date;
  v_title text;
  v_body text;
begin
  for r in
    select
      s.loan_id, s.loan, s.repayment_frequency, s.due_day, s.start_date, s.term_months,
      s.total_repayable, s.outstanding, s.last_repayment_date,
      m.member_id as recipient, m.role
    from public.v_loan_summary s
    join public.loans l on l.loan_id = s.loan_id
    left join public.borrowers b on b.borrower_id = l.borrower_id
    join public.members m on m.member_id = coalesce(l.member_id, b.member_id) and m.status = 'approved'
    where s.status = 'active'
      and s.outstanding > 0
      and not exists (
        select 1 from public.transactions t
        where t.loan_id = s.loan_id and t.classification = 'Loan Repayment' and t.status = 'pending'
      )
  loop
    v_link := case when r.role = 'borrower' then '/borrower' else '/fund-breakdown?tab=loans&view=you' end;
    v_kind := null;

    if r.repayment_frequency = 'monthly' and r.due_day is not null then
      v_next := public.loan_next_due_date(coalesce(r.last_repayment_date, r.start_date), r.due_day);
      v_amount := least(r.outstanding, round(r.total_repayable / nullif(r.term_months, 0), 2));

      -- Checked in this order so at most one reminder goes out per loan per
      -- day. v_next <= day means that due date hasn't been covered yet.
      v_day := p_today + 3;
      if v_day = public.loan_due_date_in_month(extract(year from v_day)::integer, extract(month from v_day)::integer, r.due_day)
         and v_next <= v_day then
        v_kind := 'upcoming';
        v_due := v_day;
      end if;

      v_day := p_today;
      if v_kind is null
         and v_day = public.loan_due_date_in_month(extract(year from v_day)::integer, extract(month from v_day)::integer, r.due_day)
         and v_next <= v_day then
        v_kind := 'due';
        v_due := v_day;
      end if;

      v_day := p_today - 1;
      if v_kind is null
         and v_day = public.loan_due_date_in_month(extract(year from v_day)::integer, extract(month from v_day)::integer, r.due_day)
         and v_next <= v_day then
        v_kind := 'overdue';
        v_due := v_day;
      end if;
    elsif r.repayment_frequency = 'monthly' then
      -- No due_day: 45-day fallback. Day 46 is the first day the app's
      -- overdue flag shows; repeats every 30 days after. Logged under
      -- today's date, since there's no real due date to key on.
      v_days := p_today - coalesce(r.last_repayment_date, r.start_date);
      v_amount := least(r.outstanding, round(r.total_repayable / nullif(r.term_months, 0), 2));
      if v_days > 45 and (v_days - 46) % 30 = 0 then
        v_kind := 'overdue';
        v_due := p_today;
      end if;
    elsif r.repayment_frequency = 'lump_sum' and r.term_months is not null then
      v_due := (r.start_date + make_interval(months => r.term_months))::date;
      v_amount := r.outstanding;
      v_kind := case p_today
        when v_due - 3 then 'upcoming'
        when v_due then 'due'
        when v_due + 1 then 'overdue'
      end;
    end if;

    continue when v_kind is null or v_amount is null;

    insert into public.loan_payment_reminders (loan_id, due_date, kind)
    values (r.loan_id, v_due, v_kind)
    on conflict do nothing;
    continue when not found;

    v_amount_text := '₱' || replace(to_char(v_amount, 'FM999,999,999,990.00'), '.00', '');

    if v_kind = 'upcoming' then
      v_title := 'Loan Payment Due Soon';
      v_body := 'Your ' || v_amount_text || ' payment for ' || r.loan || ' is due on '
        || trim(to_char(v_due, 'Mon FMDD')) || '.';
    elsif v_kind = 'due' then
      v_title := 'Loan Payment Due Today';
      v_body := 'Your ' || v_amount_text || ' payment for ' || r.loan || ' is due today.';
    else
      v_title := 'Loan Payment Overdue';
      if r.repayment_frequency = 'monthly' and r.due_day is null then
        v_missed := 0;
      elsif r.repayment_frequency = 'monthly' then
        -- Every due date from the first unpaid one through yesterday.
        select count(*) into v_missed
        from generate_series(date_trunc('month', v_next), date_trunc('month', v_due), interval '1 month') g
        where public.loan_due_date_in_month(extract(year from g)::integer, extract(month from g)::integer, r.due_day)
              between v_next and v_due;
      else
        v_missed := 1;
      end if;
      v_body := case
        when v_missed = 0 then 'It''s been ' || v_days || ' days since '
          || case when r.last_repayment_date is null then r.loan || ' was released' else 'your last payment on ' || r.loan end
          || '. Your ' || v_amount_text || ' monthly payment is overdue.'
        when v_missed > 1 then r.loan || ' has ' || v_missed || ' missed payments. Please make a repayment as soon as you can.'
        else 'Your ' || v_amount_text || ' payment for ' || r.loan || ' was due on '
          || trim(to_char(v_due, 'Mon FMDD')) || ' and hasn''t been received yet.'
      end;
    end if;

    perform public.create_notification(r.recipient, 'loan_payment_reminder', v_title, v_body, v_link);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

-- Same lock-down as the other notification helpers: only cron (running as
-- postgres) should be able to fan out pushes.
revoke execute on function public.send_loan_payment_reminders(date) from public, anon, authenticated;

-- Daily at 01:00 UTC = 9:00 AM Asia/Manila.
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'loan-payment-reminders';
select cron.schedule(
  'loan-payment-reminders',
  '0 1 * * *',
  $$select public.send_loan_payment_reminders()$$
);
