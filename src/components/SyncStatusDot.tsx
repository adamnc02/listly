import { useEffect, useState } from 'react'
import { SyncDiagnostics } from './SyncDiagnostics'
import { describeSyncError } from '../lib/powersync/describeSyncError'
import { useSyncHealth } from '../lib/powersync/useSyncHealth'

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
 * So the state is shown, not inferred — by lib/syncHealth.ts, which the Sync
 * check panel shares:
 *   synced, nothing waiting → a quiet dot, no text (the normal case)
 *   downloading/uploading/changes waiting → "Syncing…"
 *   not connected, HAS synced before → "Offline" (which is FINE — this app is
 *                         built for a shop with no signal; the queue drains
 *                         later, and there is local data to work from)
 *   never synced, or reconnecting → "Connecting…", never "Offline"
 *   the server refusing, or changes waiting that keep failing → "Not syncing"
 *
 * 🚨 An upload error with NOTHING waiting is history, not a failure — see
 * lib/syncHealth.ts for why PowerSync leaves one lying around.
 *
 * 🚩 That "never synced" distinction was added 2026-09-20 after Adam signed
 * in on the deployed build and got an empty app badged "Offline" while the
 * first download was still in flight. "Offline" means "working from local
 * data" — and before a first sync there IS no local data, so saying it was
 * simply untrue. An honest label costs one condition.
 *
 * `lastSyncedAt` is the honest one: if it is still undefined minutes after
 * sign-in, sync is genuinely not working, whatever the console says.
 */
export function SyncStatusDot() {
  const [open, setOpen] = useState(false)
  // 🚨 The SAME rule the Sync check panel uses (lib/syncHealth.ts), so the
  // header and the panel can never disagree again. Adam, 2026-09-21: the dot
  // said "Sync failed" while every check in the panel was green — a stale
  // upload error with nothing waiting to upload.
  const { facts, health } = useSyncHealth()

  const colour =
    health.tone === 'problem'
      ? 'var(--red)'
      : health.tone === 'offline'
        ? 'var(--muted)'
        : health.tone === 'connecting'
          ? 'var(--brown-2)'
          : 'var(--sage)'

  // One line in the console whenever an error appears — including a stale
  // one the dot deliberately does not show — so it still leaves a trail.
  const err = facts.downloadError ?? facts.uploadError
  useEffect(() => {
    if (err) console.error('[listly] sync status error:', err)
  }, [err])

  const title = [
    health.headline,
    err ? `Last error: ${describeSyncError(err)}` : null,
    facts.lastSyncedAt ? `Last synced ${facts.lastSyncedAt.toLocaleTimeString('en-GB')}` : 'Not synced yet',
  ]
    .filter(Boolean)
    .join(' · ')

  // Tapping it runs the checks. Nobody should have to read a console to
  // find out why their shopping list is not syncing.
  return (
    <>
      <button
        className="sync-dot"
        title={title}
        onClick={() => setOpen(true)}
        aria-label={health.label ? `Sync: ${health.label}. Tap to check.` : 'Sync is working. Tap to check.'}
      >
        <span className="dot" style={{ background: colour }} />
        {health.label && <span>{health.label}</span>}
      </button>
      {open && <SyncDiagnostics onClose={() => setOpen(false)} />}
    </>
  )
}
