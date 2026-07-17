function Bar({ className = "" }: { className?: string }) {
  return <div className={`bg-hairline/70 rounded ${className}`} />
}

// Matches the card rows used by list pages (banks, loans, investments,
// admin's pending lists) -- title + subtitle, two stat placeholders, a
// progress bar -- so the swap from skeleton to real content doesn't jump.
export function SkeletonCardList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-paper-2 border border-hairline rounded-md px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Bar className="h-4 w-2/5" />
              <Bar className="h-3 w-1/3" />
            </div>
            <Bar className="h-3 w-8" />
          </div>
          <div className="flex justify-between items-end mt-4">
            <Bar className="h-4 w-16" />
            <Bar className="h-4 w-16" />
          </div>
          <Bar className="h-1.5 w-full mt-3" />
        </div>
      ))}
    </div>
  )
}

// Generic single-panel skeleton for dashboard/detail/form pages -- a
// headline block plus a couple of body blocks, loose enough to fit most
// page shapes without needing a bespoke skeleton per page.
export function SkeletonPanel() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 space-y-3">
        <Bar className="h-3 w-1/3" />
        <Bar className="h-8 w-1/2" />
        <Bar className="h-2 w-full" />
      </div>
      <div className="bg-paper-2 border border-hairline rounded-md p-5 space-y-3">
        <Bar className="h-3 w-1/4" />
        <Bar className="h-4 w-full" />
        <Bar className="h-4 w-5/6" />
        <Bar className="h-4 w-2/3" />
      </div>
    </div>
  )
}
