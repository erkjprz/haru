import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

// False during server render and the client's hydration pass, true right
// after. Gate any markup that depends on localStorage-seeded state (the
// cached auth member, cached badge counts) behind this so the client's
// first render matches the server HTML -- the server never has a cached
// member, so rendering from one during hydration is a mismatch (React
// error #418) that throws away and re-renders the whole tree.
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
}
