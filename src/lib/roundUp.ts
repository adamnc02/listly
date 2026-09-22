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
 * 🚨 TODAY OR EARLIER — NEVER THE FUTURE (Adam, 2026-09-22: "it needs to
 * resolve, but for today or before only, never in the future").
 *
 * The original rule was today-only, because answering "was rounding on THEN"
 * needed the ledger's dated history walked and PROMPT-05 §0.2 avoided writing
 * a second copy of it. That turned out to be the wrong trade: UAT found the
 * simplification was not a limitation at the edges but an INCORRECT ANSWER in
 * the middle — with "off from the 24th" as the current rule, the RPC reported
 * not-enabled for the 22nd and 23rd while the ledger rounded them. Resolving
 * the rules properly was the only fix, so `round_up_state_for` now walks them
 * (20260922060000) and a backdated shop resolves against the rule that
 * governed it.
 *
 * A FUTURE date is still never rounded, and that guard is duplicated in the
 * RPC so it cannot be lost: a forward-dated shop books as `pending`, and the
 * switch may change before it happens.
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
  if (args.spendDate > args.today) return false
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
 * `skipped` is the person tapping "Leave it at £7.50" on the step, and it is
 * RETURNED for storing — not just used and discarded.
 *
 * 🚨 IT HAS TO BE STORED, and the first version of this file argued otherwise.
 * The argument was: the ledger recomputes rounding every time a row is saved,
 * so an opt-out THERE has to survive an edit (§1.19d-2), while a Listly
 * completion is written once and never recomputed. True of the completion —
 * and false of the TRANSACTION it becomes. The row is shared, and the ledger
 * recomputes it on every save. Found in UAT 2026-09-22: a declined £4.25
 * showed as "will round" in the ledger's form, and correcting that row's note
 * would have booked it at £5.00. §1.19d-2's rule reaches across the app
 * boundary.
 *
 * 🚨 ONLY AN EXPLICIT DECLINE SETS IT. A shop that did not round for any other
 * reason — joint, pot, exact pound, backdated, or booked offline with no known
 * setting — leaves it `false`, because the person declined nothing. Marking
 * those would over-claim a decision, and would stop the ledger rounding a row
 * it is entitled to round when the person later edits it there.
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
): { amount: number; roundedFrom: number | null; roundingPotId: string | null; roundUpSkipped: boolean } {
  const price = round2(args.amount)
  const couldRound = roundUpApplies({ ...args, amount: price }, state)
  if (args.skipped || !couldRound) {
    // `couldRound` is what separates "declined" from "never offered": the
    // flag is true only when the step was really on screen and the person
    // said no to it.
    return { amount: price, roundedFrom: null, roundingPotId: null, roundUpSkipped: couldRound && !!args.skipped }
  }
  return { amount: roundUpTarget(price), roundedFrom: price, roundingPotId: state.jarPotId, roundUpSkipped: false }
}
