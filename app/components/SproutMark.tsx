const LEAF = "M 0 0 Q 10 -7 24 0 Q 10 6 0 0 Z"

export function SproutMark({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <line
        x1="30"
        y1="90"
        x2="90"
        y2="90"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="square"
        className="text-ink sprout-ground"
      />
      <line
        x1="60"
        y1="90"
        x2="60"
        y2="38"
        stroke="currentColor"
        strokeWidth="4.2"
        strokeLinecap="square"
        className="text-ink sprout-stem"
      />
      <g transform="translate(60,75) rotate(210)" className="text-gold">
        <path d={LEAF} fill="currentColor" className="sprout-leaf sprout-leaf-l" />
      </g>
      <g transform="translate(60,75) rotate(330)" className="text-gold">
        <path d={LEAF} fill="currentColor" className="sprout-leaf sprout-leaf-r" />
      </g>
      <circle cx="60" cy="38" r="4.6" fill="currentColor" className="text-gold sprout-bud" />
    </svg>
  )
}
