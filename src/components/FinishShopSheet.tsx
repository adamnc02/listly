import { useState } from 'react'
import { useListly, type ShopSnapshot } from '../context/ListlyContext'
import { defaultCategoryId } from '../lib/powersync/ledger'
import { useRoundUpState } from '../lib/powersync/roundUpState'
import { roundUpApplies, roundUpTarget, roundUpUplift, shopRoundUpFields } from '../lib/roundUp'
import { useHouseholdId } from './SyncRoot'
import { todayIso } from '../lib/date'
import { Sheet } from './Sheet'
import type { IsoDate, LocationOption } from '../types'

/**
 * "Price this shop" (PROMPT-01 §8.2a / D10).
 *
 * Three steps — amount, date, location — then Save. A list with no category
 * gets a step at the FRONT, once ever, and the answer is saved back onto the
 * list (§8.2d), so the normal case stays three.
 *
 * 🚨 A ROUND-UP STEP IS APPENDED, and only when rounding would really apply
 * (PROMPT-05): a Current Account shop, dated today, for a person whose
 * round-ups are on and who has a Coin Jar, where the amount is not already a
 * whole pound. Adam, 2026-09-21: "as soon as the location is picked … check
 * if rounding is on, and apply it, and add the step to the picker flow to
 * match transactions entries."
 *
 * When it does not apply it shows NOTHING — an always-present step that
 * sometimes says "not rounding" is worse than no step at all. The step
 * appearing and disappearing as the location or date changes IS the feature
 * telling the truth: a joint shop, a pot shop and a BACKDATED shop do not
 * round, deliberately.
 *
 * 🚨 Most of a transaction is NOT a decision anyone wants to make at the
 * till. `type` is always expense, `direction` always out, `payment_method`
 * always card, `note` is the list name verbatim, and `owner_id`/`pot_id`
 * come from the location picked. None of those has UI, deliberately.
 *
 * 🚨 THERE ARE THREE WAYS OUT, AND THEY DO DIFFERENT THINGS.
 *
 *   Save              → writes the completion row, then clears the ticked
 *                       items and collapses the list.
 *   "Don't price it"  → clears the ticked items and collapses the list, and
 *                       writes NO completion row. Finishing a shop without
 *                       telling the ledger about it is a legitimate outcome.
 *   Cancel            → swipe down, tap the dimmed area, or press Escape.
 *                       NOTHING happens. The list is exactly as it was, same
 *                       items ticked and unticked, still open.
 *
 * 🚨 That last one is why this sheet no longer deletes anything on open
 * (Adam, 2026-09-20: there was no way out of Finish shop without losing the
 * ticked items). It is NOT implemented as an undo: re-inserting the items
 * would mint new ids, and invariant 1 says an item's identity must stay
 * stable or two devices never converge on it. Nothing is deleted until the
 * outcome is known, so cancel is the absence of an action rather than the
 * reversal of one — which means it cannot fail, and it survives the app
 * being killed mid-sheet.
 *
 * 🚨 Every date goes through src/lib/date.ts. `<input type="date">` speaks
 * 'YYYY-MM-DD', which is exactly IsoDate, so nothing here ever calls
 * `new Date(iso)` or `.toISOString().slice(0,10)` — both are live bugs the
 * ledger has already paid for.
 */
export function FinishShopSheet({
  shop,
  onCancel,
  onComplete,
}: {
  shop: ShopSnapshot
  /** Swipe, scrim or Escape. Changes nothing at all. */
  onCancel: () => void
  /** Save, or "Don't price it": the shop really is finished. Save passes the
   *  completion row's id; "Don't price it" passes null, because nothing went
   *  to the ledger and so there is nothing to confirm. */
  onComplete: (completionId: string | null) => void
}) {
  const { categories, locationOptions, saveShopCompletion } = useListly()
  const householdId = useHouseholdId()

  // Asked once, ever: only a list that has never had a category sees it.
  const needsCategory = shop.categoryId === ''

  const [categoryId, setCategoryId] = useState(
    () => shop.categoryId || defaultCategoryId(categories, householdId),
  )
  const [amountText, setAmountText] = useState('')
  const [spendDate, setSpendDate] = useState<IsoDate>(() => todayIso())
  // 🚨 With no joint_account row, "Joint account" is not offered at all and
  // the first Current Account is the default. ensure_household() seeds no
  // joint account, so that is the normal solo case, not an edge case.
  const [location, setLocation] = useState<LocationOption | null>(() => locationOptions[0] ?? null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The person's answer on the round-up step. Pre-picked to round, the way
  // the ledger's own wizard pre-picks it.
  //
  // 🚨 IT IS STORED, on `shop_completions.round_up_skipped`, and carried into
  // the ledger row. The first build did not store it, reasoning that a
  // completion is never recomputed — true, but the TRANSACTION it becomes is
  // recomputed in the ledger on every save (APP-KNOWLEDGE §1.19d-2). UAT on
  // 2026-09-22 found a declined £4.25 showing as "will round" there, one
  // unrelated edit away from being booked at £5.00.
  const [skipRounding, setSkipRounding] = useState(false)

  // Two decimals, and nothing a person could not have meant. A blank or
  // zero amount is not a priced shop, so Continue stays muted rather than
  // silently doing nothing — the same rule every other control in this app
  // follows.
  const amount = Number.parseFloat(amountText.replace(/[^0-9.]/g, ''))
  const amountValid = Number.isFinite(amount) && amount > 0

  // 🚨 THE OWNER OF THE PICKED LOCATION, never the signed-in user. In a
  // two-person household Ella's Current Account shop rounds into ELLA's jar,
  // gated on HER switch (§1.19d, PROMPT-05 trap 3). '' makes no call at all.
  const roundUpOwnerId = location?.location === 'personal' ? location.ownerId : ''
  const roundUpState = useRoundUpState(roundUpOwnerId, spendDate)
  const rounds =
    amountValid &&
    roundUpApplies({ amount, location, spendDate, today: todayIso() }, roundUpState)
  const roundedTo = amountValid ? roundUpTarget(amount) : 0
  const uplift = amountValid ? roundUpUplift(amount) : 0
  const jarOwner = location?.ownerName ?? ''

  // Not memoised: it is four strings, and the round-up step's presence
  // depends on the amount, the date, the location and the ledger's answer —
  // a dependency list long enough to be wrong is worse than rebuilding an
  // array of four strings on a render.
  const steps = [
    ...(needsCategory ? (['category'] as const) : []),
    'amount',
    'date',
    'location',
    ...(rounds ? (['round_up'] as const) : []),
  ] as const
  const [stepIndex, setStepIndex] = useState(0)
  // The round-up step can vanish under an open sheet — picking a pot after
  // picking a Current Account, say — so the index is clamped on read rather
  // than trusted. Reading past the end would render a blank sheet with a
  // dead Save button.
  const step = steps[Math.min(stepIndex, steps.length - 1)]

  const canContinue =
    (step === 'category' && categoryId !== '') ||
    (step === 'amount' && amountValid) ||
    step === 'date' ||
    (step === 'location' && location !== null) ||
    step === 'round_up'
  const isLastStep = step === steps[steps.length - 1]

  const next = () => {
    if (!canContinue) return
    setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  }
  const back = () => setStepIndex((i) => Math.max(i - 1, 0))

  const save = () => {
    if (!location || !amountValid || saving) return
    setSaving(true)
    setError(null)
    // 🚨 ONE call decides the amount and the pair together, so a rounded
    // shop can never be saved with a missing jar id (or the reverse) — that
    // pair violates a CHECK, and a violated CHECK is a write PowerSync
    // silently DISCARDS (§27). It is also where the pennies are settled:
    // the ledger column is numeric and a 0.1+0.2 tail would be real money
    // in a real account.
    //
    // What goes in `amount` is what the sheet just showed: £8.00 when it
    // rounded, £7.50 when it did not.
    const fields = shopRoundUpFields(
      { amount, location, spendDate, today: todayIso(), skipped: skipRounding },
      roundUpState,
    )
    void saveShopCompletion({
      listId: shop.listId,
      listName: shop.listName,
      itemsSnapshot: shop.itemsSnapshot,
      itemsLeft: shop.itemsLeft,
      categoryId,
      amount: fields.amount,
      spendDate,
      location,
      roundedFrom: fields.roundedFrom,
      roundingPotId: fields.roundingPotId,
      roundUpSkipped: fields.roundUpSkipped,
    })
      .then((id) => onComplete(id))
      .catch((e: unknown) => {
        setSaving(false)
        setError(`Couldn't save it: ${e instanceof Error ? e.message : String(e)}`)
      })
  }

  const stepNumber = stepIndex + 1

  return (
    <Sheet label="Price this shop" onClose={onCancel}>
      <div className="pagehead" style={{ padding: 0 }}>
        <h2>{shop.listName || 'This shop'}</h2>
        <span className="sub">
          Step {stepNumber} of {steps.length}
        </span>
      </div>

      {step === 'category' && (
        <>
          <div className="lbl">What kind of spend is this?</div>
          <p className="help">
            Asked once. It is saved onto {shop.listName || 'this list'}, so next time goes straight
            to the amount.
          </p>
          <div className="chips">
            {categories.map((c) => (
              <button
                key={c.id}
                aria-pressed={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          {categories.length === 0 && (
            <p className="help">No categories have synced yet. Try again in a moment.</p>
          )}
        </>
      )}

      {step === 'amount' && (
        <>
          <div className="lbl">How much was it?</div>
          <div className="amountrow">
            <span className="cur" aria-hidden="true">
              £
            </span>
            <input
              className="field amount"
              // The phone's number pad, with a decimal point. `type="number"`
              // would bring a spinner and browser-specific parsing; this is
              // the keypad without either.
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') next()
              }}
              placeholder="0.00"
              aria-label="Amount in pounds"
              autoFocus
            />
          </div>
          <p className="help">This is all that reaches the ledger — never what you bought.</p>
        </>
      )}

      {step === 'date' && (
        <>
          <div className="lbl">When?</div>
          <input
            className="field"
            type="date"
            value={spendDate}
            onChange={(e) => setSpendDate(e.target.value as IsoDate)}
            aria-label="Date of the shop"
          />
          <p className="help">
            {spendDate === todayIso() ? 'Today.' : 'A date in the future books as pending.'}
          </p>
        </>
      )}

      {step === 'location' && (
        <>
          <div className="lbl">Paid from</div>
          <div className="chips">
            {locationOptions.map((o) => (
              <button key={o.key} aria-pressed={location?.key === o.key} onClick={() => setLocation(o)}>
                {o.label}
              </button>
            ))}
          </div>
          {locationOptions.length === 0 && (
            <p className="help">
              No accounts have synced yet, so this shop cannot be booked. Close this and try again
              in a moment — nothing is lost.
            </p>
          )}
          <p className="help">
            Saves £{amountValid ? amount.toFixed(2) : '0.00'} to your ledger as
            {' “'}
            {shop.listName}
            {'”'}.
          </p>
        </>
      )}

      {step === 'round_up' && (
        <>
          <div className="lbl">Round it up?</div>
          <p className="help">
            {jarOwner ? `${jarOwner} rounds` : 'You round'} Current Account spending up to the next
            pound, and the difference goes to {jarOwner ? `${jarOwner}’s` : 'your'} Coin Jar.
          </p>
          <div className="chips">
            <button aria-pressed={!skipRounding} onClick={() => setSkipRounding(false)}>
              Round up to £{roundedTo.toFixed(2)}
            </button>
            <button aria-pressed={skipRounding} onClick={() => setSkipRounding(true)}>
              Leave it at £{amount.toFixed(2)}
            </button>
          </div>
          <p className="help">
            {skipRounding
              ? `£${amount.toFixed(2)} goes to your ledger, and nothing to the Coin Jar.`
              : `£${roundedTo.toFixed(2)} goes to your ledger, remembering you spent £${amount.toFixed(2)}. ` +
                `£${uplift.toFixed(2)} lands in the Coin Jar.`}
          </p>
        </>
      )}

      {error && (
        <p className="help" style={{ color: 'var(--red)' }} role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        {stepIndex > 0 ? (
          <button className="btn ghost" onClick={back}>
            Back
          </button>
        ) : (
          // Finishes the shop WITHOUT a ledger entry — deliberately distinct
          // from cancelling, which changes nothing.
          <button className="btn ghost" onClick={() => onComplete(null)}>
            Don’t price it
          </button>
        )}
        <div style={{ flex: 1 }} />
        {isLastStep ? (
          <button
            className={`btn brown${location && amountValid && !saving ? '' : ' waiting'}`}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        ) : (
          <button className={`btn brown${canContinue ? '' : ' waiting'}`} onClick={next}>
            Continue
          </button>
        )}
      </div>

      <p className="help" style={{ textAlign: 'center' }}>
        Swipe down to cancel — your list stays exactly as it is, still ticked.
      </p>
    </Sheet>
  )
}
