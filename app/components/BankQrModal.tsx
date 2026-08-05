"use client"

import { useState } from "react"

// Unlike ReceiptModal, the URL here is already a stable public one (no
// signed-URL fetch needed), so this just needs to render it full-size.
export default function BankQrModal({
  title,
  url,
  onClose
}: {
  title: string
  url: string
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div
      // bg-black, not bg-ink -- ink is the light foreground color in dark
      // mode, so bg-ink/80 dims the backdrop to near-white there.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-sm w-full min-h-72 max-h-[85vh] bg-paper-2 border border-hairline rounded-sm overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 z-10 bg-ink text-paper w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <p className="text-center text-[13px] font-semibold text-ink pt-4">{title}</p>

        {!failed && (
          <img
            src={url}
            alt={`${title} QR code`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`block w-full h-auto max-h-[75vh] object-contain mx-auto bg-paper p-4 transition-opacity duration-300 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {!loaded && !failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-paper-2 animate-pulse">
            <span className="w-9 h-9 rounded-full border-[3px] border-hairline border-t-gold animate-spin" />
          </div>
        )}

        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper-2 text-ink-soft text-sm">
            <span className="text-2xl">📷</span>
            Couldn&apos;t load this QR code.
          </div>
        )}
      </div>
    </div>
  )
}
