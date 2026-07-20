import { supabase } from "@/lib/supabase"

// Receipts are stored in a private bucket; callers hold onto the storage
// path (not a durable URL) and resolve a short-lived signed URL right
// before displaying it.
export async function getReceiptSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("Receipts").createSignedUrl(path, 3600)
  if (error) return null
  return data.signedUrl
}
