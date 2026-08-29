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
          style={{ animationDelay: "1.1s" }}
        >
          <svg width="84" height="84" viewBox="0 0 100 100">
            <path
              d="M 50 84 C 51 66 46 58 49 36"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              fill="none"
              pathLength={1}
              className="[stroke-dasharray:1] [stroke-dashoffset:1] animate-[sprout-draw_560ms_ease-out_forwards]"
            />
            <path
              d="M 48 60 C 34 60 22 50 18 36 C 30 42 44 48 48 60 Z"
              fill="currentColor"
              className="[transform-box:fill-box] origin-[100%_100%] opacity-0 scale-[0.35] animate-[sprout-bloom_420ms_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
              style={{ animationDelay: "420ms" }}
            />
            <path
              d="M 52 54 C 66 54 78 46 82 32 C 70 38 56 44 52 54 Z"
              fill="currentColor"
              className="[transform-box:fill-box] origin-[0%_100%] opacity-0 scale-[0.35] animate-[sprout-bloom_420ms_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
              style={{ animationDelay: "560ms" }}
            />
          </svg>
        </div>

        <div className="flex flex-col items-center mt-[22px]">
          <h1
            className="opacity-0 animate-[splash-fade-up_600ms_ease-out_forwards] font-display text-4xl font-semibold text-ink"
            style={{ animationDelay: "900ms" }}
          >
            Est. 2017
          </h1>
        </div>

        <div
          className="relative w-[120px] h-[2px] rounded-full overflow-hidden bg-hairline mt-[34px] opacity-0 animate-[splash-fade-up_500ms_ease-out_forwards]"
          style={{ animationDelay: "1.2s" }}
        >
          <div
            className="absolute inset-y-0 w-2/5 rounded-full bg-gold animate-[splash-indeterminate_1.4s_ease-in-out_infinite]"
            style={{ animationDelay: "1.3s" }}
          />
        </div>

      </div>
    </main>
  )
}
