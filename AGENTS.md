<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Testing against the real Supabase project

This app's only Supabase project is production — there is no separate
staging database. Real members (including admins with push notifications
enabled) can be notified by test activity if you're not careful.

Before any test action that could touch a real-user-visible table
(creating a member/auth user, submitting a transaction, anything that
can cascade into `public.notifications`), disable the delivery trigger
first, run the test, then **re-enable it immediately after** — don't
leave it disabled for an extended session, since that also silences
real notifications for real members' actual activity in the meantime:

```sql
alter table public.notifications disable trigger trg_dispatch_push_notification;
-- ...do the test action...
alter table public.notifications enable trigger trg_dispatch_push_notification;
```

This only suppresses the push/delivery side effect — rows still land in
`public.notifications` normally, which is fine (delete any test-created
rows afterward, e.g. `where member_id = '<test member id>'`). Test members
created for this purpose should also be named/flagged obviously (e.g.
"Claude Test Agent") so a stray one is easy to spot and remove.
