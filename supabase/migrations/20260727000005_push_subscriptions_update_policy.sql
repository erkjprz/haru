create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using (member_id = current_member_id())
  with check (member_id = current_member_id());
