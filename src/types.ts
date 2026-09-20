/**
 * Listly's domain types.
 *
 * These are the app's shapes, not the database's. They are deliberately
 * close to LISTLY-DESIGN.md §6 "Data model (as prototyped)" so the
 * prototype's behaviour can be reproduced exactly, and close to
 * PROMPT-01 §5's tables so Phase 2's mapping layer is a rename rather than
 * a redesign. Where they differ from §5, the reason is written down here.
 */

export type JobPage = 'house' | 'mine'

/** An ISO calendar date, 'YYYY-MM-DD'. Always built and read through
 *  src/lib/date.ts — never `new Date(iso)` or `.toISOString().slice(0,10)`.
 *  `''` means "no due date", matching the prototype and the `'' <-> NULL`
 *  rule the sync layer will apply in Phase 3. */
export type IsoDate = string

export interface Item {
  id: string
  text: string
  done: boolean
}

export interface List {
  id: string
  name: string
  isDefault: boolean
  items: Item[]
  /** Created 'YYYY-MM-DD'. PROMPT-01 §5.1 maps this to `created_at`. */
  createdAt: IsoDate
  /**
   * "Just created, has never held an item" — the list stays visible while
   * empty until its first item arrives (LISTLY-DESIGN.md §2: "A list you've
   * just created is shown even though it's empty... Once it has had items
   * and is emptied, the normal hide rule applies").
   *
   * 🚨 This is NOT derivable from `created_at`, which is what PROMPT-01 §5.1
   * assumes. `created_at` can express "made recently"; it cannot express
   * "has never had an item", which is the rule the design doc and the
   * prototype actually implement. Phase 2 has to decide between a real
   * column and a time-based approximation. Raised with Adam, not guessed.
   */
  neverHadItems: boolean
  /**
   * The ledger category this list's shops book against, set in Manage lists
   * (PROMPT-01 §8.2d). `''` when the list has none — which makes Finish shop
   * insert a one-off category step at the FRONT of the flow and save the
   * answer back onto the list, so it is asked once, ever.
   *
   * 🚨 Carries its `@<household_id>` suffix VERBATIM (§31). Never stripped,
   * never added to.
   */
  categoryId: string
}

export interface Job {
  id: string
  page: JobPage
  text: string
  due: IsoDate
  /** Never true while `due` is ''. Enforced on every write in the context,
   *  and by a CHECK constraint in Phase 2 (PROMPT-01 §5.3). */
  remind: boolean
  done: boolean
}

/** `open` (expanded/collapsed) and dismissed banners are per-device UI
 *  state in localStorage, never synced — Adam, 2026-09-20, settling
 *  PROMPT-01 §5.7 and §14 Q1. Ella collapsing the Tesco list must not
 *  collapse it on Adam's phone mid-shop. See src/lib/deviceState.ts. */
export interface DeviceState {
  openLists: Record<string, boolean>
  dismissedBanners: Record<string, IsoDate>
  doneOpen: Record<JobPage, boolean>
}

/**
 * A `shared_finance_ledger` category, read through the `lst_ref_categories`
 * mirror. Listly reads these and writes them never.
 *
 * 🚨 `id` carries an `@<household_id>` suffix (§31). Stored on the list and
 * passed to the trigger VERBATIM — never stripped, never added to.
 */
export interface LedgerCategory {
  id: string
  name: string
  icon: string
  iconColor: string
}

/**
 * One entry in the Finish-shop location picker (PROMPT-01 §8.2b). Each names
 * a real account a shop can be paid from, and settles `owner_id`/`pot_id`
 * outright — which is why there is no separate "who's this for" step.
 *
 * `label` alone carries the bracket rule (the owner's name only when the
 * household has more than one person ROW). The other three fields are
 * written identically whichever way the label renders.
 */
export interface LocationOption {
  key: string
  label: string
  location: 'joint' | 'personal' | 'pot'
  /** '' for joint — a joint expense stores no owner (§8.2c). */
  ownerId: string
  /** '' unless `location` is 'pot'. */
  potId: string
}

/** What Finish shop collects before it writes a completion row. */
export interface ShopCompletionDraft {
  listId: string
  listName: string
  /** Kept in Listly only. The ledger trigger never reads it. */
  itemsSnapshot: string
  categoryId: string
  amount: number
  spendDate: IsoDate
  location: LocationOption
}
