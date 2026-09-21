import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { powerSyncDb } from '../lib/powersync/database'
import { useWatchedQuery } from '../lib/powersync/useWatchedQuery'
import {
  CYCLE_MS,
  HOLD_MS,
  LEAVE_MS,
  decide,
  ledgerOutcome,
  type Ending,
} from '../lib/shopConfirmation'
import { PoundNote, Store, Wallet } from './Icons'

/**
 * "It went to the ledger" — shown after Save in Finish shop, and ONLY then.
 *
 * Adam, 2026-09-21: animation only. £ notes leave the wallet on the left and
 * fly to a shop on the right; after two of them (or once the sync is
 * complete, whichever is later) a tick morphs into the middle with "Success"
 * under it, then morphs out and the window closes.
 *
 * 🚨 Never shown for "Don't price it", nor for a household with no ledger:
 * nothing went anywhere, so there is nothing to confirm. Shopping.tsx only
 * mounts this with the id of a completion row that was actually written.
 *
 * 🚨 The tick means the LEDGER confirmed it. lib/shopConfirmation.ts has the
 * rules and why; in short, this watches the completion row until the server
 * sends it back with a `transaction_id` (booked) or a `ledger_error`
 * (refused), and ends on a red cross or an honest "queued" frame otherwise.
 * The retry banner is already waiting under a cross — this does not repeat
 * its job, it only stops the tick from lying.
 *
 * Connection state comes from `powerSyncDb` exactly the way SyncStatusDot
 * reads it, so this and the header dot can never disagree about whether the
 * phone is online.
 *
 * No buttons, deliberately — it is at most ~13s and cannot change anything.
 * Portalled to document.body, at the sheet layer (z-index 500), per §15.
 */
type Phase = 'flying' | Ending

export function ShopConfirmation({ completionId, onDone }: { completionId: string; onDone: () => void }) {
  const rows = useWatchedQuery(
    'SELECT transaction_id, ledger_error FROM lst_shop_completions WHERE id = ?',
    [completionId],
  )
  const outcome = ledgerOutcome(rows[0])
  const [status, setStatus] = useState(() => powerSyncDb.currentStatus)
  const [phase, setPhase] = useState<Phase>('flying')
  const [leaving, setLeaving] = useState(false)

  useEffect(() => powerSyncDb.registerListener({ statusChanged: (s) => setStatus(s) }), [])

  // The interval reads the latest values, not the ones it was created with.
  const live = useRef({ outcome, connected: false, connecting: false })
  useEffect(() => {
    live.current = {
      outcome,
      connected: status?.connected ?? false,
      connecting: status?.connecting ?? false,
    }
  }, [outcome, status])

  // One tick per note, in step with the CSS animation's own duration.
  useEffect(() => {
    const started = Date.now()
    let cycles = 0
    const timer = window.setInterval(() => {
      cycles += 1
      const next = decide({ cyclesDone: cycles, elapsedMs: Date.now() - started, ...live.current })
      if (next !== 'continue') {
        window.clearInterval(timer)
        setPhase(next)
      }
    }, CYCLE_MS)
    return () => window.clearInterval(timer)
  }, [])

  // Hold the end frame, morph out, then close.
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  }, [onDone])
  useEffect(() => {
    if (phase === 'flying') return
    const out = window.setTimeout(() => setLeaving(true), HOLD_MS[phase])
    const close = window.setTimeout(() => done.current(), HOLD_MS[phase] + LEAVE_MS)
    return () => {
      window.clearTimeout(out)
      window.clearTimeout(close)
    }
  }, [phase])

  const words =
    phase === 'ok'
      ? 'Success'
      : phase === 'error'
        ? 'Couldn’t add to the ledger'
        : phase === 'queued'
          ? 'Saved — it’ll reach the ledger when you’re back online'
          : 'Adding to the ledger…'

  return createPortal(
    <div
      className={`confirm-root${leaving ? ' leaving' : ''}`}
      style={{ '--cycle': `${CYCLE_MS}ms`, '--leave': `${LEAVE_MS}ms` } as CSSProperties}
    >
      <div className="confirm-card" role="status" aria-live="polite">
        <span className="sr">{words}</span>
        <div className="confirm-stage" aria-hidden="true">
          <div className={`confirm-flight${phase === 'flying' ? '' : ' gone'}`}>
            <span className="confirm-from">
              <Wallet size={52} />
            </span>
            <span className="confirm-note">
              <PoundNote />
            </span>
            <span className="confirm-to">
              <Store size={52} />
            </span>
          </div>
          {phase !== 'flying' && (
            <div className={`confirm-result ${phase}`}>
              <ResultMark ending={phase} />
              <div className="confirm-words">{words}</div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Drawn on, not faded on: the ring traces round, then the mark inside it. */
function ResultMark({ ending }: { ending: Ending }) {
  return (
    <svg className="confirm-mark" width="84" height="84" viewBox="0 0 84 84" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle className="ring" cx="42" cy="42" r="36" strokeWidth="4" pathLength={1} />
      {ending === 'ok' && <path className="stroke" d="M26 43.5l11 11L59 31" strokeWidth="5" pathLength={1} />}
      {ending === 'error' && (
        <>
          <path className="stroke" d="M30 30l24 24" strokeWidth="5" pathLength={1} />
          <path className="stroke late" d="M54 30L30 54" strokeWidth="5" pathLength={1} />
        </>
      )}
      {ending === 'queued' && <path className="stroke" d="M42 24v19l11 7" strokeWidth="5" pathLength={1} />}
    </svg>
  )
}
