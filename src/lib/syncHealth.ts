import { describeSyncError } from './powersync/describeSyncError'

/**
 * ONE answer to "is this syncing?", shared by the header dot and the Sync
 * check panel so the two can never disagree again.
 *
 * 🚨 Why it exists (Adam, 2026-09-21): the dot said "Sync failed" while the
 * panel said "All good" and every check was green. Both were reading the same
 * PowerSync status — the dot treated any error as a failure, and the panel
 * only looked at the error when DISCONNECTED. Connected-with-an-error fell
 * between them.
 *
 * 🚨 And the error was STALE. Read in @powersync/shared-internals
 * (AbstractStreamingSyncImplementation, v2.3): `downloadError` is cleared on
 * every completed sync, but `uploadError` is cleared only after an upload
 * SUCCEEDS. If the failure happens on the "nothing left to upload — ask for a
 * checkpoint" step (a network hiccup as the phone wakes, say), the queue is
 * already empty, no upload ever runs again, and the error sits there for as
 * long as the app is open. So:
 *
 *   an upload error only matters while something is WAITING to upload.
 *
 * With nothing queued it is history: logged, shown in the troubleshooting
 * details, never shown as a failure.
 */

export interface SyncFacts {
  connected: boolean
  connecting: boolean
  hasSynced: boolean
  downloading: boolean
  uploading: boolean
  downloadError?: unknown
  uploadError?: unknown
  /** Changes on this phone not yet accepted by the server. null = not known yet. */
  waiting: number | null
  lastSyncedAt?: Date
}

export type SyncTone = 'ok' | 'busy' | 'offline' | 'connecting' | 'problem'

export interface SyncHealth {
  tone: SyncTone
  /** The header's words. null = the quiet dot, no text: the normal case. */
  label: string | null
  /** The panel's plain-English headline and next step. */
  headline: string
  detail: string
}

const plural = (n: number) => `${n} change${n === 1 ? '' : 's'}`

function isNetwork(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  return m.includes('load failed') || m.includes('networkerror') || m.includes('failed to fetch') || m.includes('network')
}

const time = (d?: Date) => d?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function syncHealth(f: SyncFacts): SyncHealth {
  const waiting = f.waiting ?? 0
  const waitingNote = waiting > 0 ? ` ${plural(waiting)} on this phone will send when you have signal again.` : ''

  // No signal, or a network error while offline: that is FINE for this app —
  // it is built for a shop with no signal.
  const offline =
    (!f.connected && !f.connecting && f.hasSynced) ||
    (!f.connected && f.hasSynced && f.downloadError !== undefined && isNetwork(f.downloadError))
  if (offline) {
    return {
      tone: 'offline',
      label: 'Offline',
      headline: 'Offline — that’s fine',
      detail: `Listly keeps working from what’s on this phone.${waitingNote}`,
    }
  }

  // A real download problem: connected (or trying) and the server said no.
  if (f.downloadError !== undefined && f.downloadError !== null) {
    return {
      tone: 'problem',
      label: 'Not syncing',
      headline: 'Listly can’t sync right now',
      detail: describeSyncError(f.downloadError),
    }
  }

  // 🚨 Only while something is actually waiting. See the header.
  if (f.uploadError !== undefined && f.uploadError !== null && waiting > 0) {
    return {
      tone: 'problem',
      label: 'Not syncing',
      headline: `${plural(waiting)} not sent yet`,
      detail: `${describeSyncError(f.uploadError)} Nothing is lost — they’re saved on this phone and Listly keeps retrying.`,
    }
  }

  if (!f.hasSynced || (f.connecting && !f.connected)) {
    return {
      tone: 'connecting',
      label: 'Connecting…',
      headline: 'Connecting…',
      detail: f.hasSynced ? 'Reconnecting to the sync service.' : 'Getting your lists for the first time on this phone.',
    }
  }

  if (f.downloading || f.uploading || waiting > 0) {
    return {
      tone: 'busy',
      label: 'Syncing…',
      headline: 'Syncing…',
      detail: waiting > 0 ? `Sending ${plural(waiting)}.` : 'Fetching the latest changes.',
    }
  }

  return {
    tone: 'ok',
    label: null,
    headline: 'Everything is synced',
    detail: f.lastSyncedAt ? `Last synced at ${time(f.lastSyncedAt)}.` : 'Up to date.',
  }
}
