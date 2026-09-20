import type { IsoDate, Item, Job, JobPage, List } from '../../types'

/**
 * The mapping boundary: PowerSync's flat SQLite rows ↔ the app's types.
 *
 * Two rules matter more than the rest:
 *
 * 1. **`'' ↔ NULL` for every id-shaped column, both directions.** The app
 *    uses `''` for "no due date", "no category"; Postgres uses NULL. Sending
 *    `''` where a real id is expected is how you get a `23503` — which the
 *    connector treats as fatal and DISCARDS silently (§27). This is the same
 *    rule the ledger applies, for the same reason.
 *
 * 2. **Booleans arrive as 0/1 integers**, dates/timestamps as text. Parsed
 *    here so nothing above this file has to think about SQLite's types.
 *
 * Every column read falls back to a sensible default: PowerSync's synced
 * columns are nullable by nature even where the Postgres column is NOT NULL,
 * because a row can arrive mid-sync.
 */

export type Row = Record<string, unknown>

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown): boolean => v === 1 || v === true
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v)

/** NULL/undefined → '' coming down. */
export const fromDbId = (v: unknown): string => (typeof v === 'string' ? v : '')
/** '' → null going up, so an empty string never reaches an id column. */
export const toDbId = (v: string): string | null => (v === '' ? null : v)

export function rowToList(row: Row, items: Item[]): List {
  return {
    id: str(row.id),
    name: str(row.name),
    isDefault: bool(row.is_default),
    neverHadItems: bool(row.never_had_items),
    createdAt: fromDbId(row.created_at).slice(0, 10) as IsoDate,
    items,
  }
}

export function rowToItem(row: Row): Item {
  return { id: str(row.id), text: str(row.text), done: bool(row.done) }
}

export function rowToJob(row: Row, page: JobPage): Job {
  return {
    id: str(row.id),
    page,
    text: str(row.text),
    // A date column comes down as text, or null when unset. The app's "no
    // due date" is '', which is also what the due-date input uses.
    due: fromDbId(row.due_date) as IsoDate,
    remind: bool(row.remind),
    done: bool(row.done),
  }
}

/** `order by position, id` — the ordering every list is read back with. */
export function byPosition(a: Row, b: Row): number {
  const pa = num(a.position)
  const pb = num(b.position)
  // A null position sorts last, deterministically, so a row that arrives
  // before its position does not jump around.
  if (pa === null && pb === null) return str(a.id) < str(b.id) ? -1 : 1
  if (pa === null) return 1
  if (pb === null) return -1
  if (pa !== pb) return pa - pb
  return str(a.id) < str(b.id) ? -1 : 1
}

/**
 * Position maths. Append goes after the last sibling; a mid-list insert takes
 * the midpoint of its neighbours.
 *
 * 🚨 Deleting NEVER renumbers. That is not laziness — PowerSync resolves
 * conflicts per column, and renumbering would rewrite every sibling row on
 * every delete, turning one narrow write into a whole-list write and
 * destroying that property across the app.
 */
export function appendPosition(existing: Array<number | null>): number {
  const max = existing.reduce<number>((m, p) => (p !== null && p > m ? p : m), -1)
  return max + 1
}

export function midpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0
  if (before === null) return (after as number) - 1
  if (after === null) return before + 1
  return (before + after) / 2
}

export const positionOf = (row: Row | undefined): number | null =>
  row === undefined ? null : num(row.position)
