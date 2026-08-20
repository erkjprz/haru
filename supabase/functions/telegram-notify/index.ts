import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

// Kept in sync by hand with TRANSACTION_TYPE_LABELS in lib/transactionLabels.ts
// -- this Deno function can't import from the Next.js app's lib.
const CLASSIFICATION_LABEL: Record<string, string> = {
  "Opening Balance": "Opening Balance",
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal",
  "Loan Release": "Loan Release",
  "Loan Repayment": "Loan Repayment",
  "Investment": "Investment",
  "Investment Return": "Investment Return",
  "Bank Interest": "Bank Interest",
  "Tax": "Tax",
  "Internal Transfer": "Bank Transfer",
  "Expense": "Expense",
  "Gain Allocation": "Distributed Share",
  "Bank Write-off": "Bank Write-off"
}

function formatAmount(amount: number) {
  const abs = Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
  return `${amount < 0 ? "-" : ""}₱${abs}`
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

async function describeTransaction(record: Record<string, unknown>) {
  const parts: string[] = []

  if (record.member_id) {
    const { data } = await supabase
      .from("members")
      .select("name")
      .eq("member_id", record.member_id)
      .maybeSingle()
    if (data?.name) parts.push(`Member: ${escapeHtml(data.name)}`)
  }

  if (record.bank_account_id) {
    const { data } = await supabase
      .from("bank_accounts")
      .select("bank_name, account_name")
      .eq("id", record.bank_account_id)
      .maybeSingle()
    if (data) parts.push(`Bank: ${escapeHtml(data.account_name ? `${data.bank_name} (${data.account_name})` : data.bank_name)}`)
  }

  if (record.to_bank_account_id) {
    const { data } = await supabase
      .from("bank_accounts")
      .select("bank_name, account_name")
      .eq("id", record.to_bank_account_id)
      .maybeSingle()
    if (data) parts.push(`To bank: ${escapeHtml(data.account_name ? `${data.bank_name} (${data.account_name})` : data.bank_name)}`)
  }

  if (record.loan_id) {
    const { data } = await supabase
      .from("loans")
      .select("name")
      .eq("loan_id", record.loan_id)
      .maybeSingle()
    if (data?.name) parts.push(`Loan: ${escapeHtml(data.name)}`)
  }

  if (record.investment_id) {
    const { data } = await supabase
      .from("investments")
      .select("name")
      .eq("investment_id", record.investment_id)
      .maybeSingle()
    if (data?.name) parts.push(`Investment: ${escapeHtml(data.name)}`)
  }

  return parts
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret")
    return new Response("Not configured", { status: 500 })
  }

  const payload = await req.json().catch(() => null)
  const record = payload?.record as Record<string, unknown> | undefined

  if (!record) {
    return new Response("Bad request", { status: 400 })
  }

  const classification = CLASSIFICATION_LABEL[record.classification as string] ?? record.classification
  const amount = formatAmount(Number(record.amount))

  // The DB trigger only ever calls this for a freshly-pending row now (see
  // notify_telegram_transaction) -- one situation, so one fixed headline,
  // no more varying by event/status.
  const lines = [`🔔 <b>New transaction</b>`, `${escapeHtml(String(classification))} — ${amount}`]

  const details = await describeTransaction(record)
  lines.push(...details)

  if (record.description) lines.push(`Note: ${escapeHtml(String(record.description))}`)

  const text = lines.join("\n")

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  })

  if (!res.ok) {
    const body = await res.text()
    console.error("Telegram API error", res.status, body)
    return new Response("Telegram send failed", { status: 502 })
  }

  return new Response("ok", { status: 200 })
})
