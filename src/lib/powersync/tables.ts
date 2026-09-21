// The ONE list of synced tables.
//
// schema.ts builds the local PowerSync schema from it, connector.ts maps
// local names back to Postgres ones, and scripts/print-sync-streams.ts prints
// the Sync Streams YAML from it — so the three can never drift apart. That
// last point is the whole reason this file exists rather than three hand-kept
// lists: PowerSync names the local SQLite table after the query's alias, so
// an alias the app doesn't know about silently renames a table and every
// query against the real name returns zero rows, with no error (§7, §32).
//
// 🚨 TWO PREFIXES, AND THEY MEAN DIFFERENT THINGS
//
//   lst_      Listly's own tables, in the `listly` schema. Read AND written.
//   lst_ref_  A READ-ONLY mirror of five small `shared_finance_ledger`
//             tables. Listly never writes these. The connector refuses to
//             upload them (connector.ts), and the only write Listly ever
//             makes into that schema is the single transactions row, which
//             happens inside the database via a trigger.
//
// Why prefixes at all: four apps share the origin adamnc02.github.io and one
// login. personal-f's stream is auto_subscribed and outputs BARE names
// (`people`, `households`, `loans`…); shared-finance-ledger's outputs `sfl_`.
// Audited against the live Sync Streams config on 2026-09-20: 45 distinct
// output names across all four streams, no collisions.
//
// Deliberately NOT declared locally, matching the ledger:
//   - `id`: PowerSync adds it;
//   - `user_id`: it defaults to auth.uid() server-side, and declaring it
//     would send `user_id: null` over that default on upsert.
//
// Types (docs.powersync.com/sync/types): numeric → real, boolean → 0/1
// integer, and date/uuid/timestamptz → text. There is NO json kind here,
// because there is no jsonb column anywhere in the `listly` schema — which
// is what makes MIGRATION-LESSONS §33 impossible in this app rather than
// merely avoided. Keep it that way.

export type ColumnKind = 'text' | 'real' | 'integer' | 'bool'

export interface SyncedTable {
  /** The Postgres table name, within `schema`. */
  remote: string
  /** Which Postgres schema it lives in. */
  schema: 'listly' | 'shared_finance_ledger'
  columns: Record<string, ColumnKind>
  /** Scoped by household_id? (false = user-scoped, or a singleton.) */
  household: boolean
  /** False for every lst_ref_ mirror: the connector must never upload them. */
  writable: boolean
}

export const OWN_PREFIX = 'lst_'
export const REF_PREFIX = 'lst_ref_'
export const SCHEMA = 'listly'
export const LEDGER_SCHEMA = 'shared_finance_ledger'

const H = { household_id: 'text' } as const
const P = { position: 'real' } as const
/** house_jobs and my_jobs are the same shape; only their scoping differs. */
const JOB = {
  text: 'text', due_date: 'text', remind: 'bool', done: 'bool', done_at: 'text', ...P,
} as const

function own(remote: string, columns: Record<string, ColumnKind>, household = true): SyncedTable {
  return { remote, schema: SCHEMA, columns, household, writable: true }
}
function ref(remote: string, columns: Record<string, ColumnKind>, household = true): SyncedTable {
  return { remote, schema: LEDGER_SCHEMA, columns, household, writable: false }
}

/**
 * In FK order: parents before children. Inserts run in this order and deletes
 * in reverse, or an FK-bound write is rejected 23503 — which the connector
 * treats as fatal and DISCARDS (§27).
 */
export const SYNCED_TABLES: SyncedTable[] = [
  // ── Listly's own, writable ───────────────────────────────────────────────
  own('shopping_lists', {
    ...H,
    name: 'text',
    is_default: 'bool',
    // "Has never held an item" — the rule that keeps a just-created list
    // visible while empty. Its own column because created_at cannot express
    // it (APP-KNOWLEDGE §4).
    never_had_items: 'bool',
    // Carries the '@<household_id>' suffix verbatim. Never strip or add one.
    category_id: 'text',
    created_at: 'text',
    ...P,
  }),
  own('shopping_items', { ...H, list_id: 'text', text: 'text', done: 'bool', ...P }),
  own('house_jobs', { ...H, ...JOB }),
  // No household_id: my_jobs is private to one login, and that is enforced by
  // the column default, the RLS policy and the stream predicate independently.
  own('my_jobs', { ...JOB }, false),
  own('shop_completions', {
    ...H,
    list_id: 'text', list_name: 'text', completed_at: 'text',
    amount: 'real', spend_date: 'text', category_id: 'text', payment_method: 'text',
    location: 'text', owner_id: 'text', pot_id: 'text',
    // What was bought, kept in LISTLY ONLY. Adam, 2026-09-20: "only amount
    // needs to be recorded to shared-ledger-finance, but would be handy to
    // have that information in listly's tables". The ledger-bridge trigger
    // never reads it, so no item detail can reach shared_finance_ledger.
    // A newline-separated snapshot of the ticked names, deliberately not a
    // foreign key: Finish shop deletes those item rows, and the point of a
    // snapshot is that it outlives them.
    items_snapshot: 'text',
    // PROMPT-05. The real price of a shop that rounded up, and the Coin Jar
    // its uplift feeds. `amount` above is ALREADY the rounded figure. Both
    // set or both null; the bridge trigger carries them into
    // shared_finance_ledger.transactions and computes nothing.
    rounded_from: 'real', rounding_pot_id: 'text',
    // Written by the ledger-bridge trigger, never by the app. Synced so the
    // UI can show "couldn't add to the ledger — tap to retry" instead of
    // failing silently, which is the failure mode this workstream keeps
    // paying for.
    transaction_id: 'text', ledger_error: 'text',
  }),

  // ── Read-only mirrors of shared_finance_ledger ───────────────────────────
  // Four small tables, so the D4 gate and every picker work standing in a
  // shop with no signal. Deliberately NOT the ledger's own 27-table stream:
  // Listly has no business holding Adam's loans and salary history.
  //
  // `linked_user_id` comes down with these columns, which is what lets the
  // owner picker put the signed-in user's own Current Account first. That is
  // ORDERING ONLY — Listly reads it and writes it never.
  ref('people', { ...H, name: 'text', color: 'text', linked_user_id: 'text', ...P }),
  ref('categories', { ...H, name: 'text', icon: 'text', icon_color: 'text', is_built_in: 'bool', ...P }),
  // `is_coin_jar` is synced so the location picker can EXCLUDE coin jars, the
  // same way the ledger's own ad-hoc entry does (`fundablePots()` in
  // roundUp.ts). A Coin Jar is a round-up destination, not somewhere a shop
  // is paid from. Listly must offer exactly what the ledger would.
  ref('pots', { ...H, person_id: 'text', name: 'text', active: 'bool', is_coin_jar: 'bool', ...P }),
  // 🚨 savings_pots is deliberately ABSENT, removed 2026-09-20 (Adam, Phase 4).
  // The location picker excludes savings pots by design (§8.2b — the ledger's
  // own ad-hoc entry excludes them, and Listly must produce exactly what the
  // ledger would), so syncing them was dead data. This is a change to what
  // Listly SUBSCRIBES to and nothing else: shared_finance_ledger.savings_pots
  // is untouched and the ledger keeps using it normally. Re-adding it means a
  // dashboard redeploy of the listly_ledger_ref stream, so do not do it
  // casually.
  // A household singleton. Its ABSENCE is the signal that matters: with no
  // joint account row, the picker omits "Joint account" entirely rather than
  // offering something that cannot be booked.
  // 🚩 `opening_balance_date`, NOT `opening_date`. Declared wrong in Phase 3
  // and caught on 2026-09-20 by check-app-schema.mjs the first time it was
  // pointed at Listly (MIGRATION-LESSONS §41). Nothing read it, so nothing
  // broke — a mirror column PowerSync never fills just reads back null, with
  // no error. That is the whole failure mode: two files inside one repo
  // agreeing with each other prove nothing about the third.
  ref('joint_account', { ...H, opening_balance: 'real', opening_balance_date: 'text' }),
  // 🚨 THE §38 GUARD'S DATA SOURCE, and the reason this table is here at all.
  //
  // The household can change under an open device — someone redeems a link
  // code, or deletes their data — and a stale device will then write into a
  // household it is no longer in. When that household still exists, RLS
  // ACCEPTS those writes and resurrects deleted data. The only defence is to
  // notice the membership change from synced data and stop writing before
  // resyncing, which is what the ledger does with sfl_household_members.
  //
  // PROMPT-01 §9.2 omits this table; that omission would have made the guard
  // unbuildable. Added 2026-09-20 after auditing the live stream config.
  ref('household_members', { ...H, user_id: 'text', joined_at: 'text' }),
]

/** The local SQLite table name for a Postgres table. */
export function localName(spec: SyncedTable): string {
  return (spec.writable ? OWN_PREFIX : REF_PREFIX) + spec.remote
}

export function specFor(localTable: string): SyncedTable {
  const spec = SYNCED_TABLES.find((t) => localName(t) === localTable)
  if (!spec) throw new Error(`[powersync] unknown local table: ${localTable}`)
  return spec
}

/** Strips the prefix for upload. Throws for a mirror: those are never sent. */
export function remoteName(localTable: string): string {
  const spec = specFor(localTable)
  if (!spec.writable) {
    throw new Error(
      `[powersync] refusing to upload ${localTable}: lst_ref_ tables are a read-only mirror of ` +
        `${LEDGER_SCHEMA}. Listly's only write into that schema is the transactions row, and that ` +
        `happens inside the database via a trigger.`,
    )
  }
  return spec.remote
}

export const OWN_TABLES = SYNCED_TABLES.filter((t) => t.writable)
export const REF_TABLES = SYNCED_TABLES.filter((t) => !t.writable)

/**
 * What the connector sends to Supabase for one row. SQLite holds booleans as
 * 1/0; Postgres is sent real booleans rather than relying on it coercing '1'.
 *
 * There is no jsonb handling here, unlike the ledger's version, because this
 * schema has no jsonb column — see the header.
 */
export function toServerRecord(
  localTable: string,
  data: Record<string, unknown>,
  opts: { dropNulls: boolean },
): Record<string, unknown> {
  const spec = specFor(localTable).columns
  const out: Record<string, unknown> = {}
  for (const [col, value] of Object.entries(data)) {
    if (opts.dropNulls && (value === null || value === undefined)) continue
    if (spec[col] === 'bool' && (value === 0 || value === 1)) out[col] = value === 1
    else out[col] = value
  }
  return out
}
