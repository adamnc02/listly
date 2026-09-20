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

/**
 * The household's permanent code. Idempotent by design — it returns the
 * existing code and only mints one if there isn't one.
 *
 * 🚨 But it is idempotent, not concurrency-safe. The function does a
 * check-then-insert against a `unique (household_id)` constraint:
 *
 *     select code ... if found, return it;
 *     insert into household_link_codes ...
 *
 * Two calls that arrive together both find nothing and both insert, and the
 * loser gets `23505 duplicate key value violates unique constraint
 * "household_link_codes_household_id_uniq"`. React StrictMode double-invokes
 * effects in development, so opening the Account modal reproduced it every
 * time (Adam, UAT 2026-09-20) — and two devices opening it at once would do
 * the same in production.
 *
 * The loser's retry is trivially correct: by the time it runs, the winner's
 * row exists, so the re-read returns it. One retry is enough — there is no
 * path where it can race twice, because after the first insert the row is
 * permanent.
 *
 * The real fix belongs in the ledger's own function (`on conflict
 * (household_id) do nothing`, then re-select). That is a migration against a
 * live shared function and is not Listly's to make unilaterally; noted in
 * PROMPT-03.
 */
export async function getLinkCode(): Promise<string> {
  const { data, error } = await sfl().rpc('create_household_link_code')
  if (!error) return data as string

  if (error.code === '23505') {
    const retry = await sfl().rpc('create_household_link_code')
    if (retry.error) throw retry.error
    return retry.data as string
  }
  throw error
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
