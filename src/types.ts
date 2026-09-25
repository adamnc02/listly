/**
 * Listly's domain types.
 *
 * These are the app's shapes, not the database's. They deliberately stayed
 * close to the original prototype's data model, so its behaviour could be
 * reproduced exactly, and close to the planned tables so the sync mapping
 * layer was a rename rather than a redesign. Both of those are now built and
 * these types are the authority; where a shape looks odd, the reason is
 * written down beside it.
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
   * empty until its first item arrives. The rule, in full: a list you have
   * just created is shown even though it is empty, so you can add its first
   * items; once it has held items and is emptied, the normal hide rule
   * applies (TECHNICAL.md §8).
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
  /** 'HH:MM' London time, or '' for none. Only meaningful with a `due`. */
  dueTime: string
  /** A rule in src/lib/recurrence.ts's format, or '' for a one-off job. */
  repeat: string
  /** src/lib/alerts.ts: '' is the default (3 days before). */
  alertOffset: string
  /** 'HH:MM' for day/week offsets; '' is the default (08:00). */
  alertTime: string
}

/** Everything the create/edit sheet saves in one go (TECHNICAL.md §12). */
export type JobDraft = Pick<Job, 'text' | 'due' | 'dueTime' | 'repeat' | 'remind' | 'alertOffset' | 'alertTime'>

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
  /**
   * The owner's first name, for copy that has to name a person — the
   * round-up step's "Ella's Coin Jar". 🚨 Follows the SAME rule as the
   * bracket in `label`: '' in a one-person household, where the name is
   * noise and the jar is simply "your Coin Jar". Never used for
   * attribution — that is `ownerId`.
   */
  ownerName: string
  /** '' unless `location` is 'pot'. */
  potId: string
}

/** What Finish shop collects before it writes a completion row. */
export interface ShopCompletionDraft {
  listId: string
  listName: string
  /** Kept in Listly only. The ledger trigger never reads it. */
  itemsSnapshot: string
  /** The items left UNticked, newline-joined — "except for…" in the push. */
  itemsLeft: string
  categoryId: string
  /**
   * What is BOOKED. Already the ROUNDED figure (£8.00) on a shop that
   * rounded — the same convention the ledger stores, so every reader of
   * transactions.amount is correct untouched (APP-KNOWLEDGE §1.19d).
   */
  amount: number
  spendDate: IsoDate
  location: LocationOption
  /**
   * PROMPT-05. The real price (£7.50) when this shop rounded up, and the
   * Coin Jar the uplift feeds. 🚨 BOTH, or NEITHER — both tables carry a
   * both-or-neither CHECK, and a violated CHECK is a write PowerSync
   * silently discards (§27). `shopRoundUpFields()` returns the pair so no
   * caller can write half of it.
   */
  roundedFrom: number | null
  roundingPotId: string | null
  /**
   * PROMPT-05 follow-up (UAT 2026-09-22). True only when the person saw the
   * round-up step and chose "Leave it at £7.50". 🚨 It is carried into
   * `transactions.round_up_skipped`, and it is what stops the LEDGER
   * re-rounding this row the next time it is saved there — the ledger
   * recomputes rounding on every save, and Listly does not.
   */
  roundUpSkipped: boolean
}
