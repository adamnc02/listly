import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { powerSyncDb, powerSyncConnector, LISTLY_STREAM, LISTLY_REF_STREAM } from '../lib/powersync/database'
import { getHouseholdId, refreshHouseholdId } from '../lib/powersync/household'
import { assertListlySchemaReachable } from '../lib/supabaseClient'
import { recordBootStep, clearBootLog } from '../lib/powersync/bootLog'
import { describeSyncError } from '../lib/powersync/describeSyncError'

/**
 * Boots sync, and holds the household guard.
 *
 * 🚨 THE UI IS NEVER BLOCKED ON THE NETWORK. This is an offline-first app —
 * the whole point is that it works standing in a shop with no signal — so
 * waiting for connect() before rendering anything was backwards. It also hid
 * a real failure: on 2026-09-20 the first live run sat on "Getting your
 * lists…" indefinitely, because a step that never resolves and never throws
 * has no way to report itself.
 *
 * So only the two steps that genuinely cannot be done offline are awaited,
 * each with a timeout, and everything else happens behind the rendered app:
 *
 *   BLOCKING (with a 20s timeout, then a readable error):
 *     1. ensure_household() — Listly reuses the ledger's household (D6), and
 *        every write needs its id. Cached per session afterwards.
 *     2. The §20 smoke test: a real signed-in call against the `listly`
 *        schema. PGRST106 ("schema not exposed") is invisible otherwise —
 *        PowerSync replicates Postgres directly, so sync looks perfectly
 *        healthy while every REST call fails. That hid a broken schema for an
 *        entire build on personal-f.
 *
 *   BACKGROUND (the app is already usable):
 *     3. connect(), with includeDefaultStreams: false — personal-f's
 *        `household_data` stream is auto_subscribe: true and would otherwise
 *        land in Listly.
 *     4. Subscribe to Listly's two streams.
 *     5. The §38 household guard.
 *
 * `syncError` surfaces a background failure in the UI instead of leaving the
 * app looking fine but never syncing.
 */

type Status =
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
  | { kind: 'suspended'; message: string }

export function SyncRoot({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  const [status, setStatus] = useState<Status>({ kind: 'starting' })
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  /**
   * 🚨 THE §38 GUARD.
   *
   * The household can change under an open device: a partner redeems a link
   * code, or someone runs "Delete my app data". A device that has been open
   * throughout still holds the OLD household id, and on reconnect it will
   * happily write rows stamped with it.
   *
   * When the old household is gone, RLS refuses those writes and the
   * connector discards them — messy but contained. The dangerous case is the
   * one where the old household still EXISTS (a partner remained, or a
   * redeem moved you): RLS then ACCEPTS the writes and **brings deleted data
   * back**. That is the live incident MIGRATION-LESSONS §38 records.
   *
   * So membership is read from SYNCED data on every delivery, and the moment
   * the user is missing from the session's household — or turns up in a
   * different one — this component suspends: children are unmounted, so
   * nothing can write, and the only way forward is a reload that re-runs
   * ensure_household() from scratch.
   *
   * A brand-new household whose membership row has not synced yet is NOT
   * treated as lost: `seen` only latches once the row has actually arrived.
   */
  const seenMembership = useRef(false)

  const checkMembership = useCallback(
    async (expected: string, uid: string) => {
      const rows = await powerSyncDb.getAll<{ household_id: string }>(
        'SELECT household_id FROM lst_ref_household_members WHERE user_id = ?',
        [uid],
      )
      if (rows.length === 0) {
        // Either it has not arrived yet (fine, first boot) or it is gone.
        if (seenMembership.current) {
          setStatus({
            kind: 'suspended',
            message:
              'Your household changed on another device, so Listly has stopped syncing to avoid ' +
              'writing into a household you are no longer in. Reload to carry on.',
          })
        }
        return
      }
      seenMembership.current = true
      if (rows[0].household_id !== expected) {
        setStatus({
          kind: 'suspended',
          message:
            'You have been moved into a different household on another device. Listly has stopped ' +
            'syncing so it cannot write into the old one. Reload to carry on.',
        })
      }
    },
    [],
  )

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    let unsubscribeWatch: (() => void) | null = null

    /** Never let one unresolved promise hang the whole app silently. */
    const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s.`)), ms),
        ),
      ])

    const boot = async () => {
      clearBootLog()
      recordBootStep('boot started', 'ok', `user ${userId.slice(0, 8)}…`)
      let hh: string
      try {
        // 1. The household, from the ledger's own function.
        hh = await withTimeout(getHouseholdId(userId), 20000, 'Setting up your household')
        if (cancelled) { recordBootStep('restarted (dev only)', 'note', 'React StrictMode re-runs effects in dev; harmless, and absent in a production build'); return }
        recordBootStep('ensure_household', 'ok', `household ${hh.slice(0, 8)}…`)
        setHouseholdId(hh)

        // 2. The §20 smoke test, before anything depends on REST working.
        const reachErr = await withTimeout(
          assertListlySchemaReachable(),
          20000,
          'Checking the Listly schema',
        )
        if (cancelled) { recordBootStep('restarted (dev only)', 'note', 'React StrictMode re-runs effects in dev; harmless, and absent in a production build'); return }
        if (reachErr) {
          recordBootStep('listly schema reachable', 'fail', reachErr)
          setStatus({ kind: 'error', message: reachErr })
          return
        }
        recordBootStep('listly schema reachable', 'ok')
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        recordBootStep('blocking startup', 'fail', msg)
        setStatus({ kind: 'error', message: describeSyncError(e) })
        return
      }

      // The app is usable from here. Everything below is background.
      setStatus({ kind: 'ready' })

      try {
        // 3 & 4. SUBSCRIBE FIRST, THEN CONNECT.
        //
        // 🚨 This order is not cosmetic, and getting it wrong cost an
        // evening. `connect()` with `includeDefaultStreams: false` and NO
        // subscriptions gives PowerSync nothing to sync, so the connection
        // never completes — and `await connect()` then never resolves. It
        // does not throw, it does not time out, and SyncStatus reports
        // "not connected, no error", because from its point of view nothing
        // was ever asked for. The startup log showed `connect() called` with
        // no matching `connect() returned`, which is what finally located it.
        //
        // PROMPT-01 §9.3 shows connect-then-subscribe; that ordering is
        // wrong for a client with no auto-subscribed streams.
        await powerSyncDb.syncStream(LISTLY_STREAM).subscribe()
        recordBootStep(`subscribed to ${LISTLY_STREAM}`, 'ok')
        await powerSyncDb.syncStream(LISTLY_REF_STREAM).subscribe()
        recordBootStep(`subscribed to ${LISTLY_REF_STREAM}`, 'ok')
        if (cancelled) return

        // Belt and braces: never await this indefinitely again. If it has
        // not settled in 30s something is wrong, and a visible message beats
        // a spinner that lasts forever.
        recordBootStep('connect() called', 'ok', 'includeDefaultStreams: false')
        await withTimeout(
          powerSyncDb.connect(powerSyncConnector, { includeDefaultStreams: false }),
          30000,
          'Connecting to the sync service',
        )
        if (cancelled) { recordBootStep('restarted (dev only)', 'note', 'React StrictMode re-runs effects in dev; harmless, and absent in a production build'); return }
        recordBootStep('connect() returned', 'ok')
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        recordBootStep('connect / subscribe', 'fail', msg)
        console.error('[powersync] could not connect or subscribe:', e)
        setSyncError(describeSyncError(e))
        return
      }

      try {
        // 5. The guard, re-evaluated on every delivery that touches
        // membership. `query(...).watch()` is the current API; `db.watch()`'s
        // AsyncIterator/callback forms are kept only for backwards
        // compatibility.
        await checkMembership(hh, userId)
        const watched = powerSyncDb
          .query<{ household_id: string }>({
            sql: 'SELECT household_id FROM lst_ref_household_members WHERE user_id = ?',
            parameters: [userId],
          })
          .watch()
        const off = watched.registerListener({
          onData: () => {
            void checkMembership(hh, userId)
          },
        })
        unsubscribeWatch = () => {
          off()
          void watched.close()
        }
        recordBootStep('household guard started', 'ok')
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        recordBootStep('household guard', 'fail', msg)
        console.error('[powersync] household guard failed to start:', e)
        setSyncError(describeSyncError(e))
      }
    }

    void boot()
    return () => {
      cancelled = true
      unsubscribeWatch?.()
    }
  }, [userId, checkMembership])

  // Disconnect when the user signs out, so the next account on this device
  // never inherits the previous one's connection.
  //
  // oxlint's set-state-in-effect rule is correct in general and wrong here:
  // this IS synchronising with an external system (the PowerSync
  // connection), and the state reset has to happen with it, not during a
  // render.
  // (oxlint flags set-state-in-effect here. It is correct in general and
  // wrong in this case: this IS synchronising with an external system — the
  // PowerSync connection — and the reset has to happen with it.)
  useEffect(() => {
    if (userId) return
    seenMembership.current = false
    setStatus({ kind: 'starting' })
    setHouseholdId(null)
    setSyncError(null)
    void powerSyncDb.disconnect().catch(() => {})
  }, [userId])

  if (status.kind === 'starting') {
    return <Splash>Getting your lists…</Splash>
  }

  if (status.kind === 'error') {
    return (
      <Splash tone="error">
        <div style={{ fontSize: 24, marginBottom: 10 }}>Listly couldn’t start</div>
        <div className="help" style={{ marginBottom: 16 }}>{status.message}</div>
        <button className="btn brown" onClick={() => window.location.reload()}>Try again</button>
      </Splash>
    )
  }

  if (status.kind === 'suspended') {
    return (
      <Splash tone="error">
        <div style={{ fontSize: 24, marginBottom: 10 }}>Household changed</div>
        <div className="help" style={{ marginBottom: 16 }}>{status.message}</div>
        <div className="actions" style={{ justifyContent: 'center' }}>
          <button className="btn brown" onClick={() => window.location.reload()}>Reload</button>
          <button
            className="btn ghost"
            onClick={() => {
              void refreshHouseholdId(userId ?? '').finally(() => window.location.reload())
            }}
          >
            Sign in again
          </button>
        </div>
      </Splash>
    )
  }

  return (
    <HouseholdContext.Provider value={householdId}>
      {children}
      {/* A background sync failure is SHOWN, not swallowed — an app that
          looks fine but never syncs is the failure mode this workstream
          keeps paying for. Fixed rather than in the flow, so it cannot
          disturb the app shell's own layout. */}
      {syncError && (
        <div className="sync-error" role="alert">
          <b>Not syncing.</b> {syncError}
        </div>
      )}
    </HouseholdContext.Provider>
  )
}

function Splash({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <div className="app">
      <main>
        <div
          className="empty"
          style={{ paddingTop: 80, color: tone === 'error' ? 'var(--red)' : 'var(--muted)' }}
        >
          {children}
        </div>
      </main>
    </div>
  )
}

const HouseholdContext = createContext<string | null>(null)

/** The household every write must be stamped with. Null only before boot. */
// eslint-disable-next-line react-refresh/only-export-components
export function useHouseholdId(): string {
  const id = useContext(HouseholdContext)
  if (!id) throw new Error('useHouseholdId used before sync finished starting')
  return id
}
