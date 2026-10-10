import { supabase } from "@/lib/supabase"
import { readCache, writeCache } from "@/lib/cache"

// How an approval moves bank balances -- display-only helpers so an admin
// can see the effect before approving and confirm it after, instead of
// checking the Banks page by hand. Mirrors v_cash_ledger exactly: a
// transaction only moves a bank balance when it's approved, affects_cash =
// 1, and resolves to a bank via COALESCE(t.bank, account_name, bank_name).

type BankAccountRef = { bank_name: string; account_name: string | null } | null | undefined

export type ImpactTxn = {
  transaction_id: string
  amount: number
  affects_cash?: number | null
  bank?: string | null
  bank_accounts?: BankAccountRef
}

export type TxnImpact =
  | { kind: "bank"; bank: string; delta: number }
  | { kind: "none"; reason: "no_bank" | "no_cash" }

// The bank ledger key this transaction will count toward once approved --
// pass the admin's bank pick for a Withdrawal/Loan Release, which isn't
// saved on the row until approval.
export function txnImpact(t: ImpactTxn, chosenAccount?: BankAccountRef): TxnImpact {
  // Exactly v_cash_ledger's rule: only affects_cash = 1 counts (null doesn't).
  if (Number(t.affects_cash) !== 1) return { kind: "none", reason: "no_cash" }
  const account = chosenAccount ?? t.bank_accounts
  const bank = t.bank || account?.account_name || account?.bank_name || null
  if (!bank) return { kind: "none", reason: "no_bank" }
  return { kind: "bank", bank, delta: Number(t.amount) }
}

export type BankDelta = { bank: string; delta: number }

// Sums several approvals into one delta per bank, plus how many won't move
// any bank at all.
export function groupImpacts(impacts: TxnImpact[]): { banks: BankDelta[]; unaffected: number } {
  const byBank = new Map<string, number>()
  let unaffected = 0
  for (const i of impacts) {
    if (i.kind === "none") unaffected++
    else byBank.set(i.bank, Number(((byBank.get(i.bank) ?? 0) + i.delta).toFixed(2)))
  }
  return { banks: Array.from(byBank, ([bank, delta]) => ({ bank, delta })), unaffected }
}

export async function fetchBankBalances(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("v_bank_balances").select("bank, balance")
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((r) => [r.bank as string, Number(r.balance)]))
}

// Ids approved on this device in the last little while, so a bank's Recent
// activity can highlight them -- transactions have no approved_at column to
// go by. Per-device convenience only; nothing depends on it being there.
const RECENT_KEY = "admin:recently-approved"
const RECENT_WINDOW_MS = 30 * 60 * 1000

export function rememberApproved(ids: string[]) {
  const now = Date.now()
  const kept = (readCache<{ id: string; at: number }[]>(RECENT_KEY) ?? []).filter((r) => now - r.at < RECENT_WINDOW_MS)
  writeCache(RECENT_KEY, [...kept, ...ids.map((id) => ({ id, at: now }))])
}

export function recentlyApprovedIds(): Set<string> {
  const now = Date.now()
  return new Set(
    (readCache<{ id: string; at: number }[]>(RECENT_KEY) ?? []).filter((r) => now - r.at < RECENT_WINDOW_MS).map((r) => r.id)
  )
}
