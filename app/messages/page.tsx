"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { Sheet } from "@/app/components/Sheet"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { readCache, writeCache } from "@/lib/cache"
import {
  BODY_MAX,
  SUBJECT_MAX,
  formatMessageTime,
  listConversations,
  startConversation,
  type ConversationSummary
} from "@/lib/conversations"

type MemberOption = { member_id: string; name: string; role: string }

// useSearchParams() (for the admin "?to=<memberId>" deep link from the
// Members page) needs its own Suspense boundary -- same pattern as
// EditTransactionSheetHost.
export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesInbox />
    </Suspense>
  )
}

function MessagesInbox() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const cacheKey = member ? `conversations:${member.member_id}` : null
  const cached = cacheKey ? readCache<ConversationSummary[]>(cacheKey) : undefined

  const [conversations, setConversations] = useState<ConversationSummary[]>(cached ?? [])
  const [dataLoading, setDataLoading] = useState(!cached)
  const [loadError, setLoadError] = useState("")
  const [filter, setFilter] = useState<"open" | "closed">("open")
  const [composeOpen, setComposeOpen] = useState(false)
  const preselectedMemberId = searchParams.get("to")

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

    async function load() {
      const key = `conversations:${member!.member_id}`
      const { data, error } = await listConversations()
      if (error) {
        setLoadError(error.message)
      } else {
        setConversations(data ?? [])
        writeCache(key, data ?? [])
      }
      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router])

  // Admin deep link from the Members page opens the composer pre-filled
  // with that member; closing it drops the param so a refresh doesn't
  // reopen it.
  const composeVisible = composeOpen || (isAdmin && !!preselectedMemberId)

  function closeCompose() {
    setComposeOpen(false)
    if (preselectedMemberId) router.replace("/messages", { scroll: false })
  }

  const Header = member?.role === "borrower" ? BorrowerHeader : Navbar

  if (authLoading || !member || member.status !== "approved" || dataLoading) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  // Members see every thread of their own; admins work an inbox, so
  // closed threads are filed away behind their own chip.
  const visible = isAdmin ? conversations.filter((c) => c.status === filter) : conversations
  const unreadOpen = conversations.filter((c) => c.unread && c.status === "open").length

  return (
    <>
      <Header />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
                {isAdmin ? "Administration" : "Support"}
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">Messages</h1>
              <p className="text-[13px] text-ink-soft mb-6">
                {isAdmin
                  ? "Conversations between members and the admin team."
                  : "Questions for the admins? Every admin can see and reply."}
              </p>
            </div>
            <button
              onClick={() => setComposeOpen(true)}
              className="shrink-0 bg-gold-soft text-ink px-4 py-2.5 rounded-sm text-sm font-semibold"
            >
              + New
            </button>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2 mb-4">
              {(["open", "closed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3.5 py-1.5 rounded-full text-[13px] border ${
                    filter === f ? "bg-ink text-paper border-ink" : "border-hairline text-ink-soft"
                  }`}
                >
                  {f === "open" ? `Open${unreadOpen > 0 ? ` · ${unreadOpen} unread` : ""}` : "Closed"}
                </button>
              ))}
            </div>
          )}

          {loadError && <p className="text-sm text-rust mb-4">Couldn&apos;t load messages: {loadError}</p>}

          {!loadError && visible.length === 0 && (
            <p className="text-sm text-ink-soft text-center py-12 bg-paper-2 border border-hairline rounded-md">
              {isAdmin && filter === "closed" ? "No closed conversations." : "No conversations yet."}
            </p>
          )}

          {visible.length > 0 && (
            <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline">
              {visible.map((c) => {
                const fromMe = c.last_message_sender_id === member.member_id
                const prefix = fromMe ? "You: " : !isAdmin ? "Admins: " : ""
                return (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/messages/${c.id}`)}
                    className="w-full text-left px-5 py-3.5 flex items-start gap-3"
                  >
                    {c.unread && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gold shrink-0" />}
                    <div className={c.unread ? "flex-1 min-w-0" : "flex-1 min-w-0 ml-[18px]"}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`text-sm text-ink truncate ${c.unread ? "font-semibold" : "font-medium"}`}>
                          {isAdmin && c.member_name ? `${c.member_name} · ` : ""}
                          {c.subject}
                        </p>
                        <span className="text-[11px] text-ink-soft font-mono shrink-0">
                          {formatMessageTime(c.last_message_at)}
                        </span>
                      </div>
                      {c.last_message_body && (
                        <p className="text-[13px] text-ink-soft mt-0.5 truncate">
                          {prefix}
                          {c.last_message_body}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {composeVisible && (
        <ComposeSheet
          isAdmin={isAdmin}
          selfId={member.member_id}
          preselectedMemberId={isAdmin ? preselectedMemberId : null}
          onClose={closeCompose}
          onStarted={(id) => router.push(`/messages/${id}`)}
        />
      )}
    </>
  )
}

function ComposeSheet({
  isAdmin,
  selfId,
  preselectedMemberId,
  onClose,
  onStarted
}: {
  isAdmin: boolean
  selfId: string
  preselectedMemberId: string | null
  onClose: () => void
  onStarted: (conversationId: string) => void
}) {
  const [members, setMembers] = useState<MemberOption[]>([])
  const [recipientId, setRecipientId] = useState(preselectedMemberId ?? "")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isAdmin) return
    supabase
      .from("members")
      .select("member_id, name, role")
      .eq("status", "approved")
      .neq("member_id", selfId)
      .order("name")
      .then(({ data }) => setMembers(data ?? []))
  }, [isAdmin, selfId])

  const targetId = isAdmin ? recipientId : selfId
  const canSend = !!targetId && subject.trim().length > 0 && body.trim().length > 0 && !sending

  async function send() {
    if (!canSend) return
    setSending(true)
    setError("")
    const { data, error } = await startConversation(targetId, subject, body)
    if (error || !data) {
      setError(error?.message ?? "Couldn't start the conversation.")
      setSending(false)
      return
    }
    onStarted(data as string)
  }

  return (
    <Sheet
      title={isAdmin ? "Message a Member" : "Message the Admins"}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send"}
        </button>
      }
    >
      <div className="space-y-3">
        {isAdmin && (
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-ink-soft font-mono mb-1.5">To</span>
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full bg-paper-2 border border-hairline rounded-md px-3 py-2.5 text-sm text-ink"
            >
              <option value="">Choose a member…</option>
              {members.map((m) => (
                <option key={m.member_id} value={m.member_id}>
                  {m.name}
                  {m.role === "borrower" ? " (borrower)" : m.role === "admin" ? " (admin)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-ink-soft font-mono mb-1.5">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={SUBJECT_MAX}
            placeholder={isAdmin ? "e.g. About your March contribution" : "e.g. Question about my loan"}
            className="w-full bg-paper-2 border border-hairline rounded-md px-3 py-2.5 text-sm text-ink placeholder:text-ink-soft outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-ink-soft font-mono mb-1.5">Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={BODY_MAX}
            rows={5}
            className="w-full bg-paper-2 border border-hairline rounded-md px-3 py-2.5 text-sm text-ink outline-none resize-none"
          />
        </label>
        {error && <p className="text-sm text-rust">{error}</p>}
      </div>
    </Sheet>
  )
}
