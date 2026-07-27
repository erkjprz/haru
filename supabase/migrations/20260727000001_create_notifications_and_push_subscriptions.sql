create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(member_id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications
  for select to authenticated
  using (member_id = current_member_id());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (member_id = current_member_id())
  with check (member_id = current_member_id());

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(member_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using (member_id = current_member_id());

create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated with check (member_id = current_member_id());

create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated using (member_id = current_member_id());
