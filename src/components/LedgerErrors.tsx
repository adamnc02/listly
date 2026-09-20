import { useListly } from '../context/ListlyContext'

/**
 * "Couldn't add to the ledger — tap to retry" (PROMPT-01 §8.4 / PROMPT-03
 * §2.5).
 *
 * 🚨 This component exists because the alternative is a silent failure, and
 * a silent failure here is exactly the class of bug this whole workstream
 * keeps paying for. The shop was finished, the items were cleared, and the
 * money never reached the ledger — with nothing on screen, the first anyone
 * would know is a household budget that quietly does not add up.
 *
 * The trigger never raises (it cannot: it would block the device's entire
 * upload queue), so `ledger_error` on the completion row is the ONLY signal
 * there is. This is where it surfaces.
 *
 * Retry re-writes the row, which fires the trigger again. Most causes are
 * transient or fixable — a category that had not synced, a membership row
 * mid-move — so trying again is usually the whole fix.
 */
export function LedgerErrors() {
  const { failedCompletions, retryLedger, ledgerGateOpen } = useListly()

  // With no ledger there is nothing to have failed, and nothing that should
  // ever mention one.
  if (!ledgerGateOpen || failedCompletions.length === 0) return null

  return (
    <div className="ledger-errors">
      {failedCompletions.map((c) => (
        <div className="ledger-error" key={c.id} role="alert">
          <div className="grow">
            <div className="t">Couldn’t add {c.listName} to the ledger</div>
            <div className="w">
              £{c.amount.toFixed(2)} · {c.error}
            </div>
          </div>
          <button className="btn retry" onClick={() => retryLedger(c.id)}>
            Retry
          </button>
        </div>
      ))}
    </div>
  )
}
