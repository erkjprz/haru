// Shown at / while auth resolves and the destination page's data warms in
// the background (see app/page.tsx) -- a calmer, on-brand stand-in for the
// blank paper-colored div that used to sit here. Purely presentational: it
// doesn't know or care what's loading behind it.
export function SplashScreen() {
  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-5">
      <div className="flex flex-col items-center">

        <div
          className="text-gold animate-[sprout-breathe_2.6s_ease-in-out_infinite]"
          style={{ animationDelay: "1.4s" }}
        >
          <svg width="84" height="84" viewBox="0 0 100 100">
            <path
              d="M 50 88 C 49 68 51 56 50 44"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              fill="none"
              pathLength={1}
              className="[stroke-dasharray:1] [stroke-dashoffset:1] animate-[sprout-draw_560ms_ease-out_forwards]"
            />
            {/* Leaves stay fully hidden (opacity-0, scaled to 35%) until the
                stem finishes drawing at 560ms, then bloom one after another
                rather than together -- overlapping their delays with the
                stem's tail end made the whole mark read as popping in at
                once instead of unfolding in sequence. The initial scale is
                set via the [transform:scale(...)] arbitrary property, not
                Tailwind's scale-[...] utility -- that utility targets the
                standalone CSS `scale` property, a separate channel from
                `transform`, so the sprout-bloom keyframes (which animate
                `transform`) would never override it and both would keep
                compounding, permanently squashing the settled leaf to 35%
                of its size. */}
            <path
              d="M 50 44 A 25 25 0 0 1 12 60 A 25 25 0 0 1 50 44 Z"
              fill="currentColor"
              className="[transform-box:fill-box] opacity-0 [transform:scale(0.35)] animate-[sprout-bloom_420ms_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
              style={{ animationDelay: "560ms" }}
            />
            <path
              d="M 50 44 A 26 26 0 0 1 90 26 A 26 26 0 0 1 50 44 Z"
              fill="currentColor"
              className="[transform-box:fill-box] opacity-0 [transform:scale(0.35)] animate-[sprout-bloom_420ms_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
              style={{ animationDelay: "980ms" }}
            />
          </svg>
        </div>

        <div className="flex flex-col items-center mt-[22px]">
          <h1
            className="opacity-0 animate-[splash-fade-up_600ms_ease-out_forwards] font-display text-4xl font-semibold text-ink"
            style={{ animationDelay: "1.32s" }}
          >
            Est. 2017
          </h1>
        </div>

        <div
          className="relative w-[120px] h-[2px] rounded-full overflow-hidden bg-hairline mt-[34px] opacity-0 animate-[splash-fade-up_500ms_ease-out_forwards]"
          style={{ animationDelay: "1.62s" }}
        >
          <div
            className="absolute inset-y-0 w-2/5 rounded-full bg-gold animate-[splash-indeterminate_1.4s_ease-in-out_infinite]"
            style={{ animationDelay: "1.72s" }}
          />
        </div>

      </div>
    </main>
  )
}
