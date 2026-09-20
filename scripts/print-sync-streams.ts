// Prints Listly's two Sync Streams blocks for the PowerSync dashboard
// (ADAM-TASKS-LISTLY task 2), generated from src/lib/powersync/tables.ts so
// every alias is exactly a local table name.
//
//   npx tsx scripts/print-sync-streams.ts
//   npx tsx scripts/print-sync-streams.ts --columns   (JSON, for the schema check)
//
// ADD the output under the existing `streams:` key in the dashboard, below
// personal-f's `household_data` and the ledger's `shared_ledger_household`.
// Never edit either of those, or `config:`, or `edition: 3`.
//
// 🚨 There is no YAML file in any repo. PowerSync Cloud stores the config
// server-side and it is edited in the dashboard; only self-hosted PowerSync
// keeps a sync-config.yaml on disk. Run this, paste the output.
//
// Why each line looks like this:
// - `AS lst_<table>` / `AS lst_ref_<table>`: the alias names the LOCAL table
//   ("the alias maps the table to the new client-side name"). Deliberate, so
//   Listly's rows never share a local table with personal-f's bare names or
//   the ledger's sfl_ ones. §7 is the accidental version of this; here the
//   alias is generated from the same list the app reads.
// - `household_id IN (SELECT household_id FROM shared_finance_ledger.household_members
//   WHERE user_id = auth.user_id())`: the same rule as every table's RLS, so
//   a partner syncs exactly the rows they can write. Every household table
//   carries household_id, so no line joins through a parent.
// - my_jobs: per user, matching its RLS and its column default.
// - auto_subscribe: false (also the default). Listly subscribes explicitly
//   and connects with includeDefaultStreams: false, so personal-f's
//   auto-subscribed stream never lands here and no other app downloads
//   Listly's data.

import { SYNCED_TABLES, OWN_TABLES, REF_TABLES, localName, LEDGER_SCHEMA } from '../src/lib/powersync/tables'

export const OWN_STREAM = 'listly_household'
export const REF_STREAM = 'listly_ledger_ref'

const MY_HOUSEHOLDS = `SELECT household_id FROM ${LEDGER_SCHEMA}.household_members WHERE user_id = auth.user_id()`

function queryFor(spec: (typeof SYNCED_TABLES)[number]): string {
  const from = `SELECT * FROM ${spec.schema}.${spec.remote} AS ${localName(spec)}`
  if (!spec.household) return `${from} WHERE user_id = auth.user_id()`
  return `${from} WHERE household_id IN (${MY_HOUSEHOLDS})`
}

function block(name: string, tables: typeof SYNCED_TABLES): string {
  return [
    `  ${name}:`,
    '    auto_subscribe: false',
    '    queries:',
    ...tables.map((t) => `      - ${queryFor(t)}`),
  ].join('\n')
}

if (process.argv.includes('--columns')) {
  // What tables.ts believes it syncs, for the schema check that compares it
  // against what the migrations actually create (MIGRATION-LESSONS §34: a
  // column the app writes that Postgres does not have is not a discard —
  // an unknown-column error is not fatal to the connector, so it retries
  // forever and blocks that device's whole upload queue).
  //
  // Keyed '<schema>.<table>', because Listly's list spans TWO schemas —
  // unlike the ledger's, which is all one. The checker needs to know which
  // schema to look each table up in.
  const out: Record<string, string[]> = {}
  for (const spec of SYNCED_TABLES) out[`${spec.schema}.${spec.remote}`] = Object.keys(spec.columns)
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log(block(OWN_STREAM, OWN_TABLES))
  console.log(block(REF_STREAM, REF_TABLES))
}
