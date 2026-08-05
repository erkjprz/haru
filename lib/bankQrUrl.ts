import { supabase } from "@/lib/supabase"

// Bank QR codes live in a public bucket -- unlike Receipts, the URL is
// stable and doesn't need to be re-signed on every view.
export function getBankQrPublicUrl(path: string): string {
  return supabase.storage.from("BankQR").getPublicUrl(path).data.publicUrl
}
