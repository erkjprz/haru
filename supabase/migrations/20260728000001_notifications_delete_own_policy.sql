create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (member_id = current_member_id());
