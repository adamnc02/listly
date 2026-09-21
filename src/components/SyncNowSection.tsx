import { useState } from 'react'
import { syncNow } from '../lib/powersync/syncNow'

/**
 * "Sync now" (Adam, 2026-09-21). lib/powersync/syncNow.ts says what it does
 * and does not do; this is only the button and its honest result.
 *
 * It says "Syncing…" until BOTH directions have finished — this phone's
 * queued changes accepted, and a fresh download completed — or until it can
 * name why not. The header dot shows the same activity while it runs.
 */
export function SyncNowSection() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    setError(null)
    try {
      const r = await syncNow()
      if (r.ok) {
        const time = r.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        setNote(
          r.sent > 0
            ? `Up to date — sent ${r.sent} change${r.sent === 1 ? '' : 's'} and fetched the latest at ${time}.`
            : `Up to date — fetched the latest at ${time}.`,
        )
      } else {
        setError(r.message)
      }
    } catch (e) {
      setError(`Sync didn’t run: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="reminders">
      <div className="lbl">Sync</div>
      <p className="help">
        Listly syncs by itself whenever it has signal. <b>Sync now</b> sends anything on this phone that
        hasn’t gone yet, then fetches the latest from everyone — use it if something looks out of date.
      </p>
      <div className="actions">
        <div style={{ flex: 1 }} />
        <button className={`btn sage${busy ? ' waiting' : ''}`} onClick={() => void run()} aria-busy={busy}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {note && <p className="help" style={{ color: 'var(--sage)' }}>{note}</p>}
      {error && <p className="help" style={{ color: 'var(--red)' }} role="alert">{error}</p>}
    </div>
  )
}
