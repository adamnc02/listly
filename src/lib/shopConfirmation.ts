/**
 * When the Finish-shop confirmation stops flying notes, and what it ends on.
 *
 * Adam, 2026-09-21: the animation runs "for two cycles or until the sync is
 * complete — whichever finishes last". Kept here, pure, so
 * scripts/verify-shop-confirmation.ts can prove the rules without a phone.
 *
 * 🚨 "The sync is complete" means THE LEDGER CONFIRMED IT (Adam's choice,
 * 2026-09-21), not "the upload queue drained". The completion row comes back
 * down from the server carrying either `transaction_id` (the trigger booked
 * it) or `ledger_error` (the trigger refused it). Until one of those arrives,
 * nothing on this device knows whether Shared Ledger has the transaction, so
 * a tick before then would be a guess.
 *
 * 🚨 And so the tick means only that. In a shop with no signal the row can
 * never come back, so the loop would run forever. Offline — or still pending
 * at the cap — it ends on an honest "queued" frame instead: saved on this
 * phone, and it will reach the ledger when the phone is back online. The
 * shop IS saved, so this is not a failure; it is simply not a success YET.
 *
 * The decision is only taken at a cycle boundary, so a note is never cut off
 * mid-flight.
 */

/** One note crossing the window, wallet to shop. */
export const CYCLE_MS = 1500
/** Adam: "After two runs (2 notes flying across the screen)". */
export const MIN_CYCLES = 2
/** Pending this long and it stops waiting and says "queued". Decided at the
 *  first cycle boundary at or after it, so in practice 10.5s. */
export const CAP_MS = 10_000
/** How long each end frame stays up before it morphs out. The queued one
 *  carries a sentence to read, so it stays longer. */
export const HOLD_MS = { ok: 1100, error: 2200, queued: 2600 } as const
/** The morph out, and then the window closes. Keep in step with the CSS. */
export const LEAVE_MS = 380

export type LedgerOutcome = 'pending' | 'ok' | 'error'
export type Ending = keyof typeof HOLD_MS

/** Reads the synced completion row. `''` and NULL are the same "not yet". */
export function ledgerOutcome(row: { transaction_id?: unknown; ledger_error?: unknown } | undefined): LedgerOutcome {
  if (!row) return 'pending'
  // An error wins over a stale id: a retry clears ledger_error locally and
  // the server writes a fresh one if it fails again.
  if (typeof row.ledger_error === 'string' && row.ledger_error !== '') return 'error'
  if (typeof row.transaction_id === 'string' && row.transaction_id !== '') return 'ok'
  return 'pending'
}

export interface CycleState {
  cyclesDone: number
  elapsedMs: number
  outcome: LedgerOutcome
  /** PowerSync's own status — the same source the header's sync dot reads. */
  connected: boolean
  connecting: boolean
}

/** At the end of each cycle: keep flying, or which frame to end on. */
export function decide(t: CycleState): 'continue' | Ending {
  if (t.cyclesDone < MIN_CYCLES) return 'continue'
  if (t.outcome !== 'pending') return t.outcome
  // Genuinely offline — not merely reconnecting — cannot finish, so there is
  // no point making anyone wait out the cap.
  if (!t.connected && !t.connecting) return 'queued'
  if (t.elapsedMs >= CAP_MS) return 'queued'
  return 'continue'
}
