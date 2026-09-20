import { useEffect, useState } from 'react'
import { SyncDiagnostics } from './SyncDiagnostics'
import { describeSyncError } from '../lib/powersync/describeSyncError'
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
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const off = powerSyncDb.registerListener({
      statusChanged: (s) => setStatus(s),
    })
    return () => off()
  }, [])

  const connected = status?.connected ?? false
  const connecting = status?.connecting ?? false
  const synced = status?.hasSynced ?? false
  const busy = (status?.downloading ?? false) || (status?.uploading ?? false)
  // 🚨 The field that actually says WHY. Without it, "Offline" is
  // indistinguishable from "the server refused us", which is exactly the
  // ambiguity that cost time on 2026-09-20.
  const err = status?.downloadError ?? status?.uploadError

  let label: string | null = null
  let colour = 'var(--sage)'
  if (err) {
    label = 'Sync failed'
    colour = 'var(--red)'
  } else if (connecting && !connected) {
    label = 'Connecting…'
    colour = 'var(--brown-2)'
  } else if (!connected) {
    label = 'Offline'
    colour = 'var(--muted)'
  } else if (busy) {
    label = 'Syncing…'
  } else if (!synced) {
    label = 'Connecting…'
    colour = 'var(--brown-2)'
  }

  const title = [
    err ? `Sync error: ${describeSyncError(err)}` : null,
    status?.lastSyncedAt
      ? `Last synced ${status.lastSyncedAt.toLocaleTimeString('en-GB')}`
      : 'Not synced yet',
    `connected=${connected} connecting=${connecting} hasSynced=${synced}`,
  ]
    .filter(Boolean)
    .join(' · ')

  // One line in the console on every status change, so a failure leaves a
  // trail even if nobody is looking at the header at the time.
  useEffect(() => {
    if (err) console.error('[listly] sync status error:', err)
  }, [err])

  // Tapping it runs the checks. Nobody should have to read a console to
  // find out why their shopping list is not syncing.
  return (
    <>
      <button
        className="sync-dot"
        title={title}
        onClick={() => setOpen(true)}
        aria-label={label ? `Sync: ${label}. Tap to check.` : 'Sync is working. Tap to check.'}
      >
        <span className="dot" style={{ background: colour }} />
        {label && <span>{label}</span>}
      </button>
      {open && <SyncDiagnostics onClose={() => setOpen(false)} />}
    </>
  )
}
