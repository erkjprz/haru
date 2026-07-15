"use client"

export default function ReceiptModal({
  url,
  onClose
}: {
  url: string
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-lg w-full max-h-[85vh] bg-paper-2 border border-hairline rounded-sm overflow-hidden shadow-xl"
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
        <img
          src={url}
          alt="Receipt"
          className="w-full h-full object-contain max-h-[85vh] bg-paper"
        />
      </div>
    </div>
  )
}
