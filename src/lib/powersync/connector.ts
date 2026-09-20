import type { AbstractPowerSyncDatabase, CrudEntry, PowerSyncBackendConnector } from '@powersync/web'
import { UpdateType } from '@powersync/web'
import { supabase } from '../supabaseClient'
import { specFor, remoteName, toServerRecord } from './tables'

/**
 * PowerSync ↔ Supabase, mirroring the ledger's connector:
 *   - fetchCredentials(): the PowerSync URL + the Supabase session's JWT;
 *   - uploadData(): drains the local write queue one transaction at a time.
 *
 * Listly-specific, all deliberate:
 * - Local tables are `lst_<table>`; uploads go to `listly.<table>`, which is
 *   the client's default schema.
 * - 🚨 `lst_ref_*` tables are NEVER uploaded. They are a read-only mirror of
 *   `shared_finance_ledger`, and Listly's only write into that schema is the
 *   single transactions row, which happens inside the database via a trigger.
 *   Skipped here explicitly rather than relying on nothing ever writing them.
 * - A PUT (local INSERT) drops null columns before the upsert. A PUT only
 *   ever creates a row, so a null adds nothing on insert; but if the row
 *   already exists it would blank a column another device set.
 * - No jsonb handling, because this schema has no jsonb column (§33 designed
 *   out rather than worked around).
 * - A discarded write is logged LOUDLY and kept in a small local list the app
 *   can show, never silently dropped. The discard itself stays: a write
 *   Postgres permanently rejects would otherwise block every later write
 *   behind it forever.
 */

const POWERSYNC_URL: string = import.meta.env.VITE_POWERSYNC_URL ?? ''
if (!POWERSYNC_URL) {
  throw new Error('Missing VITE_POWERSYNC_URL. Put the Development instance URL in .env.local.')
}

// Not retried: bad data (22xxx), a constraint (23xxx: FK, CHECK, unique), or
// an RLS/privilege refusal (42501). Same list as the ledger, personal-f and
// PowerSync's reference Supabase connector. Everything else (network, 5xx,
// PGRST002) is thrown and retried.
export const FATAL_RESPONSE_CODES = [/^22...$/, /^23...$/, /^42501$/]

export const REJECTED_WRITES_KEY = 'listly:sync:rejected-writes'

export interface RejectedWrite {
  at: string
  table: string
  op: string
  id: string
  code: string
  message: string
}

function recordRejectedWrite(entry: RejectedWrite) {
  try {
    const list: RejectedWrite[] = JSON.parse(localStorage.getItem(REJECTED_WRITES_KEY) ?? '[]')
    list.unshift(entry)
    localStorage.setItem(REJECTED_WRITES_KEY, JSON.stringify(list.slice(0, 50)))
  } catch {
    // Storage full or unavailable: the console.error below is still there.
  }
}

export function readRejectedWrites(): RejectedWrite[] {
  try {
    return JSON.parse(localStorage.getItem(REJECTED_WRITES_KEY) ?? '[]')
  } catch {
    return []
  }
}

export class SupabaseConnector implements PowerSyncBackendConnector {
  /**
   * 🚨 If this returns null, or throws, PowerSync sends the request WITHOUT
   * a token and the service answers `401 PSYNC_S2106 Authentication
   * required` — which is what the instance logged on 2026-09-20 while the
   * app showed `connected=false connecting=false`. The 401 is the symptom;
   * the cause is always here. So it says what it did, every time, rather
   * than failing mutely.
   */
  async fetchCredentials() {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession()

    if (error) {
      console.error('[powersync] fetchCredentials: getSession failed —', error)
      throw new Error(`Could not fetch Supabase credentials: ${error.message}`)
    }
    if (!session) {
      console.error(
        '[powersync] fetchCredentials: NO SESSION. PowerSync will send an unauthenticated ' +
          'request and the service will answer 401 PSYNC_S2106.',
      )
      throw new Error('Could not fetch Supabase credentials: no session')
    }
    if (!session.access_token) {
      console.error('[powersync] fetchCredentials: session has no access_token', session)
      throw new Error('Could not fetch Supabase credentials: session has no access_token')
    }

    const expiresAt = session.expires_at ? new Date(session.expires_at * 1000) : undefined
    console.info(
      `[powersync] fetchCredentials: ok. endpoint=${POWERSYNC_URL} ` +
        `token=${session.access_token.length} chars, expires ${expiresAt?.toLocaleTimeString('en-GB') ?? 'unknown'}`,
    )
    return { endpoint: POWERSYNC_URL, token: session.access_token, expiresAt }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction()
    if (!transaction) return

    let lastOp: CrudEntry | null = null
    try {
      for (const op of transaction.crud) {
        lastOp = op

        // 🚨 The read-only mirror. Nothing in the app writes these, so
        // reaching here means a bug — say so loudly, but do not throw: a
        // throw would retry forever and block the whole queue behind it.
        if (!specFor(op.table).writable) {
          console.error(
            `[powersync] 🚨 skipped an upload of ${op.table} — lst_ref_ tables are a read-only ` +
              'mirror of shared_finance_ledger and must never be written by Listly. This is a bug.',
            op,
          )
          continue
        }

        const table = supabase.from(remoteName(op.table))
        let result
        switch (op.op) {
          case UpdateType.PUT:
            result = await table.upsert({
              ...toServerRecord(op.table, op.opData ?? {}, { dropNulls: true }),
              id: op.id,
            })
            break
          case UpdateType.PATCH:
            result = await table
              .update(toServerRecord(op.table, op.opData ?? {}, { dropNulls: false }))
              .eq('id', op.id)
            break
          case UpdateType.DELETE:
            result = await table.delete().eq('id', op.id)
            break
        }

        if (result?.error) {
          const code = result.error.code ?? ''
          if (FATAL_RESPONSE_CODES.some((pattern) => pattern.test(code))) {
            console.error(
              `[powersync] 🚨 DISCARDED a write the server rejected (${code}) — ${op.op} ${op.table} ${op.id}. ` +
                'This change is NOT on the server. See MIGRATION-LESSONS §27.',
              result.error,
              op.opData,
            )
            recordRejectedWrite({
              at: new Date().toISOString(),
              table: op.table,
              op: op.op,
              id: op.id,
              code,
              message: result.error.message,
            })
            continue
          }
          throw new Error(`Could not update Supabase (${op.table}): ${result.error.message}`)
        }
      }
      await transaction.complete()
    } catch (err) {
      console.warn('[powersync] Upload failed, will retry:', lastOp, err)
      throw err
    }
  }
}
