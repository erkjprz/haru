import { supabase } from "@/lib/supabase"

// Member <-> admin-team threads. See the 20261002000004 migration for the
// model: every conversation is one member and "the admins" as a group.

export type ConversationSummary = {
  id: string
  member_id: string
  member_name: string | null
  subject: string
  status: "open" | "closed"
  last_message_at: string
  last_message_body: string | null
  last_message_sender_id: string | null
  unread: boolean
}

export type ConversationMessage = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
}

export const SUBJECT_MAX = 120
export const BODY_MAX = 4000

export async function listConversations() {
  const { data, error } = await supabase.rpc("list_conversations")
  return { data: data as ConversationSummary[] | null, error }
}

export async function startConversation(memberId: string, subject: string, body: string) {
  return supabase.rpc("start_conversation", {
    p_member_id: memberId,
    p_subject: subject.trim(),
    p_body: body.trim()
  })
}

export async function markConversationRead(conversationId: string) {
  return supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId })
}

export async function setConversationStatus(conversationId: string, status: "open" | "closed") {
  return supabase.rpc("set_conversation_status", { p_conversation_id: conversationId, p_status: status })
}

export function formatMessageTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
