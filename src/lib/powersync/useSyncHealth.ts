import { useEffect, useState } from 'react'
import { powerSyncDb } from './database'
import { syncHealth, type SyncFacts, type SyncHealth } from '../syncHealth'

/**
 * The live inputs to `syncHealth()`: PowerSync's status, plus how many local
 * changes are still waiting to upload — the fact that decides whether an
 * upload error is current or merely history (see lib/syncHealth.ts).
 *
 * The queue is re-counted on every status change and every 10s. It is one
 * `count(*)` on PowerSync's own table, so the poll costs nothing, and it
 * catches a queue that fills while the status is otherwise quiet.
 */
export function useSyncFacts(): SyncFacts {
  const [status, setStatus] = useState(() => powerSyncDb.currentStatus)
  const [waiting, setWaiting] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const count = () =>
      powerSyncDb
        .getUploadQueueStats()
        .then((s) => {
          if (alive) setWaiting(s.count)
        })
        .catch(() => {
          /* the database is still opening; the next tick will get it */
        })
    const off = powerSyncDb.registerListener({
      statusChanged: (s) => {
        setStatus(s)
        void count()
      },
    })
    const timer = window.setInterval(() => void count(), 10_000)
    void count()
    return () => {
      alive = false
      off()
      window.clearInterval(timer)
    }
  }, [])

  return {
    connected: status?.connected ?? false,
    connecting: status?.connecting ?? false,
    hasSynced: status?.hasSynced ?? false,
    downloading: status?.dataFlowStatus?.downloading ?? false,
    uploading: status?.dataFlowStatus?.uploading ?? false,
    downloadError: status?.dataFlowStatus?.downloadError,
    uploadError: status?.dataFlowStatus?.uploadError,
    waiting,
    lastSyncedAt: status?.lastSyncedAt,
  }
}

export function useSyncHealth(): { facts: SyncFacts; health: SyncHealth } {
  const facts = useSyncFacts()
  return { facts, health: syncHealth(facts) }
}
