import { useEffect, useState } from 'react'
import { powerSyncDb } from '../lib/powersync/database'

/**
 * A one-glance answer to "is this actually syncing?".
 *
 * 🚨 Why this exists. On 2026-09-20 the console showed
 * `[PowerSync]: Sync error TypeError: Load failed` and there was no way to
 * tell, from inside the app, whether that meant "sync is broken" or "a
 * request was aborted during sign-out" — Safari reports both as "Load
 * failed". Inferring health from console noise is exactly how this
 * workstream has repeatedly lost time: the whole family of failures here is
 * silent, and an app that looks fine while never syncing is the worst of
 * them.
 *
 * So the state is shown, not inferred:
 *   connected + synced  → a quiet dot, no text (the normal case)
 *   downloading/uploading → "Syncing…"
 *   not connected       → "Offline" (which is FINE — this app is built for
 *                         a shop with no signal; the queue drains later)
 *   connected, never synced → "Connecting…"
 *
 * `lastSyncedAt` is the honest one: if it is still undefined minutes after
 * sign-in, sync is genuinely not working, whatever the console says.
 */
export function SyncStatusDot() {
  const [status, setStatus] = useState(() => powerSyncDb.currentStatus)

  useEffect(() => {
    const off = powerSyncDb.registerListener({
      statusChanged: (s) => setStatus(s),
    })
    return () => off()
  }, [])

  const connected = status?.connected ?? false
  const synced = status?.hasSynced ?? false
  const busy = (status?.downloading ?? false) || (status?.uploading ?? false)

  let label: string | null = null
  let colour = 'var(--sage)'
  if (!connected) {
    label = 'Offline'
    colour = 'var(--muted)'
  } else if (busy) {
    label = 'Syncing…'
  } else if (!synced) {
    label = 'Connecting…'
    colour = 'var(--brown-2)'
  }

  const title = status?.lastSyncedAt
    ? `Last synced ${status.lastSyncedAt.toLocaleTimeString('en-GB')}`
    : 'Not synced yet'

  return (
    <span className="sync-dot" title={title}>
      <span className="dot" style={{ background: colour }} />
      {label && <span className="lbl-sm">{label}</span>}
    </span>
  )
}
