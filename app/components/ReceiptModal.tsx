"use client"

import { useEffect, useState } from "react"
import { getReceiptSignedUrl } from "@/lib/receiptUrl"

export default function ReceiptModal({
  path,
  onClose
}: {
  path: string
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    getReceiptSignedUrl(path).then((signedUrl) => {
      if (cancelled) return
      if (!signedUrl) {
        setFailed(true)
        return
      }
      setUrl(signedUrl)
    })

    return () => {
      cancelled = true
    }
  }, [path])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-lg w-full min-h-72 max-h-[85vh] bg-paper-2 border border-hairline rounded-sm overflow-hidden shadow-xl"
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

        {url && !failed && (
          <img
            src={url}
            alt="Receipt"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`block w-full h-auto max-h-[85vh] object-contain mx-auto bg-paper transition-opacity duration-300 ${
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
            <span className="text-2xl">🧾</span>
            Couldn't load this receipt.
          </div>
        )}
      </div>
    </div>
  )
}
