import { sfl } from '../supabaseClient'

/**
 * Household linking. Every one of these is the LEDGER's function, called
 * unchanged — Listly deliberately adds no linking model of its own.
 *
 * 🚨 There is ONE link code and it belongs to the HOUSEHOLD, not to an app.
 * create_household_link_code() is idempotent: it returns the household's
 * existing code and only mints one if there isn't one. So Listly shows the
 * IDENTICAL 8 characters the ledger's Account modal shows. Listly must never
 * generate a second code, never offer "create a household", and never build a
 * second linking model.
 */

export async function getLinkCode(): Promise<string> {
  const { data, error } = await sfl().rpc('create_household_link_code')
  if (error) throw error
  return data as string
}

export async function regenerateLinkCode(): Promise<string> {
  const { data, error } = await sfl().rpc('regenerate_household_link_code')
  if (error) throw error
  return data as string
}

export interface RedeemResult {
  household_id: string
  brought_own_data: boolean
  own_person_id: string | null
  moved: Record<string, number>
  duplicate_person_id: string | null
  old_household_deleted: boolean
}

/**
 * Join the household that owns a code.
 *
 * The returned `moved` now carries Listly's own counts
 * (`listly_shopping_lists`, `listly_shopping_items`, `listly_house_jobs`,
 * `listly_shop_completions`) because 20260920150000 added a guarded `listly`
 * block. Before that migration this call silently destroyed a Listly user's
 * lists and house jobs — the old household was deleted and listly.* cascades
 * off households(id).
 *
 * D8: Listly's household data comes with you only if you were the LAST MEMBER
 * OUT. If a partner remains it stays behind, like joint items. `my_jobs`
 * always comes with you — it is keyed on the login.
 *
 * 🚨 The caller must refresh the cached household id afterwards, and the sync
 * store must notice the change (§38).
 */
export async function redeemLinkCode(code: string): Promise<RedeemResult> {
  const { data, error } = await sfl().rpc('redeem_household_link_code', { p_code: code })
  if (error) throw error
  return data as RedeemResult
}

/**
 * "Delete my app data", login kept. Also deletes the caller's Listly rows:
 * my_jobs, push_subscriptions and reminder_log go unconditionally (they have
 * no household_id, so nothing would cascade them), and the household tables
 * go with the household when the caller is its only member.
 */
export async function eraseMyData(): Promise<Record<string, unknown>> {
  const { data, error } = await sfl().rpc('erase_my_data')
  if (error) throw error
  return data as Record<string, unknown>
}
