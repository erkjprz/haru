-- RLS only checks endpoint ownership (member_id), not that the endpoint
-- itself is a real push service -- without this, a member could register a
-- subscription pointing at an arbitrary/internal URL, and the send-push
-- edge function would POST to it (SSRF) the next time a real event
-- notifies them. Restrict to the known Web Push service origins browsers
-- actually use.
alter table public.push_subscriptions
add constraint push_subscriptions_endpoint_trusted_origin
check (
  endpoint ~* '^https://(fcm\.googleapis\.com/|android\.googleapis\.com/|updates\.push\.services\.mozilla\.com/|web\.push\.apple\.com/|[a-z0-9-]+\.notify\.windows\.com/)'
);
