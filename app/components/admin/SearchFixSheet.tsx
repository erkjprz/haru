"use client"

import { Sheet } from "@/app/components/Sheet"
import { SupportPanel } from "@/app/components/admin/SupportPanel"

// Support no longer gets its own tab -- it's reached from Admin's FAB
// instead, matching how every other "find one thing and act on it" flow
// in the app now opens as a sheet over wherever you already are.
// SupportPanel itself is untouched; this only changes where it's mounted.
export function SearchFixSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Search & Fix" onClose={onClose}>
      <SupportPanel />
    </Sheet>
  )
}
