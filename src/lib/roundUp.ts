/**
 * PROMPT-05 — round-ups on a personal card shop.
 *
 * A £7.50 Current Account shop is BOOKED as £8.00, remembering it came from
 * £7.50, and the 50p funds that person's Coin Jar in the ledger. There is no
 * second transaction anywhere: the jar's balance is derived in the ledger app
 * by summing (amount − roundedFrom) over the rows naming it
 * (APP-KNOWLEDGE §1.19d).
 *
 * 🚨 THE DECISION IS MADE HERE, IN FRONT OF THE PERSON — never in the
 * trigger. Adam, 2026-09-21: "as soon as the location is picked, if the value
 * is not a whole number and the location is current account, check if rounding
 * is on, and apply it, and add the step to the picker flow to match
 * transactions entries." The bridge CARRIES what this file computed and the
 * sheet displayed. Anything that moves the arithmetic server-side lets the
 * booked row contradict the screen that was tapped.
 *
 * 🚨 IT MIRRORS shared-finance-ledger/src/lib/roundUp.ts, DELIBERATELY AND
 * PARTIALLY. Same `round2`-then-`Math.ceil`, same "an exact pound does not
 * round", same "the OWNER's jar, never the signed-in user's". What it does
 * NOT mirror is `roundUpEnabledOn`'s walk over the dated on/off history —
 * see `roundUpApplies` for why that is a decision and not an omission.
 */

import type { LocationOption } from '../types'

const round2 = (n: number) => Math.round(n * 100) / 100

/** What the ledger knows about one person's round-ups, at one moment. */
export interface RoundUpState {
  enabled: boolean
  /** The pots.id of that person's Coin Jar. '' whenever `enabled` is false. */
  jarPotId: string
}

/** Nobody rounds until the ledger has said otherwise. The absent case is the safe one. */
export const ROUND_UP_OFF: RoundUpState = { enabled: false, jarPotId: '' }

/**
 * The next whole pound. `Math.ceil` on an exact pound returns that same
 * pound, which is what gives "an exact £ transaction does not get rounded"
 * for free — the uplift is zero, so `roundUpApplies` rejects it. Adam:
 * "correct, exact £ transactions do not get rounded."
 *
 * The `round2` first is load-bearing against float noise: a 7.5 that arrived
 * as 7.500000000000001 must not round to £9.
 */
export function roundUpTarget(amount: number): number {
  return Math.ceil(round2(amount))
}

/** What this amount would put in the Coin Jar. Zero for an exact pound. */
export function roundUpUplift(amount: number): number {
  return round2(roundUpTarget(amount) - round2(amount))
}

/**
 * Whether this shop rounds at all — and therefore whether the round-up step
 * appears in Finish shop.
 *
 * 🚨 `location === 'personal'` ONLY. A joint or pot shop never rounds
 * (§1.19d), and joint is the default, which is exactly why the missing
 * feature went unnoticed for so long. `payment_method` is hard-coded 'card'
 * and the type is hard-coded 'expense' in this app, so two of the ledger's
 * five predicate clauses are satisfied by construction and are not re-tested
 * here.
 *
 * 🚨 ONLY A SHOP DATED TODAY (Adam, 2026-09-21). A backdated shop would need
 * the ledger's `roundUpHistory` walk re-implemented in SQL to answer "was
 * rounding on THEN", and a second implementation of that walk is precisely
 * the thing that drifts (§1.19f). A future-dated shop books as `pending` and
 * does not round either. The limitation is deliberate and must stay VISIBLE:
 * change the date away from today and the step disappears.
 */
export function roundUpApplies(
  args: { amount: number; location: LocationOption | null; spendDate: string; today: string },
  state: RoundUpState,
): boolean {
  if (!state.enabled || !state.jarPotId) return false
  if (!args.location || args.location.location !== 'personal') return false
  // A personal shop always has an owner: the picker builds one entry per
  // `people` row and sets ownerId from it.
  if (!args.location.ownerId) return false
  if (args.spendDate !== args.today) return false
  return roundUpUplift(args.amount) > 0
}

/**
 * What to STORE, given the real price and the person's answer on the step.
 *
 * `amount` out is what is BOOKED — the rounded figure — and `roundedFrom` is
 * the real price, matching the ledger's own convention so that every existing
 * reader of `transactions.amount` stays correct untouched.
 *
 * 🚨 BOTH, OR NEITHER. `listly.shop_completions` and
 * `shared_finance_ledger.transactions` each carry a both-or-neither CHECK,
 * and under PowerSync a violated CHECK is a 23514 whose write is silently
 * DISCARDED (§27). One function returns the pair so no caller can write half
 * of it.
 *
 * `skipped` is the person tapping "Don't round it" on the step. Unlike the
 * ledger it needs no stored flag: the ledger recomputes rounding every time a
 * row is saved, so an opt-out there has to survive an edit (§1.19d-2), while a
 * Listly completion is written once and never recomputed. Nothing to
 * reconstruct, so nothing to store.
 */
export function shopRoundUpFields(
  args: {
    amount: number
    location: LocationOption | null
    spendDate: string
    today: string
    skipped?: boolean
  },
  state: RoundUpState,
): { amount: number; roundedFrom: number | null; roundingPotId: string | null } {
  const price = round2(args.amount)
  if (args.skipped || !roundUpApplies({ ...args, amount: price }, state)) {
    return { amount: price, roundedFrom: null, roundingPotId: null }
  }
  return { amount: roundUpTarget(price), roundedFrom: price, roundingPotId: state.jarPotId }
}
