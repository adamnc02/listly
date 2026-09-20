import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { powerSyncDb, powerSyncConnector, LISTLY_STREAM, LISTLY_REF_STREAM } from '../lib/powersync/database'
import { getHouseholdId, refreshHouseholdId } from '../lib/powersync/household'
import { assertListlySchemaReachable } from '../lib/supabaseClient'

/**
 * Boots sync, and holds the household guard.
 *
 * Sequence, in order and for reasons:
 *   1. ensure_household() — Listly reuses the ledger's household (D6), so
 *      this is what makes the shared link code work with nothing to set up.
 *   2. The §20 smoke test. A real signed-in call against the `listly` schema,
 *      run DELIBERATELY. PGRST106 ("schema not exposed") is invisible
 *      otherwise: PowerSync replicates Postgres directly, so sync looks
 *      perfectly healthy while every REST call fails. On personal-f that hid
 *      a broken schema for an entire build.
 *   3. connect(), with includeDefaultStreams: false — personal-f's
 *      `household_data` stream is auto_subscribe: true and would otherwise
 *      land in Listly.
 *   4. Subscribe to Listly's two streams explicitly.
 *   5. Start the §38 household guard.
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

    const boot = async () => {
      try {
        // 1. The household, from the ledger's own function.
        const hh = await getHouseholdId(userId)
        if (cancelled) return
        setHouseholdId(hh)

        // 2. The §20 smoke test, before anything depends on REST working.
        const reachErr = await assertListlySchemaReachable()
        if (cancelled) return
        if (reachErr) {
          setStatus({ kind: 'error', message: reachErr })
          return
        }

        // 3 & 4. Connect, then subscribe explicitly.
        await powerSyncDb.connect(powerSyncConnector, { includeDefaultStreams: false })
        if (cancelled) return
        await powerSyncDb.syncStream(LISTLY_STREAM).subscribe()
        await powerSyncDb.syncStream(LISTLY_REF_STREAM).subscribe()
        if (cancelled) return

        setStatus({ kind: 'ready' })

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
      } catch (e) {
        if (cancelled) return
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
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

  return <HouseholdContext.Provider value={householdId}>{children}</HouseholdContext.Provider>
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
