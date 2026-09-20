import { createClient } from '@supabase/supabase-js'

/**
 * One Supabase client, defaulting to the `listly` schema.
 *
 * 🚨 `listly` must be listed in Project Settings → API → Exposed schemas or
 * every call through this client fails with PGRST106 — while PowerSync sync
 * carries on looking perfectly healthy, because replication reads Postgres
 * directly and is completely unaffected by that setting. That is
 * MIGRATION-LESSONS §20, and it hid a broken schema for an entire build on
 * personal-f. Added for Listly on 2026-09-20; smoke-tested by
 * `assertListlySchemaReachable()` below rather than assumed.
 */
const URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!URL || !ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Write .env.local from the terminal, ' +
      'never Finder — Finder can silently drop the leading dot and Vite then ignores the file.',
  )
}

export const supabase = createClient(URL, ANON_KEY, { db: { schema: 'listly' } })

/**
 * The same project's `shared_finance_ledger` schema, for the household RPCs
 * and nothing else. Listly reads ledger tables through its `lst_ref_` sync
 * mirror, not through this — it has to work with no signal, standing in a
 * shop.
 */
export const sfl = () => supabase.schema('shared_finance_ledger')

/**
 * The §20 smoke test, run deliberately rather than discovered by accident
 * months later. A real signed-in call against the `listly` schema.
 *
 * Returns null when the schema is reachable, or a human-readable reason when
 * it is not. PGRST106 means `listly` is missing from Exposed schemas
 * (ADAM-TASKS-LISTLY task 1) — the one failure this cannot detect any other
 * way, because sync will look fine regardless.
 */
export async function assertListlySchemaReachable(): Promise<string | null> {
  const { error } = await supabase.from('shopping_lists').select('id').limit(1)
  if (!error) return null
  if (error.code === 'PGRST106') {
    return (
      'The `listly` schema is not exposed to the Data API. Add it in Project Settings → API → ' +
      'Exposed schemas (add it; never remove an existing entry). Sync will look healthy until ' +
      'this is fixed — see MIGRATION-LESSONS §20.'
    )
  }
  return `${error.code ?? 'error'}: ${error.message}`
}
