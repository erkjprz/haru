// In-memory only, not persisted -- unlike transactionFormPrefetch.ts's
// localStorage-backed cache (which needs to survive a fresh app launch), a
// transaction row only ever needs to survive the instant between someone
// tapping Edit on a row a list just rendered and EditTransactionSheet
// mounting a moment later. Keeping it around any longer risks seeding the
// sheet with a stale row (another admin approving/editing it elsewhere
// since it was last rendered), so nothing here writes it to disk or reads
// it back across a reload -- a cache miss just falls back to fetching the
// row fresh, exactly like before this existed.
const rows = new Map<string, any>()

// Called by whatever list just rendered the row (Transactions, LoanCards)
// right at the point someone taps Edit on it -- not proactively for every
// row on screen, so it's always the exact data they were just looking at.
export function cacheTransactionRow(txn: any): void {
  if (txn?.transaction_id) rows.set(txn.transaction_id, txn)
}

export function getCachedTransactionRow(transactionId: string): any | null {
  return rows.get(transactionId) ?? null
}
