/**
 * verify-shop-completion-mapping — what a priced shop actually stores, and
 * what the bridge carries into the ledger.
 *
 * The bug this prevents: storing the REAL price in `amount` on a shop that
 * rounded. The ledger's convention is that `amount` is ALREADY the rounded
 * figure (£8.00) and `rounded_from` is the real price (£7.50), which is what
 * makes every existing reader — the ledger, every projection, every total —
 * correct untouched (APP-KNOWLEDGE §1.19d). Store it the other way round and
 * the shop reads £7.50 in the ledger while the Coin Jar claims 50p that never
 * left the account.
 *
 * The second bug: a HALF-SET pair. Both tables carry a both-or-neither CHECK,
 * and under PowerSync a violated CHECK (23514) is a write the connector
 * DISCARDS with no error anywhere in the app (MIGRATION-LESSONS §27) — the
 * shop would simply vanish.
 *
 * The third: the bridge computing rather than carrying. The trigger's only
 * judgement about the pair is the belt-and-braces location guard modelled
 * below; everything else it passes through exactly as Listly displayed it.
 *
 *   TZ=Europe/London npx tsx scripts/verify-shop-completion-mapping.ts
 */
import { shopRoundUpFields, type RoundUpState } from '../src/lib/roundUp'
import type { LocationOption } from '../src/types'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

const TODAY = '2026-09-21'
const on: RoundUpState = { enabled: true, jarPotId: 'jar-adam' }
const personal: LocationOption = {
  key: 'personal:adam', label: 'Current Account', location: 'personal', ownerId: 'adam', potId: '', ownerName: '',
}
const joint: LocationOption = { key: 'joint', label: 'Joint account', location: 'joint', ownerId: '', potId: '', ownerName: '' }

/** The row insertShopCompletion writes, in the columns that matter here. */
interface CompletionRow {
  amount: number
  location: string
  owner_id: string | null
  rounded_from: number | null
  rounding_pot_id: string | null
}

function completionRow(amount: number, location: LocationOption, state: RoundUpState, skipped = false): CompletionRow {
  const f = shopRoundUpFields({ amount, location, spendDate: TODAY, today: TODAY, skipped }, state)
  return {
    amount: f.amount,
    location: location.location,
    // A joint shop stores NO owner (§8.2c).
    owner_id: location.location === 'joint' ? null : location.ownerId,
    rounded_from: f.roundedFrom,
    rounding_pot_id: f.roundingPotId,
  }
}

/**
 * listly.write_ledger_transaction(), in the part this feature changed —
 * 20260921220000. It CARRIES the pair, and drops it on a non-personal row as
 * belt and braces, because a rounded joint expense would credit a jar against
 * money that left a different account.
 */
function ledgerRow(c: CompletionRow) {
  const isPersonal = c.location === 'personal'
  return {
    amount: c.amount,
    rounded_from: isPersonal ? c.rounded_from : null,
    rounding_pot_id: isPersonal ? c.rounding_pot_id : null,
  }
}

const bothOrNeither = (r: { rounded_from: number | null; rounding_pot_id: string | null }) =>
  (r.rounded_from === null) === (r.rounding_pot_id === null)

// ── a rounded shop ────────────────────────────────────────────────────────
const rounded = completionRow(7.5, personal, on)
check('the completion books the ROUNDED figure', rounded.amount === 8)
check('and remembers the REAL price', rounded.rounded_from === 7.5)
check('naming the owner’s jar', rounded.rounding_pot_id === 'jar-adam')
check('🚨 amount is NOT the real price (the whole bug)', rounded.amount !== rounded.rounded_from)

const booked = ledgerRow(rounded)
check('the bridge carries the amount unchanged', booked.amount === 8)
check('the bridge carries rounded_from unchanged', booked.rounded_from === 7.5)
check('the bridge carries the jar unchanged', booked.rounding_pot_id === 'jar-adam')
check('the uplift the ledger will derive is 50p', Number((booked.amount - (booked.rounded_from ?? 0)).toFixed(2)) === 0.5)

// ── an ordinary shop ──────────────────────────────────────────────────────
const plain = completionRow(7.5, joint, on)
check('a joint shop stores the price and no pair', plain.amount === 7.5 && plain.rounded_from === null)
check('and reaches the ledger the same way', ledgerRow(plain).rounded_from === null)
check('a joint shop still stores no owner', plain.owner_id === null)

// ── the trigger's belt and braces ─────────────────────────────────────────
// A pair that somehow arrived on a joint row — a hand-edited row, an older
// client, a future change to the picker — is DROPPED, not booked.
const smuggled: CompletionRow = { ...plain, rounded_from: 7.5, rounding_pot_id: 'jar-adam' }
check('🚨 a pair on a JOINT row is dropped by the bridge', ledgerRow(smuggled).rounded_from === null)
check('  and the amount is still booked', ledgerRow(smuggled).amount === 7.5)
check('  leaving a legal pair, not half of one', bothOrNeither(ledgerRow(smuggled)))

// ── both, or neither, at every hop ────────────────────────────────────────
const cases: CompletionRow[] = [
  completionRow(7.5, personal, on),
  completionRow(8, personal, on),
  completionRow(7.5, personal, on, true),
  completionRow(7.5, joint, on),
  completionRow(0.1 + 0.2, personal, on),
]
check('🚨 every completion row satisfies the CHECK', cases.every(bothOrNeither))
check('🚨 every ledger row satisfies the CHECK', cases.map(ledgerRow).every(bothOrNeither))

// ── the ledger must never re-round what already arrived rounded ───────────
// `amount` is already £8.00. Rounding the booked figure AGAIN takes £9.00 out
// for a £7.50 shop, and it is the single most likely way to get this wrong.
const rerounded = shopRoundUpFields(
  { amount: booked.amount, location: personal, spendDate: TODAY, today: TODAY },
  on,
)
check(
  '🚨 CONTROL: re-rounding an already-rounded £8.00 changes nothing (it is an exact pound)',
  rerounded.amount === 8 && rerounded.roundedFrom === null,
)

console.log(failed === 0 ? '\nThe pair survives the whole journey.' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
