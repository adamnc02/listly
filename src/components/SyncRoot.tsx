import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { powerSyncDb, powerSyncConnector, LISTLY_STREAM, LISTLY_REF_STREAM } from '../lib/powersync/database'
import { getHouseholdId, refreshHouseholdId } from '../lib/powersync/household'
import { assertListlySchemaReachable } from '../lib/supabaseClient'
import { recordBootStep, clearBootLog, readBootLog, keepBootLogForNextStart } from '../lib/powersync/bootLog'
import { describeSyncError } from '../lib/powersync/describeSyncError'
import { accountSwitch } from '../lib/accountSwitch'
import { clearRoundUpCache } from '../lib/roundUpCache'

/**
 * Boots sync, and holds the household guard.
 *
 * 🚨 THE UI IS NEVER BLOCKED ON THE NETWORK — EXCEPT ON A DEVICE THAT HAS
 * NEVER SYNCED. This is an offline-first app; the whole point is that it
 * works standing in a shop with no signal, so waiting for connect() on every
 * launch was backwards. It also hid a real failure: on 2026-09-20 the first
 * live run sat on "Getting your lists…" indefinitely, because a step that
 * never resolves and never throws has no way to report itself.
 *
 * 🚩 BUT THAT WENT TOO FAR, and Adam found it on the deployed build the same
 * evening: signing in on a device with no local data rendered an EMPTY app
 * with an "Offline" badge, and only showed his lists after he force-quit and
 * relaunched. Nothing was broken — the download was simply still in flight,
 * and the app had already said it was done.
 *
 * An empty app is indistinguishable from three different things: a genuinely
 * empty household, a download still running, and sync being broken. On the
 * FIRST sync for a given user on a given device there is no local data to
 * fall back on, so there is nothing to be offline-first ABOUT — waiting is
 * the honest answer, and it is what `shared-finance-ledger` has always done
 * (`sub.waitForFirstSync()` before it renders).
 *
 * So: a device that has synced before renders immediately, as it did. A
 * device that has not waits, says "Getting your lists…", and still gives up
 * gracefully rather than trapping anyone.
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
  /** First sync on this device: downloading, and SAYING so. See §First sync. */
  | { kind: 'first-sync' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
  | { kind: 'suspended'; message: string }

/**
 * 🚨 "Has THIS device finished a first sync for THIS user?"
 *
 * Per user, because a second account signing in on the same device has its
 * own empty local data and must wait for its own first download. Per device,
 * because that is what the question is about — localStorage is the right
 * place for it and it is not household data.
 */
const firstSyncKey = (userId: string) => `listly:first-sync:${userId}`

/**
 * The handle `syncStream(...).subscribe()` returns. The SDK does not export
 * the type from `@powersync/web`, so it is inferred from the method rather
 * than hand-written — which also means it cannot drift from the SDK.
 */
type StreamSub = Awaited<ReturnType<ReturnType<typeof powerSyncDb.syncStream>['subscribe']>>

function hasSyncedBefore(userId: string): boolean {
  try {
    return localStorage.getItem(firstSyncKey(userId)) !== null
  } catch {
    // Private mode, or storage blocked. Treat as "never synced": waiting once
    // more is harmless, and rendering an empty app is not.
    return false
  }
}

function forgetSynced(userId: string) {
  try {
    localStorage.removeItem(firstSyncKey(userId))
  } catch {
    /* ignore */
  }
}

/**
 * 🚨 WHO THIS DEVICE'S LOCAL DATABASE BELONGS TO.
 *
 * Adam, 2026-09-21: "When switching account, the old list remains, it takes
 * several force closes to change". Signing out never cleared PowerSync's
 * on-device database — so the next account to sign in on the phone was shown
 * the previous one's lists, and its PRIVATE My jobs, until enough relaunches
 * let the new account's sync overwrite them.
 *
 * Ported from shared-finance-ledger's SyncRoot, proven in production on this
 * same PowerSync instance: remember the last user, and when a DIFFERENT one
 * signs in, `disconnectAndClear()` before connecting. The same user signing
 * back in keeps their data — including anything not yet uploaded, which then
 * sends. The account sheet warns before a sign-out would strand unsent
 * changes (a different account signing in here would clear them).
 */
const LAST_USER_KEY = 'listly:last-user'

function lastUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY)
  } catch {
    // Unknown is treated as "someone else": clearing is safe, showing
    // another person's data is not.
    return null
  }
}

function rememberUser(userId: string) {
  try {
    localStorage.setItem(LAST_USER_KEY, userId)
  } catch {
    /* ignore — the only cost is clearing again next time */
  }
}

function markSynced(userId: string) {
  try {
    localStorage.setItem(firstSyncKey(userId), new Date().toISOString())
  } catch {
    /* ignore — the only cost is waiting again next launch */
  }
}

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
    let unsubscribeStreams: (() => void) | null = null

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

        // 🚨 A different account from the last one on this device: clear the
        // local database BEFORE anything reads it. See LAST_USER_KEY.
        const previousUser = lastUser()
        const waiting = (await powerSyncDb.getUploadQueueStats().catch(() => ({ count: 0 }))).count
        const action = accountSwitch(previousUser, userId, waiting)
        if (action === 'adopt') {
          // The first launch after this check shipped: nobody is recorded
          // yet. Clearing now would throw away changes still waiting to
          // upload, so this one time it keeps them and records the user.
          rememberUser(userId)
          recordBootStep('first run of the account check', 'note', `${waiting} unsent change(s) kept`)
        } else if (action === 'clear') {
          await withTimeout(powerSyncDb.disconnectAndClear(), 20000, 'Clearing the previous account')
          forgetSynced(userId)
          // 🚨 PROMPT-05. The previous account's remembered "rounding is on,
          // into pot X" must go with its data. A new account has no business
          // inheriting a round-up answer for a household it may not be in,
          // and the safe state for an unknown person is simply off.
          clearRoundUpCache()
          rememberUser(userId)
          recordBootStep('new account on this device', 'ok', 'previous account’s local data cleared')
        } else {
          recordBootStep('same account as last time', 'ok', 'keeping local data')
        }
        if (cancelled) return
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        recordBootStep('blocking startup', 'fail', msg)
        setStatus({ kind: 'error', message: describeSyncError(e) })
        return
      }

      // 🚨 A device that has synced before has local data to show, so it
      // renders NOW and syncs behind the app. A device that has not would
      // render an empty app that looks finished, so it waits below instead.
      const firstRun = !hasSyncedBefore(userId)
      recordBootStep('first sync on this device?', 'note', firstRun ? 'yes — will wait' : 'no — rendering now')
      if (!firstRun) setStatus({ kind: 'ready' })
      else setStatus({ kind: 'first-sync' })

      let ownSub: StreamSub | null = null
      let refSub: StreamSub | null = null

      try {
        // 3 & 4. SUBSCRIBE, THEN CONNECT.
        //
        // This order was adopted on 2026-09-20 after `await connect()` hung
        // forever with nothing subscribed — no throw, no timeout, and
        // SyncStatus reporting "not connected, no error". The startup log
        // showed `connect() called` with no matching `connect() returned`,
        // which is what located it.
        //
        // 🚩 Honest caveat, added 2026-09-20 after checking rather than
        // assuming: `shared-finance-ledger` does the OPPOSITE — connect,
        // then subscribe, then `waitForFirstSync()` — and it works in
        // production against this same instance. So connect-first is not
        // inherently broken, and whatever caused that hang was probably not
        // the ordering alone. Reading the SDK, `subscribe()` persists the
        // subscription into the local core and `connectInternal()` passes
        // `this.activeStreams` into the sync implementation, so BOTH orders
        // are supported by design.
        //
        // This order is kept because it is the one Listly has been proven
        // on. Do not "fix" it to match the ledger without a reason and a
        // test — but do not repeat the old claim that the other order
        // cannot work either, because it demonstrably does.
        //
        // The handles are KEPT, for two reasons: waitForFirstSync() below is
        // on them, and the SDK logs a "subscription leaked!" warning through
        // a FinalizationRegistry if they are dropped without unsubscribe().
        ownSub = await powerSyncDb.syncStream(LISTLY_STREAM).subscribe()
        recordBootStep(`subscribed to ${LISTLY_STREAM}`, 'ok')
        refSub = await powerSyncDb.syncStream(LISTLY_REF_STREAM).subscribe()
        recordBootStep(`subscribed to ${LISTLY_REF_STREAM}`, 'ok')
        unsubscribeStreams = () => {
          ownSub?.unsubscribe()
          refSub?.unsubscribe()
        }
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
        // 🚨 Render anyway. A first run that cannot connect must still get
        // a usable app and a visible reason — never a permanent spinner.
        setStatus({ kind: 'ready' })
        return
      }

      // ── First sync ─────────────────────────────────────────────────────
      // Only ever on a device with no local data for this user. Both streams,
      // because the lists come down one and the ledger reference data the
      // other, and an app with lists but no categories is still half-built.
      if (firstRun) {
        try {
          await withTimeout(
            Promise.all([ownSub!.waitForFirstSync(), refSub!.waitForFirstSync()]),
            30000,
            'Downloading your lists',
          )
          if (cancelled) return
          markSynced(userId)
          recordBootStep('first sync complete', 'ok')
        } catch (e) {
          if (cancelled) return
          const msg = e instanceof Error ? e.message : String(e)
          recordBootStep('first sync', 'fail', msg)
          // 🚨 Never trap anyone behind a spinner. Listly syncs five small
          // tables and a five-table mirror, so thirty seconds is already far
          // longer than this can honestly take; past that, show the app and
          // say plainly that it is still catching up. Deliberately NOT
          // marked as synced, so the next launch waits properly.
          setSyncError(
            'Your lists are still downloading. The app is usable, but it may look empty until ' +
              'that finishes — check the sync dot in the header.',
          )
        }
        setStatus({ kind: 'ready' })
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
      unsubscribeStreams?.()
      // 🚨 Signing out UNMOUNTS this component (the gate swaps it for the
      // sign-in screen), so the `!userId` effect below never ran and the old
      // connection stayed open under the next sign-in. Disconnect here, the
      // way the ledger does.
      void powerSyncDb.disconnect().catch(() => {})
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

  if (status.kind === 'starting' || status.kind === 'first-sync') {
    return (
      <Splash>
        <div>Getting your lists…</div>
        {status.kind === 'first-sync' && (
          <div className="help" style={{ marginTop: 10 }}>
            First time on this device, so everything is downloading. It only happens once.
          </div>
        )}
        <StillWaiting />
      </Splash>
    )
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

/**
 * 🚨 A loading screen is never a dead end (Adam, 2026-09-21: it "seems to
 * stall, and only force closing the app actually allows the lists to load").
 * After 8 seconds it says which startup step it is waiting on — the same boot
 * log the Sync check shows — and offers Try again, which reloads: exactly what
 * a force-close did, without leaving the app. The step it stalled on is kept
 * for the Sync check after the reload (bootLog's `previous` record).
 */
function StillWaiting() {
  const [late, setLate] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), 8000)
    const i = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(i)
    }
  }, [])
  if (!late) return null
  const steps = readBootLog()
  const last = steps[steps.length - 1]
  return (
    <div style={{ marginTop: 18 }}>
      <div className="help">
        This is taking longer than it should.
        {last ? ` Waiting after: ${last.step}.` : ' Startup has not begun.'}
      </div>
      <button
        className="btn brown"
        style={{ marginTop: 12 }}
        onClick={() => {
          keepBootLogForNextStart('stalled on the loading screen')
          window.location.reload()
        }}
      >
        Try again
      </button>
    </div>
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
