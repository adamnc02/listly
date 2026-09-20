import { useEffect, useState } from 'react'
import { Sheet } from './Sheet'
import { supabase } from '../lib/supabaseClient'
import { powerSyncDb, LISTLY_STREAM, LISTLY_REF_STREAM } from '../lib/powersync/database'
import { readBootLog } from '../lib/powersync/bootLog'
import { describeSyncError } from '../lib/powersync/describeSyncError'

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
 */

type Check = {
  label: string
  state: 'pending' | 'ok' | 'fail' | 'skip'
  detail: string
}

const PS_URL: string = import.meta.env.VITE_POWERSYNC_URL ?? ''

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
          detail: res.ok ? PS_URL : `${PS_URL} answered ${res.status}`,
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
            `Could not reach ${PS_URL} from this browser (${e instanceof Error ? e.message : String(e)}). ` +
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

      // 5. What PowerSync itself thinks, right now.
      const st = powerSyncDb.currentStatus
      push({
        label: 'PowerSync connection',
        state: st?.connected ? 'ok' : 'fail',
        detail: st?.connected
          ? `Connected. Last synced ${st.lastSyncedAt?.toLocaleTimeString('en-GB') ?? 'not yet'}.`
          : `Not connected. ${
              st?.downloadError || st?.uploadError
                ? describeSyncError(st.downloadError ?? st.uploadError)
                : 'No error reported.'
            }`,
      })

      push({
        label: 'Streams subscribed',
        state: 'skip',
        detail: `${LISTLY_STREAM} and ${LISTLY_REF_STREAM} — these must exist in the PowerSync dashboard under Sync Streams.`,
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

  return (
    <Sheet label="Sync check" onClose={onClose}>
      <h2>Sync check</h2>

      {/* The verdict goes FIRST. On 2026-09-20 it was at the bottom and
          Adam could not see it — the one line that mattered was the one
          that scrolled off. */}
      {done && (
        <div className="card" style={{ padding: 14, borderColor: firstFail ? 'var(--red)' : 'var(--sage)' }}>
          <div className="lbl" style={{ marginBottom: 4 }}>
            {firstFail ? 'What to do' : 'All good'}
          </div>
          <p className="help" style={{ margin: 0 }}>
            {firstFail
              ? firstFail.detail
              : 'Everything the app can check is working. If it still is not syncing, the two streams may not be deployed in the PowerSync dashboard.'}
          </p>
        </div>
      )}

      <p className="help" style={{ marginTop: 0 }}>
        This runs the checks itself. You don’t need to read any logs — just send whatever it says
        below.
      </p>

      <div>
        {checks.map((c) => (
          <div className="mrow" key={c.label}>
            <span
              className="dot"
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                flexShrink: 0,
                marginRight: 4,
                background:
                  c.state === 'ok'
                    ? 'var(--sage)'
                    : c.state === 'fail'
                      ? 'var(--red)'
                      : 'var(--line-2)',
              }}
            />
            <div className="grow">
              <div className="nm" style={{ fontSize: 22 }}>{c.label}</div>
              <div className="st">{c.detail}</div>
            </div>
          </div>
        ))}
        {!done && <p className="help">Checking…</p>}
      </div>

      {/* What the boot sequence actually did. PowerSync's own status only
          describes the CONNECTION — it cannot say that connect() was never
          reached, which is exactly the gap that made "Not connected. No
          error reported." undiagnosable. */}
      <div>
        <div className="lbl">Startup steps</div>
        {boot.length === 0 && (
          <p className="help" style={{ marginTop: 4 }}>
            Nothing recorded — the sync startup never ran. Reload the page with this open.
          </p>
        )}
        {boot.map((b, i) => (
          <div className="mrow" key={i}>
            <span
              className="dot"
              style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginRight: 4,
                background:
                  b.level === 'ok' ? 'var(--sage)' : b.level === 'fail' ? 'var(--red)' : 'var(--line-2)',
              }}
            />
            <div className="grow">
              <div className="st" style={{ fontSize: 19 }}>
                {b.at} · {b.step}
              </div>
              {b.detail && <div className="st">{b.detail}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="actions">
        <div style={{ flex: 1 }} />
        <button className="btn sage" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  )
}
