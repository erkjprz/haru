-- create_notification/notify_admins are SECURITY DEFINER (need to bypass
-- RLS to write on behalf of a recipient who isn't the caller), but Postgres
-- grants EXECUTE on new functions to PUBLIC by default -- that meant any
-- authenticated *or even anonymous* caller could invoke them directly via
-- PostgREST to forge notifications (and real pushes) to any member/admin.
-- The trigger functions that call these internally still work after this:
-- while a SECURITY DEFINER function executes, privilege checks (including
-- EXECUTE on functions it calls) run as the function's owner, not the
-- original caller, so revoking PUBLIC/anon/authenticated here only blocks
-- direct RPC calls, not the trigger-to-helper path.
revoke execute on function public.create_notification(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notify_admins(text, text, text, text) from public, anon, authenticated;

-- Defense in depth: these are all `returns trigger` functions that Postgres
-- already refuses to run outside real trigger context, so they weren't
-- directly callable via RPC either way -- but there's no reason to leave
-- PUBLIC execute on them.
revoke execute on function public.dispatch_push_notification() from public, anon, authenticated;
revoke execute on function public.notify_transaction_decided() from public, anon, authenticated;
revoke execute on function public.notify_admins_transaction_pending() from public, anon, authenticated;
revoke execute on function public.notify_admins_member_pending() from public, anon, authenticated;
revoke execute on function public.notify_loan_gain_allocated() from public, anon, authenticated;
revoke execute on function public.notify_bank_interest_allocated() from public, anon, authenticated;
revoke execute on function public.notify_investment_allocated() from public, anon, authenticated;
