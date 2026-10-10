-- Where a member's withdrawal should be sent, mirroring loans.payout_details
-- / payout_qr_path: free-text bank/e-wallet details and/or a photo of their
-- payment QR code (a path in the private Receipts bucket, named
-- "<member_id>-payout-..." so the member can still view their own upload
-- under the existing storage policy). Only set on Member Withdrawal rows.
alter table public.transactions
  add column if not exists payout_details text,
  add column if not exists payout_qr_path text;
