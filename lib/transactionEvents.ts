// Fired after a transaction is saved through the FAB's quick-entry sheet,
// which lives in Navbar -- outside of and unaware of whichever page happens
// to be showing underneath it. A plain DOM event lets any page that cares
// (Dashboard, Transactions) refresh its own already-loaded data in response,
// without Navbar needing a direct reference to their load functions.
export const TRANSACTIONS_CHANGED_EVENT = "haru:transactions-changed"

export function notifyTransactionsChanged() {
  window.dispatchEvent(new Event(TRANSACTIONS_CHANGED_EVENT))
}
