export default function WaitingPage() {
  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-5 py-8">

      <div className="w-full max-w-md animate-in fade-in duration-500">

        {/* Header */}

        <div className="text-center mb-8">

          <p className="text-[11px] uppercase tracking-[0.2em] text-gold font-mono">
            Est. 2017
          </p>

          <h1 className="font-display text-4xl font-semibold text-ink mt-2">
            Haru
          </h1>

          <p className="text-sm text-ink-soft mt-2">
            Shared fund membership
          </p>

        </div>


        {/* Card */}

        <div className="
          bg-paper-2
          border
          border-hairline
          rounded-xl
          shadow-sm
          p-6
          text-center
        ">

          <div className="
            mx-auto
            mb-5
            w-12
            h-12
            rounded-full
            bg-gold/10
            flex
            items-center
            justify-center
          ">
            <span className="text-2xl">
              ⏳
            </span>
          </div>


          <h2 className="font-display text-xl font-semibold text-ink">
            Waiting for approval
          </h2>


          <p className="text-sm text-ink-soft mt-3 leading-relaxed">
            Your account has been created.
            An admin will review your request before you can access the fund.
          </p>


          <div className="
            mt-6
            bg-paper
            border
            border-hairline
            rounded-md
            px-4
            py-3
          ">

            <p className="text-xs text-ink-soft">
              Once approved, you can sign in and view your contributions,
              investments and fund performance.
            </p>

          </div>


        </div>


        <p className="mt-6 text-center text-xs text-ink-soft">
          Thank you for joining Haru.
        </p>


      </div>

    </main>
  )
}