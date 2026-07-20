"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

type Tab = "members" | "borrowers" | "admin"

type FaqItem = { q: string; a: React.ReactNode }
type FaqSection = { title: string; items: FaqItem[] }

function Faq({ q, a }: FaqItem) {
  return (
    <details className="group border-b border-hairline last:border-b-0">
      <summary className="py-4 flex items-start justify-between gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium text-ink">{q}</span>
        <span className="shrink-0 mt-0.5 text-ink-soft text-lg leading-none transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="pb-4 text-sm text-ink-soft leading-relaxed space-y-2">{a}</div>
    </details>
  )
}

function FaqSectionCard({ title, items }: FaqSection) {
  return (
    <div className="mt-6">
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2">{title}</p>
      <div className="bg-paper-2 border border-hairline rounded-md px-4">
        {items.map((item) => (
          <Faq key={item.q} q={item.q} a={item.a} />
        ))}
      </div>
    </div>
  )
}

const memberSections: FaqSection[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "How do I sign up?",
        a: (
          <p>
            Tap <strong>Sign Up</strong>, choose <strong>Member</strong>, and fill in your name, email, and
            password. Your account starts as <strong>Pending</strong> — an admin needs to approve it before
            you can sign in properly, so you&apos;ll land on a waiting screen until then.
          </p>
        )
      },
      {
        q: "I forgot my password. What do I do?",
        a: <p>On the login screen, tap <strong>Forgot password?</strong> and follow the email link.</p>
      },
      {
        q: "What can I see and do as a member?",
        a: (
          <p>
            Everything about the shared fund: your balance, the fund&apos;s totals, every member&apos;s loans,
            all transactions, investments, and bank balances. You can submit your own contributions,
            withdrawal requests, and loan payments — an admin approves those before they count.
          </p>
        )
      }
    ]
  },
  {
    title: "Your dashboard",
    items: [
      {
        q: "What does \"Available Balance\" mean?",
        a: (
          <p>
            The amount of your own money in the fund you could withdraw right now. If some of your money is
            currently out on a loan to another member, that&apos;s shown separately and isn&apos;t counted as
            available until it&apos;s repaid.
          </p>
        )
      },
      {
        q: "What's the difference between the \"You\" and \"Fund\" tabs?",
        a: (
          <p>
            <strong>You</strong> shows your own contributions, withdrawals, and gains (bank interest,
            investment performance, and your share of loan interest). <strong>Fund</strong> shows the whole
            group&apos;s totals — total cash, the split between banks, and open loans.
          </p>
        )
      },
      {
        q: "What's that banner saying \"N entries pending approval\"?",
        a: (
          <p>
            It means you&apos;ve submitted something — a contribution, withdrawal, or loan payment — that an
            admin hasn&apos;t approved yet. Tap it to see exactly what&apos;s waiting in{" "}
            <strong>Transactions</strong>.
          </p>
        )
      }
    ]
  },
  {
    title: "How the numbers work",
    items: [
      {
        q: "How is my Available Balance calculated?",
        a: (
          <p>
            Everything you&apos;ve put in and earned — contributions, bank interest, investment performance,
            and your share of loan gains — minus withdrawals. If some of that money is currently funding
            another member&apos;s active loan, that portion isn&apos;t available until the loan is repaid; you&apos;ll
            see it called out separately under your balance.
          </p>
        )
      },
      {
        q: "How does bank interest get split among members?",
        a: (
          <p>
            Proportionally, based on how much each member had contributed to the fund at the time it&apos;s
            distributed — the more you had in, the bigger your share.
          </p>
        )
      },
      {
        q: "How is a loan's interest split when it closes?",
        a: (
          <p>
            The same idea: proportional to how much each member had in the fund at that point. The member
            who borrowed the money never shares in their own loan&apos;s interest, and anyone with nothing in
            the fund at that point doesn&apos;t get a share either.
          </p>
        )
      },
      {
        q: "What does my \"% of fund\" on Fund Breakdown mean?",
        a: (
          <p>
            Your total value in the fund (contributions plus everything you&apos;ve earned) divided by
            everyone&apos;s total value combined.
          </p>
        )
      },
      {
        q: "How is loan interest calculated?",
        a: (
          <p>
            Either a flat percentage of the amount borrowed, or a fixed peso amount — whichever was agreed
            when the loan was requested. Either way it&apos;s a one-time amount added to the principal, not
            interest that compounds over time.
          </p>
        )
      }
    ]
  },
  {
    title: "Submitting a contribution, withdrawal, or loan payment",
    items: [
      {
        q: "How do I submit a contribution or withdrawal?",
        a: (
          <ol className="list-decimal list-inside space-y-1">
            <li>Tap the gold <strong>+ New</strong> button, top right of any page.</li>
            <li>Choose <strong>Contribution</strong> or <strong>Withdrawal Request</strong>.</li>
            <li>Enter the amount and bank, and attach a receipt.</li>
            <li>Submit — it shows as <strong>Pending</strong> until an admin approves it.</li>
          </ol>
        )
      },
      {
        q: "How do I make a payment toward my loan?",
        a: (
          <p>
            Same place: <strong>+ New → Loan Payment</strong>. Pick which loan it&apos;s for, enter the
            amount and bank, and attach a receipt.
          </p>
        )
      },
      {
        q: "How do I request a new loan?",
        a: (
          <p>
            <strong>+ New → Loan Request</strong>. Enter how much you need, the interest (rate or a fixed
            amount), and the term. It goes to an admin to review and activate — you&apos;ll see it as{" "}
            <strong>requested</strong> on the Loans page until then.
          </p>
        )
      },
      {
        q: "Why does everything need a receipt?",
        a: (
          <p>
            So admins have proof of the transfer before approving it. A photo of the bank confirmation or
            deposit slip is enough.
          </p>
        )
      },
      {
        q: "I made a mistake — can I fix something I already submitted?",
        a: (
          <p>
            Yes, as long as it&apos;s still <strong>Pending</strong>. On the Transactions page, your own
            pending contributions, withdrawals, and loan payments show a small{" "}
            <strong>✎ Edit</strong> button — tap it to change the amount, bank, receipt, or description.
            Once an admin approves an entry, it can&apos;t be edited anymore.
          </p>
        )
      },
      {
        q: "Can I take back something I submitted?",
        a: (
          <p>
            Yes — open it with <strong>✎ Edit</strong> and tap <strong>Cancel this entry</strong> near the
            bottom. It&apos;s removed from your list right away. This can&apos;t be undone from the app, so
            make sure before you tap it.
          </p>
        )
      }
    ]
  },
  {
    title: "Pending, Approved, Rejected",
    items: [
      {
        q: "What do these statuses mean?",
        a: (
          <p>
            <strong>Pending</strong> — waiting on an admin to review it; it doesn&apos;t count toward your
            balance yet. <strong>Approved</strong> — reviewed and counted. <strong>Rejected</strong> — an
            admin declined it, usually because something didn&apos;t match (wrong amount, no receipt, etc.).
            You can search and filter your own entries by status on the Transactions page.
          </p>
        )
      }
    ]
  },
  {
    title: "The rest of the app",
    items: [
      {
        q: "What's Fund Breakdown for?",
        a: (
          <p>
            It shows how ownership of the fund is split across everyone — based on net contribution,
            investment performance, bank interest, and loan gain share.
          </p>
        )
      },
      {
        q: "What's Investments for?",
        a: (
          <p>
            It shows each investment the fund holds and how it&apos;s performed, plus each member&apos;s
            share of the gain or loss.
          </p>
        )
      },
      {
        q: "What's Banks for?",
        a: (
          <p>
            Each bank account the fund uses, its balance, and the interest it&apos;s earned — including
            interest that&apos;s been approved but not yet split across members.
          </p>
        )
      },
      {
        q: "Where do I change my email or password?",
        a: <p>Open the menu (☰, top left) → <strong>Account</strong>.</p>
      },
      {
        q: "How do I switch between light and dark mode?",
        a: <p>Open the menu (☰, top left) → <strong>Appearance</strong>, at the bottom of the menu.</p>
      }
    ]
  }
]

const borrowerSections: FaqSection[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "How do I sign up as a borrower?",
        a: (
          <p>
            Tap <strong>Sign Up</strong> and choose <strong>Borrower</strong> instead of Member. Your account
            starts as <strong>Pending</strong> until an admin approves it.
          </p>
        )
      },
      {
        q: "What can a borrower account see?",
        a: (
          <p>
            Only your own loan — its balance, repayment history, and terms. A borrower account can&apos;t see
            the fund&apos;s dashboard, other members, or anyone else&apos;s data. If you already had a loan
            recorded before you had an account, an admin can link it to your new account so you can see it
            here too.
          </p>
        )
      }
    ]
  },
  {
    title: "Requesting a loan",
    items: [
      {
        q: "How do I request a loan?",
        a: (
          <ol className="list-decimal list-inside space-y-1">
            <li>From your loan page, tap <strong>Request a Loan</strong>.</li>
            <li>Enter how much you need.</li>
            <li>Choose interest as a <strong>rate</strong> (%) or a <strong>fixed amount</strong>.</li>
            <li>Enter the term (in months) and how often you&apos;ll repay.</li>
            <li>Submit — it goes to an admin to approve and activate.</li>
          </ol>
        )
      },
      {
        q: "How will I know if my loan was approved?",
        a: <p>Once an admin approves it, its status changes from <strong>requested</strong> to <strong>active</strong> on your loan page, and it&apos;ll show the bank the money was sent from.</p>
      },
      {
        q: "How is my total repayment amount calculated?",
        a: (
          <p>
            Principal plus interest. Interest is either a percentage of what you borrowed, or a flat peso
            amount — whichever you chose when requesting the loan. It&apos;s a one-time amount added to the
            principal, not interest that grows over time, so your total doesn&apos;t change while you&apos;re
            repaying it.
          </p>
        )
      }
    ]
  },
  {
    title: "Repaying a loan",
    items: [
      {
        q: "How do I make a repayment?",
        a: (
          <ol className="list-decimal list-inside space-y-1">
            <li>From your loan page, tap <strong>Make a Repayment</strong>.</li>
            <li>Choose which loan it&apos;s for (if you have more than one).</li>
            <li>Enter the amount and which bank you sent it from.</li>
            <li>Attach a receipt or screenshot of the transfer.</li>
            <li>Submit — it shows as <strong>pending</strong> until an admin approves it.</li>
          </ol>
        )
      },
      {
        q: "Why isn't my repayment reflected yet?",
        a: (
          <p>
            It needs an admin to approve it first — that&apos;s what keeps the numbers accurate. Once
            approved, your loan balance updates.
          </p>
        )
      },
      {
        q: "I entered the wrong amount — can I fix a repayment I already submitted?",
        a: (
          <p>
            Yes, as long as it&apos;s still <strong>pending</strong>. Your loan page shows a small{" "}
            <strong>✎ Edit</strong> button next to any pending repayment — tap it to change the amount,
            bank, receipt, or description, or to cancel it entirely. Once an admin approves it, it can no
            longer be changed.
          </p>
        )
      },
      {
        q: "Can I fix or cancel a loan request I already submitted?",
        a: (
          <p>
            Not from your account — unlike a repayment, a loan request needs an admin to make any change to
            it. Message your admin directly and they can correct or reject it before it&apos;s activated.
          </p>
        )
      }
    ]
  }
]

const adminSections: FaqSection[] = [
  {
    title: "The Admin panel",
    items: [
      {
        q: "Where do I approve things?",
        a: (
          <p>
            Open the menu (☰) → <strong>Admin</strong>. It&apos;s organized into four tabs —{" "}
            <strong>Members</strong>, <strong>Txns</strong>, <strong>Borrowers</strong>, and{" "}
            <strong>Distrib.</strong> — each one only showing what actually needs a decision. Tap a row to
            open it and see the Approve/Reject buttons.
          </p>
        )
      },
      {
        q: "How do I approve a new member or borrower signup?",
        a: (
          <p>
            <strong>Members</strong> tab for a member signup, <strong>Borrowers</strong> tab for a borrower
            signup. If the person is actually one of your existing members signing up again (or already has
            a loan on record from before they had an account), each row has an optional dropdown to link
            them to that existing record instead of creating a duplicate.
          </p>
        )
      },
      {
        q: "How do I approve a transaction?",
        a: (
          <p>
            <strong>Txns</strong> tab, tap a row, then <strong>Approve</strong> or <strong>Reject</strong>.
            Withdrawals and loan releases each also need you to pick which bank the money is coming from
            before you can approve — that field shows up right there in the row.
          </p>
        )
      },
      {
        q: "What happens when I approve a loan release?",
        a: (
          <p>
            It does two things at once: activates the loan (its status changes from{" "}
            <strong>requested</strong> to <strong>active</strong>) and records which bank disbursed it — you
            don&apos;t need a separate step on the loan&apos;s own page.
          </p>
        )
      },
      {
        q: "What's the Distrib. tab?",
        a: (
          <p>
            Bank interest that&apos;s been approved but not yet split across members. Tap{" "}
            <strong>Distribute</strong> on a bank/year to divide it proportionally by each member&apos;s
            contribution balance at that time.
          </p>
        )
      }
    ]
  },
  {
    title: "Managing members and borrowers",
    items: [
      {
        q: "How do I add a member manually, edit one, or deactivate one?",
        a: (
          <p>
            Admin → <strong>Members</strong> quick link (or the &quot;Manage all members →&quot; link at the
            bottom of the Members tab) takes you to the full roster, where you can add a member directly,
            edit their name/email/role, and deactivate or reactivate an account.
          </p>
        )
      },
      {
        q: "How do I see every borrower account, not just pending ones?",
        a: (
          <p>
            The &quot;View all borrowers →&quot; link at the bottom of the Admin Borrowers tab opens the full
            list, including already-approved accounts and their linked loan records.
          </p>
        )
      }
    ]
  },
  {
    title: "Recording things on someone's behalf",
    items: [
      {
        q: "How do I record a transaction for a member myself?",
        a: (
          <p>
            <strong>+ New</strong>, same as members use, but as an admin you can pick{" "}
            <strong>on behalf of</strong> a specific member — that entry posts as approved immediately
            instead of going into the pending queue.
          </p>
        )
      },
      {
        q: "What are the admin-only entry types for?",
        a: (
          <p>
            <strong>Expense</strong>, <strong>Bank Interest</strong>, <strong>Bank Transfer</strong>,{" "}
            <strong>Investment</strong>, and <strong>Investment Return</strong> — fund-level entries that
            aren&apos;t tied to a single member&apos;s contribution. These post as approved right away.
          </p>
        )
      },
      {
        q: "Can I edit something after I've recorded it?",
        a: (
          <p>
            Expense, Bank Interest, and Bank Transfer entries you record yourself can be edited any time —
            they show a <strong>✎ Edit</strong> button on Transactions, since they&apos;re never in a
            member&apos;s pending queue to begin with. A pending Loan Release can also be edited or
            cancelled (cancelling deletes the loan request entirely) right up until you activate it — once a
            loan is active, changes move to that loan&apos;s own <strong>Manage loan</strong> panel instead.
          </p>
        )
      }
    ]
  },
  {
    title: "Loans, investments, and banks",
    items: [
      {
        q: "How do I close a loan, edit its terms, or reopen one?",
        a: (
          <p>
            Open the loan itself (Loans → tap it) — as an admin you&apos;ll see a{" "}
            <strong>Manage loan</strong> panel there with Edit, Close &amp; Distribute, and (for closed
            loans) Reopen.
          </p>
        )
      },
      {
        q: "How does \"Close & Distribute\" split the gain (or loss)?",
        a: (
          <p>
            Proportionally across members, based on how much each has in the fund at that moment — same
            principle as a bank interest distribution. The borrower never shares in their own loan&apos;s
            result, and anyone with nothing in the fund at that point doesn&apos;t get a share.
          </p>
        )
      },
      {
        q: "How do I edit investment shares or bank accounts?",
        a: (
          <p>
            On the Investments or Banks page, tap <strong>Manage</strong> — admins get an edit mode there
            that members don&apos;t see.
          </p>
        )
      }
    ]
  }
]

export default function HelpPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()

  const [activeTab, setActiveTab] = useState<Tab>("members")
  const [tabInitialized, setTabInitialized] = useState(false)

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }
  }, [authLoading, member, router])

  // Default to whichever tab matches the viewer's own role, once, the
  // first time it's known -- after that leave it alone so switching tabs
  // sticks.
  useEffect(() => {
    if (tabInitialized || !member) return
    setActiveTab(member.role === "borrower" ? "borrowers" : member.role === "admin" ? "admin" : "members")
    setTabInitialized(true)
  }, [member, tabInitialized])

  const checkingAccess = authLoading || !member || member.status !== "approved"
  const isBorrower = member?.role === "borrower"

  if (checkingAccess) {
    return (
      <>
        {isBorrower ? <BorrowerHeader /> : <Navbar />}
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  // Borrower accounts can't do anything the Members/Admin sections
  // describe -- they can't see the fund dashboard, other members, or the
  // Admin panel at all -- so only the Borrowers tab is relevant, and there's
  // nothing else worth switching to.
  const tabs: { id: Tab; label: string; sections: FaqSection[] }[] = isBorrower
    ? [{ id: "borrowers", label: "Borrowers", sections: borrowerSections }]
    : [
        { id: "members", label: "Members", sections: memberSections },
        { id: "borrowers", label: "Borrowers", sections: borrowerSections },
        { id: "admin", label: "Admin", sections: adminSections }
      ]

  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0]

  return (
    <>
      {isBorrower ? <BorrowerHeader /> : <Navbar />}
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Reference
          </div>
          <h1 className="font-display text-4xl font-semibold">Help</h1>
          <p className="text-sm text-ink-soft mt-2 max-w-md">
            Haru is meant to be simple enough to use without a manual. This is here for whenever you want a
            quick refresher, organized by what you're trying to do.
          </p>

          {tabs.length > 1 && (
            <div className="mt-6 flex bg-paper-2 border border-hairline rounded-md p-[3px]">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTab(t.id)
                    window.scrollTo(0, 0)
                  }}
                  className={`flex-1 py-2.5 rounded-[6px] text-sm font-semibold transition-colors ${
                    activeTab === t.id ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {active.sections.map((section) => (
            <FaqSectionCard key={section.title} title={section.title} items={section.items} />
          ))}
        </div>
      </main>
    </>
  )
}
