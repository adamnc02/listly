import { useEffect, useRef, useState } from 'react'
import { powerSyncDb } from './database'
import type { Row } from './mapping'

/**
 * A live SQLite query. Re-runs whenever PowerSync delivers a change, whether
 * that change came from this device or the other one.
 *
 * `query(...).watch()` is the current API; `db.watch()`'s AsyncIterator and
 * callback forms are maintained for backwards compatibility only.
 *
 * Local reads need no `WHERE household_id = ?`: the Sync Streams already
 * scoped what reaches this device server-side, so the local tables only ever
 * hold rows this user can see. Filtering again would be a second place to get
 * the predicate wrong.
 */
export function useWatchedQuery(sql: string, parameters: unknown[] = []): Row[] {
  const [rows, setRows] = useState<Row[]>([])
  // Params are compared by value, so a caller can pass a fresh array each
  // render without re-subscribing on every one.
  const key = JSON.stringify(parameters)
  const paramsRef = useRef(parameters)
  paramsRef.current = parameters

  useEffect(() => {
    let closed = false
    const watched = powerSyncDb
      .query<Row>({ sql, parameters: paramsRef.current as never })
      .watch()

    const off = watched.registerListener({
      onData: (data) => {
        if (!closed) setRows([...data])
      },
      onError: (e) => {
        console.error('[powersync] watched query failed:', sql, e)
      },
    })

    return () => {
      closed = true
      off()
      void watched.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, key])

  return rows
}
