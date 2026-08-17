-- Telegram was pinging on both submission and approval, with a headline
-- that varied by event/status and an explicit "Status: ..." line. Per
-- request: only ping when a transaction actually needs someone's
-- attention (freshly pending), never on approval, and drop the header/
-- status wording variation -- every message that goes out now describes
-- the same situation, so there's nothing left to vary.

-- The approval-triggered call is no longer wanted at all -- drop the
-- trigger outright rather than filtering it out in the function body, so
-- an approval never even reaches the webhook.
drop trigger if exists trg_notify_telegram_transaction_approved on public.transactions;

-- The insert trigger stays, but the function itself now only fires for a
-- freshly-pending row -- an admin-entered transaction that inserts
-- already-approved (Bank Interest, Expense, Internal Transfer, Investment)
-- never needed anyone's attention and no longer pings either.
create or replace function public.notify_telegram_transaction()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  webhook_secret text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'telegram_webhook_secret';

  perform net.http_post(
    url := 'https://kepwsajtixlcjbabfxlk.functions.supabase.co/telegram-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('event', 'submitted', 'record', row_to_json(new))
  );

  return new;
end;
$function$;
