"use client"

import { useEffect, useState } from "react"
import { Portal } from "@/app/components/Portal"

const VISIBLE_MS = 3000
const EXIT_MS = 200

// Brief bottom-anchored confirmation, e.g. after submitting a transaction
// through the FAB's sheet instead of a full-page confirmation screen.
// Sits above the dock (see --dock-h) so it never collides with the pill
// nav/FAB. Owns its own show-then-dismiss timing -- the caller just holds
// a message in state and clears it via onDone once this has fully
// animated out.
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const showRaf = requestAnimationFrame(() => setVisible(true))
    const hideTimer = setTimeout(() => setVisible(false), VISIBLE_MS)
    const doneTimer = setTimeout(onDone, VISIBLE_MS + EXIT_MS)
    return () => {
      cancelAnimationFrame(showRaf)
      clearTimeout(hideTimer)
      clearTimeout(doneTimer)
    }
    // Re-arming on `message` change (not just mount) means a second toast
    // fired while one's still showing restarts the full show/hide cycle
    // instead of inheriting whatever's left of the first one's timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message])

  return (
    <Portal>
      <div
        className="fixed inset-x-4 z-50 flex justify-center transition-all duration-200"
        style={{
          bottom: "calc(var(--dock-h) + 1rem)",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(0.5rem)"
        }}
      >
        <div className="max-w-[26rem] bg-ink text-paper rounded-full px-5 py-3 text-sm font-medium shadow-lg text-center">
          {message}
        </div>
      </div>
    </Portal>
  )
}
