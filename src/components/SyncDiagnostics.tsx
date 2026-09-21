import { useEffect, useState } from 'react'
import { Sheet } from './Sheet'
import { supabase } from '../lib/supabaseClient'
import { powerSyncDb, LISTLY_STREAM, LISTLY_REF_STREAM } from '../lib/powersync/database'
import { readBootLog } from '../lib/powersync/bootLog'
import { describeSyncError } from '../lib/powersync/describeSyncError'
import { useSyncHealth } from '../lib/powersync/useSyncHealth'

/**
 * "Why isn't it syncing?", answered in plain English inside the app.
 *
 * 🚨 Why this exists. On 2026-09-20 sync failed and diagnosing it meant
 * reading PowerSync's instance logs and a browser console — which is a
 * reasonable ask of someone who wrote the sync layer and an unreasonable one
 * of anybody else. Adam said so plainly: "I don't know what I'm looking for."
 * He was right, and the fix is not better instructions, it is the app doing
 * the checks itself.
 *
 * Each check says what it means and what to do, in order, and stops at the
 * first real failure so there is exactly one thing to act on.
 *
 * 🚨 Rebuilt 2026-09-21 (Adam: "I see sync failed, but all steps are
 * passed … this should be suitable for users, but still useful for
 * troubleshooting"):
 *   - The answer at the top comes from lib/syncHealth.ts — the SAME rule as
 *     the header dot — unless one of the active checks below has failed, in
 *     which case that check's fix is the answer. The two can no longer
 *     disagree.
 *   - Everything else is under "Details for troubleshooting", closed by
 *     default: the checks, PowerSync's live state (including a stale error,
 *     labelled as such), and the startup steps. Still all there for a
 *     screenshot; not in the way of someone who only wants to know "is it
 *     OK?".
 *   - Nothing can push the sheet wider than the phone: long values wrap
 *     (.diag), and the sync server is shown by host, not full URL.
 */

type Check = {
  label: string
  state: 'pending' | 'ok' | 'fail' | 'skip'
  detail: string
}

const PS_URL: string = import.meta.env.VITE_POWERSYNC_URL ?? ''
const PS_HOST = (() => {
  try {
    return new URL(PS_URL).host
  } catch {
    return PS_URL
  }
})()

export function SyncDiagnostics({ onClose }: { onClose: () => void }) {
  const [checks, setChecks] = useState<Check[]>([])
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    const out: Check[] = []
    const push = (c: Check) => {
      out.push(c)
      if (!cancelled) setChecks([...out])
    }

    const run = async () => {
      // 1. Signed in?
      const { data, error } = await supabase.auth.getSession()
      const session = data?.session
      if (error || !session) {
        push({
          label: 'Signed in',
          state: 'fail',
          detail: error
            ? `Couldn't read your sign-in: ${error.message}`
            : 'The app does not have a sign-in session. Sign out and sign in again.',
        })
        if (!cancelled) setDone(true)
        return
      }
      push({ label: 'Signed in', state: 'ok', detail: session.user.email ?? 'signed in' })

      // 2. Is the token still valid, or has it quietly expired?
      const expires = session.expires_at ? new Date(session.expires_at * 1000) : null
      const expired = expires ? expires.getTime() < Date.now() : false
      push({
        label: 'Sign-in token',
        state: expired ? 'fail' : 'ok',
        detail: expired
          ? `Expired at ${expires?.toLocaleTimeString('en-GB')}. Sign out and sign in again.`
          : `Valid until ${expires?.toLocaleTimeString('en-GB') ?? 'unknown'}`,
      })

      // 3. Is the sync server reachable at all?
      if (!PS_URL) {
        push({
          label: 'Sync server address',
          state: 'fail',
          detail: 'VITE_POWERSYNC_URL is not set in .env.local.',
        })
        if (!cancelled) setDone(true)
        return
      }
      try {
        const res = await fetch(`${PS_URL}/probes/liveness`, { method: 'GET' })
        push({
          label: 'Sync server reachable',
          state: res.ok ? 'ok' : 'fail',
          detail: res.ok ? PS_HOST : `${PS_HOST} answered ${res.status}`,
        })
        if (!res.ok) {
          if (!cancelled) setDone(true)
          return
        }
      } catch (e) {
        push({
          label: 'Sync server reachable',
          state: 'fail',
          detail:
            `Could not reach ${PS_HOST} from this browser (${e instanceof Error ? e.message : String(e)}). ` +
            'If the address is right, something between this browser and the server is blocking it.',
        })
        if (!cancelled) setDone(true)
        return
      }

      // 4. THE ONE THAT MATTERS: does the sync server accept this token?
      // A 401 here is the `PSYNC_S2106 Authentication required` the instance
      // logs, and it means the token was missing or rejected.
      try {
        const controller = new AbortController()
        const res = await fetch(`${PS_URL}/sync/stream`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ streams: { include_defaults: false, subscriptions: [] } }),
          signal: controller.signal,
        })
        // Do not actually consume the stream; we only wanted the status.
        controller.abort()
        if (res.status === 401) {
          push({
            label: 'Sync server accepts your sign-in',
            state: 'fail',
            detail:
              'The server refused the token (401). That is a PowerSync setting, not an app bug: ' +
              'in the PowerSync dashboard, the instance’s Client Auth must have "Use Supabase Auth" ' +
              'enabled and be pointed at this Supabase project.',
          })
        } else {
          push({
            label: 'Sync server accepts your sign-in',
            state: 'ok',
            detail: `Accepted (HTTP ${res.status}).`,
          })
        }
      } catch (e) {
        // An aborted fetch is the expected path once we have the status.
        const msg = e instanceof Error ? e.message : String(e)
        push({
          label: 'Sync server accepts your sign-in',
          state: msg.toLowerCase().includes('abort') ? 'ok' : 'fail',
          detail: msg.toLowerCase().includes('abort')
            ? 'Accepted (the connection opened).'
            : `The request failed: ${msg}`,
        })
      }

      // 5. Is it actually connected? PowerSync's own live state — including
      // any error — is shown separately below, from the same source as the
      // header dot, rather than re-judged here.
      const st = powerSyncDb.currentStatus
      push({
        label: 'Connected to the sync service',
        // Not a failure on its own: offline is a normal state for an app
        // built for a shop with no signal. syncHealth() judges it.
        state: st?.connected ? 'ok' : 'skip',
        detail: st?.connected
          ? 'Yes.'
          : st?.downloadError
            ? describeSyncError(st.downloadError)
            : 'Not right now. If you have signal, close Listly fully and reopen it.',
      })

      if (!cancelled) setDone(true)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const firstFail = checks.find((c) => c.state === 'fail')
  const boot = readBootLog()
  const { facts, health } = useSyncHealth()
  const err = facts.downloadError ?? facts.uploadError
  // An upload error with nothing waiting is history (lib/syncHealth.ts).
  const stale = !facts.downloadError && !!facts.uploadError && (facts.waiting ?? 0) === 0

  // A failed check is the answer — unless the phone is simply offline, when
  // "could not reach the server" is the expected consequence, not a fault.
  const verdict =
    firstFail && health.tone !== 'offline'
      ? { tone: 'problem', headline: 'Something needs fixing', detail: firstFail.detail }
      : health
  const border =
    verdict.tone === 'problem' ? 'var(--red)' : verdict.tone === 'ok' ? 'var(--sage)' : 'var(--line-2)'
  const dot = (state: string) =>
    state === 'ok' ? 'var(--sage)' : state === 'fail' ? 'var(--red)' : 'var(--line-2)'

  return (
    <Sheet label="Sync check" onClose={onClose}>
      <div className="diag">
        <h2>Sync check</h2>

        {/* The answer goes FIRST, in plain words. On 2026-09-20 it was at
            the bottom and Adam could not see it. */}
        <div className="card diag-verdict" style={{ borderColor: border }}>
          <div className="lbl">{done || firstFail ? verdict.headline : 'Checking…'}</div>
          <p className="help">{done || firstFail ? verdict.detail : 'This takes a few seconds.'}</p>
        </div>

        <details className="diag-details">
          <summary>Details for troubleshooting</summary>
          <p className="help">
            If someone is helping you with sync, screenshot everything below and send it to them.
          </p>

          <div className="lbl">Checks</div>
          {checks.map((c) => (
            <div className="mrow" key={c.label}>
              <span className="diag-dot" style={{ background: dot(c.state) }} />
              <div className="grow">
                <div className="nm">{c.label}</div>
                <div className="st">{c.detail}</div>
              </div>
            </div>
          ))}
          {!done && <p className="help">Checking…</p>}

          <div className="lbl">Right now</div>
          <div className="mrow">
            <span className="diag-dot" style={{ background: facts.connected ? 'var(--sage)' : 'var(--line-2)' }} />
            <div className="grow">
              <div className="nm">{facts.connected ? 'Connected' : facts.connecting ? 'Connecting' : 'Not connected'}</div>
              <div className="st">
                Last synced {facts.lastSyncedAt?.toLocaleTimeString('en-GB') ?? 'not yet on this device'}
              </div>
            </div>
          </div>
          <div className="mrow">
            <span
              className="diag-dot"
              style={{ background: (facts.waiting ?? 0) === 0 ? 'var(--sage)' : 'var(--brown-2)' }}
            />
            <div className="grow">
              <div className="nm">Changes waiting to send</div>
              <div className="st">{facts.waiting ?? '…'}</div>
            </div>
          </div>
          {err !== undefined && err !== null && (
            <div className="mrow">
              <span className="diag-dot" style={{ background: stale ? 'var(--line-2)' : 'var(--red)' }} />
              <div className="grow">
                <div className="nm">{stale ? 'Earlier sync hiccup' : 'Sync error'}</div>
                <div className="st">
                  {describeSyncError(err)}
                  {stale && ' Nothing is waiting to send, so this is not affecting anything.'}
                </div>
              </div>
            </div>
          )}
          <div className="mrow">
            <span className="diag-dot" style={{ background: 'var(--line-2)' }} />
            <div className="grow">
              <div className="nm">Sync streams</div>
              <div className="st">
                {LISTLY_STREAM}, {LISTLY_REF_STREAM} — both must be deployed under Sync Streams in the
                PowerSync dashboard.
              </div>
            </div>
          </div>

          {/* What the boot sequence actually did. PowerSync's own status only
              describes the CONNECTION — it cannot say that connect() was never
              reached, which is exactly the gap that made "Not connected. No
              error reported." undiagnosable. */}
          <div className="lbl">Startup steps</div>
          {boot.length === 0 && (
            <p className="help">Nothing recorded — the sync startup never ran. Close Listly fully and reopen it.</p>
          )}
          {boot.map((b, i) => (
            <div className="mrow" key={i}>
              <span className="diag-dot" style={{ background: dot(b.level) }} />
              <div className="grow">
                <div className="st">
                  {b.at} · {b.step}
                </div>
                {b.detail && <div className="st">{b.detail}</div>}
              </div>
            </div>
          ))}
        </details>

        <div className="actions">
          <div style={{ flex: 1 }} />
          <button className="btn sage" onClick={onClose}>Close</button>
        </div>
      </div>
    </Sheet>
  )
}
