-- Lets an admin upload a "scan to pay" QR image per bank account, shown to
-- members (Dashboard) and borrowers (Borrower hub) so nobody has to hunt
-- down a saved screenshot when they're about to send money. Uses a new
-- public bucket rather than the existing private Receipts bucket -- these
-- images are meant to be viewed by every signed-in member on every page
-- load, not access-controlled per uploader, so a stable public URL avoids
-- re-signing on every render.
alter table public.bank_accounts add column qr_code_url text;

insert into storage.buckets (id, name, public)
values ('BankQR', 'BankQR', true)
on conflict (id) do nothing;

create policy "Admins can manage bank QR codes"
on storage.objects for all
to authenticated
using (bucket_id = 'BankQR' and is_admin())
with check (bucket_id = 'BankQR' and is_admin());

create policy "Anyone signed in can view bank QR codes"
on storage.objects for select
to authenticated
using (bucket_id = 'BankQR');
