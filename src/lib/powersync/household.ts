import { sfl } from '../supabaseClient'

/**
 * The caller's household id, from shared_finance_ledger.ensure_household().
 *
 * 🚨 Listly does NOT have its own household model. It calls the ledger's
 * function and scopes its own rows by what that returns, which is why the
 * link code Adam and Ella already share links Listly too, with nothing to set
 * up and no second identity model to keep in step.
 *
 * On a brand-new account this creates the household and seeds the ledger's 35
 * default categories server-side. That is harmless and invisible — Listly
 * shows no category until the ledger step unlocks — and it is exactly what
 * the ledger would have created later anyway.
 *
 * Resolved once per user per session, and cleared on sign-out so a different
 * account on the same device never reuses it.
 */
let cachedHouseholdId: string | null = null
let cachedForUserId: string | null = null

export async function getHouseholdId(userId: string): Promise<string> {
  if (cachedHouseholdId && cachedForUserId === userId) return cachedHouseholdId
  const { data, error } = await sfl().rpc('ensure_household')
  if (error) throw error
  if (typeof data !== 'string' || !data) throw new Error('ensure_household returned no household')
  cachedHouseholdId = data
  cachedForUserId = userId
  return data
}

export function clearHouseholdCache(): void {
  cachedHouseholdId = null
  cachedForUserId = null
}

/**
 * 🚨 Re-read after anything that can move the user between households — a
 * link-code redeem, or "Delete my app data". The cached id is stale the
 * instant either happens, and writing with a stale household_id is how
 * deleted data gets resurrected (MIGRATION-LESSONS §38).
 */
export async function refreshHouseholdId(userId: string): Promise<string> {
  clearHouseholdCache()
  return getHouseholdId(userId)
}
