import { useMemo } from 'react'
import { useWatchedQuery } from './useWatchedQuery'
import { byPosition, type Row } from './mapping'
import type { LedgerCategory, LocationOption } from '../../types'

/**
 * Everything Listly reads OUT of `shared_finance_ledger`, and nothing it
 * writes back.
 *
 * 🚨 Every query here reads a `lst_ref_` LOCAL MIRROR table, never the
 * network. That is the whole design: the D4 gate and the location picker
 * have to work standing in a shop with no signal, and Finish shop must not
 * add a request. They also re-evaluate on every sync delivery, so the moment
 * a `people` row appears in the ledger the price step appears in Listly —
 * no reload, no setting.
 *
 * Listly NEVER writes any of these tables. The connector refuses to upload
 * them, and the only write Listly makes into that schema is the single
 * transactions row, which happens inside the database via a trigger.
 */

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown): boolean =>
  v === 1 || v === true || v === '1' || v === 'true' || v === 't'

/**
 * 🚨 THE D4 GATE.
 *
 * The price step, and the category chip in Manage lists, appear only when
 * the household has at least one `people` row. Without one there is no
 * Current Account to offer and no pot owner to name, so the picker could not
 * be built at all.
 *
 * 🚨 NOT a category count. `ensure_household()` seeds 35 categories into
 * every household, so a count is never zero and would open the flow on day
 * one for someone with no ledger.
 */
export function useLedgerGate(): boolean {
  const rows = useWatchedQuery('SELECT 1 AS present FROM lst_ref_people LIMIT 1')
  return rows.length > 0
}

/**
 * The household's categories, for the list category chip.
 *
 * 🚨 Ids carry an `@<household_id>` suffix (§31). Read, stored and written
 * VERBATIM — never stripped, never added to.
 */
export function useLedgerCategories(): LedgerCategory[] {
  const rows = useWatchedQuery('SELECT * FROM lst_ref_categories')
  return useMemo(
    () =>
      [...rows].sort(byPosition).map((r) => ({
        id: str(r.id),
        name: str(r.name),
        icon: str(r.icon),
        iconColor: str(r.icon_color),
      })),
    [rows],
  )
}

/**
 * The default category for a NEW list: "Food", then "Shopping", then
 * whatever exists. Both are real seeded ids — `defaultCategories()` emits
 * `category-seed-<icon>` for every icon in the ledger's `billIcons.ts`,
 * which includes both. **A seeded category is deletable**, so never assume
 * either is there: always fall through.
 */
export function defaultCategoryId(categories: LedgerCategory[], householdId: string): string {
  const seeded = (name: string) => `category-seed-${name}@${householdId}`
  const byId = new Set(categories.map((c) => c.id))
  if (byId.has(seeded('food'))) return seeded('food')
  if (byId.has(seeded('shopping'))) return seeded('shopping')
  return categories[0]?.id ?? ''
}

/**
 * The location picker (PROMPT-01 §8.2b). ONE flat list, every entry naming a
 * real account a shop can be paid from, and each one settling `owner_id` and
 * `pot_id` outright — which is why there is no separate "who's this for"
 * step.
 *
 * Order: Joint account, then Current Accounts, then pots.
 *
 * 🚨 THE BRACKET RULE, amended by Adam 2026-09-20. The owner's name in
 * brackets appears ONLY when the household has more than one `people` ROW.
 * Solo — Adam's mum, who will use both apps on her own — it reads plainly
 * "Current Account" and "Holiday fund", not "Current Account (Mum)". There
 * is nothing to disambiguate, so the name is noise.
 *
 * The test is people ROWS, not logins, and those differ: person rows existed
 * long before any login did, so one login can own two person rows (Adam
 * tracking both himself and Ella before she ever signed in). Keying on
 * logins would collapse the picker to two entries both labelled "Current
 * Account", which is worse than the noise the rule removes.
 *
 * 🚨 It is a LABEL rule only. `location`, `owner_id` and `pot_id` are
 * written identically either way.
 *
 * 🚨 No `joint_account` row → "Joint account" is omitted ENTIRELY and the
 * first Current Account becomes the default. `ensure_household()` seeds no
 * joint account, so that is the normal solo case, not an edge case. Never
 * offer an option that cannot be booked.
 *
 * Savings pots are deliberately absent — the ledger's own ad-hoc entry
 * excludes them (`AdHocInput.location` is `'joint' | 'pot'` only, commented
 * "never a Savings Pot — excluded by design"), and Listly must produce
 * exactly what the ledger would. They are not even synced any more.
 * Coin jars are excluded for the same reason (`fundablePots()`): a Coin Jar
 * is a round-up destination, not somewhere a shop is paid from.
 */
export function useLocationOptions(userId: string | null): LocationOption[] {
  const peopleRows = useWatchedQuery('SELECT * FROM lst_ref_people')
  const potRows = useWatchedQuery('SELECT * FROM lst_ref_pots')
  const jointRows = useWatchedQuery('SELECT 1 AS present FROM lst_ref_joint_account LIMIT 1')

  return useMemo(() => {
    const people = [...peopleRows].sort(byPosition)
    // 🚨 people ROWS, not logins. See the doc comment.
    const showOwner = people.length > 1
    const named = (base: string, ownerName: string) =>
      showOwner && ownerName ? `${base} (${ownerName})` : base

    // Ordering only, never attribution: put the signed-in user's own Current
    // Account first among the Current Accounts. A wrong guess here costs
    // nothing, which is exactly why `linked_user_id` is allowed to drive it —
    // and Listly reads it for this and writes it never.
    const mine = (r: Row) => (userId && str(r.linked_user_id) === userId ? 0 : 1)
    const ordered = [...people].sort((a, b) => mine(a) - mine(b))

    const options: LocationOption[] = []

    if (jointRows.length > 0) {
      options.push({ key: 'joint', label: 'Joint account', location: 'joint', ownerId: '', potId: '', ownerName: '' })
    }

    for (const p of ordered) {
      options.push({
        key: `personal:${str(p.id)}`,
        // "Current Account" is the ledger's own label for location
        // 'personal' (Expenses.tsx:817). Use that exact wording, not
        // "Personal", so the two apps read the same.
        label: named('Current Account', str(p.name)),
        location: 'personal',
        ownerId: str(p.id),
        potId: '',
        // Same rule as the bracket above: named only when there is more
        // than one person to tell apart.
        ownerName: showOwner ? str(p.name) : '',
      })
    }

    const nameOf = new Map(people.map((p) => [str(p.id), str(p.name)]))
    for (const pot of [...potRows].sort(byPosition)) {
      if (!bool(pot.active)) continue
      if (bool(pot.is_coin_jar)) continue
      const ownerId = str(pot.person_id)
      options.push({
        key: `pot:${str(pot.id)}`,
        // Every pot has an owner: pots.person_id is NOT NULL references
        // people(id), so there is no "unknown" case to design for.
        label: named(str(pot.name), nameOf.get(ownerId) ?? ''),
        location: 'pot',
        ownerId,
        potId: str(pot.id),
        ownerName: showOwner ? (nameOf.get(ownerId) ?? '') : '',
      })
    }

    return options
  }, [peopleRows, potRows, jointRows, userId])
}

/**
 * Completions that failed to reach the ledger, newest first.
 *
 * A silent failure here is exactly the class of bug this workstream keeps
 * paying for, so it is surfaced rather than logged: the Shopping page shows
 * "Couldn't add to the ledger — tap to retry", and the retry re-writes
 * `amount`, which is what the trigger fires on.
 */
export interface FailedCompletion {
  id: string
  listName: string
  amount: number
  error: string
}

export function useFailedCompletions(): FailedCompletion[] {
  const rows = useWatchedQuery(
    `SELECT id, list_name, amount, ledger_error FROM lst_shop_completions
      WHERE ledger_error IS NOT NULL AND ledger_error <> ''
      ORDER BY completed_at DESC`,
  )
  return useMemo(
    () =>
      rows.map((r) => ({
        id: str(r.id),
        listName: str(r.list_name),
        amount: Number(r.amount ?? 0),
        error: str(r.ledger_error),
      })),
    [rows],
  )
}
