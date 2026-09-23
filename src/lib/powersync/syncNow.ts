import { powerSyncDb, powerSyncConnector } from './database'
import { describeSyncError } from './describeSyncError'
import { syncNowFinished, type SyncFacts } from '../syncHealth'

/**
 * "Sync now" in the Account sheet (Adam, 2026-09-21).
 *
 * WHAT IT DOES: disconnects and reconnects — exactly what shared-finance-
 * ledger's forceSync does, and what every launch does. Reconnecting makes
 * PowerSync (1) upload everything queued on this phone, then (2) ask the
 * server for a fresh checkpoint and download everything since the last one.
 * Both directions, in that order, and the order is the protocol's own:
 * downloads are only applied once the server's state includes this phone's
 * uploads, so nothing a phone sends can be "overwritten" by the pull.
 *
 * WHAT IT DOES NOT DO: clear anything or re-download from scratch. It is not
 * a reset — it is "do now what would otherwise happen on its own".
 * Subscriptions persist across the reconnect (they live in the local core),
 * so the two Listly streams carry on unchanged.
 *
 * It resolves only when `syncNowFinished()` holds, or says honestly why not.
 */

export type SyncNowResult =
  | { ok: true; sent: number; at: Date }
  | { ok: false; message: string }

const TIMEOUT_MS = 30_000

function facts(waiting: number | null): SyncFacts {
  const s = powerSyncDb.currentStatus
  return {
    connected: s?.connected ?? false,
    connecting: s?.connecting ?? false,
    hasSynced: s?.hasSynced ?? false,
    downloading: s?.dataFlowStatus?.downloading ?? false,
    uploading: s?.dataFlowStatus?.uploading ?? false,
    downloadError: s?.dataFlowStatus?.downloadError,
    uploadError: s?.dataFlowStatus?.uploadError,
    waiting,
    lastSyncedAt: s?.lastSyncedAt,
  }
}

const queued = async () => (await powerSyncDb.getUploadQueueStats()).count

export async function syncNow(): Promise<SyncNowResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      ok: false,
      message: 'No signal right now. Anything you change is saved on this phone and sends by itself when you’re back online.',
    }
  }

  const before = await queued()
  // A second back, so a checkpoint stamped within the same second still counts.
  const startedAt = new Date(Date.now() - 1000)

  await powerSyncDb.disconnect()
  await powerSyncDb.connect(powerSyncConnector, { includeDefaultStreams: false })

  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const f = facts(await queued())
    if (syncNowFinished(f, startedAt)) return { ok: true, sent: before, at: f.lastSyncedAt! }
    await new Promise((r) => setTimeout(r, 500))
  }

  const f = facts(await queued())
  const err = f.downloadError ?? ((f.waiting ?? 0) > 0 ? f.uploadError : undefined)
  return {
    ok: false,
    message: err
      ? describeSyncError(err)
      : (f.waiting ?? 0) > 0
        ? `${f.waiting} change${f.waiting === 1 ? '' : 's'} still waiting to send. Listly keeps trying by itself.`
        : 'It didn’t finish within 30 seconds. Listly keeps trying by itself — check the sync dot.',
  }
}
