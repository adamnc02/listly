/**
 * verify-shop-round-up — which Listly shops round up, and into whose jar.
 *
 * The bug this prevents, found by Adam on 2026-09-21 and verified in the code
 * the same day: the ledger rounds a personal card expense up to the next
 * pound and puts the uplift in that person's Coin Jar, but Listly's bridge
 * inserted its transaction directly in SQL with `rounded_from` not in the
 * column list at all. So the SAME £7.50 shop was £8.00 with 50p in the jar
 * from the ledger app, and £7.50 with nothing from Listly — silently, and
 * only on PERSONAL card shops, which is why it went unnoticed: joint is the
 * default.
 *
 * The second bug it prevents is the fix going too far: rounding a joint shop,
 * a pot shop, an exact pound, or a BACKDATED shop (Adam, 2026-09-21: a
 * backdated Listly shop does not round, deliberately, so that no second
 * implementation of the ledger's dated on/off history walk exists in SQL to
 * drift from the TypeScript one).
 *
 *   TZ=Europe/London npx tsx scripts/verify-shop-round-up.ts
 */
import { ROUND_UP_OFF, roundUpApplies, roundUpTarget, roundUpUplift, shopRoundUpFields, type RoundUpState } from '../src/lib/roundUp'
import type { LocationOption } from '../src/types'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

const TODAY = '2026-09-21'
const YESTERDAY = '2026-09-20'
const TOMORROW = '2026-09-22'

const personal = (ownerId: string): LocationOption => ({
  key: `personal:${ownerId}`, label: 'Current Account', location: 'personal', ownerId, potId: '', ownerName: '',
})
const joint: LocationOption = { key: 'joint', label: 'Joint account', location: 'joint', ownerId: '', potId: '', ownerName: '' }
const pot: LocationOption = { key: 'pot:p1', label: 'Holiday fund', location: 'pot', ownerId: 'adam', potId: 'p1', ownerName: '' }

const adamOn: RoundUpState = { enabled: true, jarPotId: 'jar-adam' }
const ellaOn: RoundUpState = { enabled: true, jarPotId: 'jar-ella' }
const noJar: RoundUpState = { enabled: true, jarPotId: '' }

const applies = (amount: number, location: LocationOption | null, state: RoundUpState, spendDate = TODAY) =>
  roundUpApplies({ amount, location, spendDate, today: TODAY }, state)

// ── the arithmetic ────────────────────────────────────────────────────────
check('£7.50 rounds to £8.00', roundUpTarget(7.5) === 8)
check('the uplift is 50p', roundUpUplift(7.5) === 0.5)
check('£8.00 stays £8.00', roundUpTarget(8) === 8 && roundUpUplift(8) === 0)
check('£7.99 rounds to £8.00, 1p uplift', roundUpTarget(7.99) === 8 && roundUpUplift(7.99) === 0.01)
// The round2-first rule: float noise must not buy a whole extra pound.
check('7.500000000000001 rounds to £8.00, NOT £9.00', roundUpTarget(7.500000000000001) === 8)
check('0.1 + 0.2 spent as 0.30000000000000004 rounds to £1', roundUpTarget(0.1 + 0.2) === 1)

// ── what rounds ───────────────────────────────────────────────────────────
check('a personal card shop, rounding on, fractional → rounds', applies(7.5, personal('adam'), adamOn))
check('🚨 an EXACT POUND does not round', !applies(8, personal('adam'), adamOn))
check('🚨 a JOINT shop does not round', !applies(7.5, joint, adamOn))
check('🚨 a POT shop does not round', !applies(7.5, pot, adamOn))
check('no location picked yet → does not round', !applies(7.5, null, adamOn))
check('rounding switched off → does not round', !applies(7.5, personal('adam'), ROUND_UP_OFF))
check('🚨 switch on but NO COIN JAR → does not round', !applies(7.5, personal('adam'), noJar))
// 🚨 CHANGED 2026-09-22, after UAT. A backdated shop now DOES round, resolved
// against the rule that governed its own date — the RPC walks the dated rules
// the way the ledger does. The old today-only rule was not a limitation at the
// edges, it was an incorrect answer in the middle: with "off from the 24th" as
// the current rule, the 22nd and 23rd read as not-enabled while the ledger
// rounded them. Adam, 2026-09-22: "it needs to resolve, but for today or
// before only, never in the future."
check('a BACKDATED shop rounds, if rounding was on for THAT date', applies(7.5, personal('adam'), adamOn, YESTERDAY))
check('🚨 a FUTURE-dated shop never rounds — it books as pending and the switch may change',
  !applies(7.5, personal('adam'), adamOn, TOMORROW))
// The server says the same thing independently: round_up_state_for returns
// false for any date after London today, whatever the rules say. Two guards,
// because the app's can be forgotten by a future caller and the RPC's cannot.

// 🚨 THE CONTROL. Dropping the `location === 'personal'` clause must make
// the joint case round — otherwise the clause above is not doing any work
// and this file would pass on a broken implementation.
const withoutLocationClause = (amount: number, location: LocationOption | null, state: RoundUpState) =>
  state.enabled && state.jarPotId !== '' && location !== null && roundUpUplift(amount) > 0
check(
  'CONTROL: without the personal-only clause, a joint shop WOULD round',
  withoutLocationClause(7.5, joint, adamOn) && !applies(7.5, joint, adamOn),
)
// And the same for the date clause, which is the deliberate limitation.
const withoutDateClause = (amount: number, location: LocationOption | null, state: RoundUpState) =>
  state.enabled && state.jarPotId !== '' && location?.location === 'personal' && roundUpUplift(amount) > 0
check(
  'CONTROL: without the future clause, a tomorrow-dated shop WOULD round',
  withoutDateClause(7.5, personal('adam'), adamOn) && !applies(7.5, personal('adam'), adamOn, TOMORROW),
)

// ── whose jar ─────────────────────────────────────────────────────────────
// 🚨 The OWNER of the picked location, never the signed-in user. Ella's
// Current Account shop, booked on Adam's phone, feeds ELLA's jar.
const ellaShop = shopRoundUpFields({ amount: 7.5, location: personal('ella'), spendDate: TODAY, today: TODAY }, ellaOn)
check('Ella’s Current Account shop feeds Ella’s jar', ellaShop.roundingPotId === 'jar-ella')
const adamShop = shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TODAY, today: TODAY }, adamOn)
check('Adam’s feeds Adam’s', adamShop.roundingPotId === 'jar-adam')

// ── what gets stored ──────────────────────────────────────────────────────
check('amount is the ROUNDED figure', adamShop.amount === 8)
check('roundedFrom is the REAL price', adamShop.roundedFrom === 7.5)
check('the uplift is exactly 50p', Number(((adamShop.amount) - (adamShop.roundedFrom ?? 0)).toFixed(2)) === 0.5)

// 🚨 BOTH, OR NEITHER. A half-set pair violates the CHECK on both tables,
// and a violated CHECK under PowerSync is a write DISCARDED with no error.
const pairOk = (f: { roundedFrom: number | null; roundingPotId: string | null }) =>
  (f.roundedFrom === null) === (f.roundingPotId === null)
const everyCase = [
  shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TODAY, today: TODAY }, adamOn),
  shopRoundUpFields({ amount: 8, location: personal('adam'), spendDate: TODAY, today: TODAY }, adamOn),
  shopRoundUpFields({ amount: 7.5, location: joint, spendDate: TODAY, today: TODAY }, adamOn),
  shopRoundUpFields({ amount: 7.5, location: pot, spendDate: TODAY, today: TODAY }, adamOn),
  shopRoundUpFields({ amount: 7.5, location: null, spendDate: TODAY, today: TODAY }, adamOn),
  shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: YESTERDAY, today: TODAY }, adamOn),
  shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TODAY, today: TODAY }, noJar),
  shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TODAY, today: TODAY }, ROUND_UP_OFF),
  shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TODAY, today: TODAY, skipped: true }, adamOn),
]
check('🚨 every case writes both fields or neither', everyCase.every(pairOk))

// A shop that does not round stores the real price in `amount`, untouched.
const jointShop = shopRoundUpFields({ amount: 7.5, location: joint, spendDate: TODAY, today: TODAY }, adamOn)
check('a joint shop books £7.50 with no pair', jointShop.amount === 7.5 && jointShop.roundedFrom === null)

// ── "don't round this one", and the flag that has to survive it ───────────
const skipped = shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TODAY, today: TODAY, skipped: true }, adamOn)
check('tapping “leave it” books the real price, no jar', skipped.amount === 7.5 && skipped.roundingPotId === null)
check('and the step is still OFFERED, so it can be undone', applies(7.5, personal('adam'), adamOn))

// 🚨 THE UAT 2026-09-22 BUG. The flag is what stops the LEDGER — which
// recomputes rounding on every save — booking this row at £8.00 the next time
// the person edits its note. Without it, a declined £7.50 ratchets up.
check('🚨 a decline is RECORDED, not just obeyed', skipped.roundUpSkipped === true)
const notSkipped = shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TODAY, today: TODAY }, adamOn)
check('a shop that DID round records no decline', notSkipped.roundUpSkipped === false)

// 🚨 ONLY AN EXPLICIT DECLINE. Everything that simply could not round leaves
// the flag false — the person declined nothing, and marking it would stop the
// ledger rounding a row it is entitled to round when they later edit it there.
const neverOffered: [string, ReturnType<typeof shopRoundUpFields>][] = [
  ['a joint shop', shopRoundUpFields({ amount: 7.5, location: joint, spendDate: TODAY, today: TODAY, skipped: true }, adamOn)],
  ['a pot shop', shopRoundUpFields({ amount: 7.5, location: pot, spendDate: TODAY, today: TODAY, skipped: true }, adamOn)],
  ['an exact pound', shopRoundUpFields({ amount: 8, location: personal('adam'), spendDate: TODAY, today: TODAY, skipped: true }, adamOn)],
  ['a FUTURE-dated shop', shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TOMORROW, today: TODAY, skipped: true }, adamOn)],
  ['rounding switched off', shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TODAY, today: TODAY, skipped: true }, ROUND_UP_OFF)],
  ['no Coin Jar', shopRoundUpFields({ amount: 7.5, location: personal('adam'), spendDate: TODAY, today: TODAY, skipped: true }, noJar)],
]
for (const [name, fields] of neverOffered) {
  check(`🚨 ${name} records NO decline, even with the flag set`, fields.roundUpSkipped === false)
}

// ── the pennies ───────────────────────────────────────────────────────────
// The keypad can produce a float tail; the ledger column is numeric and a
// tail is real money in a real account.
const tail = shopRoundUpFields({ amount: 0.1 + 0.2, location: personal('adam'), spendDate: TODAY, today: TODAY }, adamOn)
check('a float tail is settled to the penny before storing', tail.roundedFrom === 0.3 && tail.amount === 1)

console.log(failed === 0 ? '\nAll round-up rules hold.' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
