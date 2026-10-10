import { redirect } from "next/navigation"

// Borrowers now live on the Members page (its Borrowers filter) -- this
// keeps old bookmarks working.
export default function AdminBorrowersPage() {
  redirect("/admin/members?filter=borrowers")
}
