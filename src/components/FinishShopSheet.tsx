import { useMemo, useState } from 'react'
import { useListly, type ShopSnapshot } from '../context/ListlyContext'
import { defaultCategoryId } from '../lib/powersync/ledger'
import { useHouseholdId } from './SyncRoot'
import { todayIso } from '../lib/date'
import { Sheet } from './Sheet'
import type { IsoDate, LocationOption } from '../types'

/**
 * "Price this shop" (PROMPT-01 §8.2a / D10).
 *
 * Three steps — amount, date, location — then Save. A list with no category
 * gets a fourth step at the FRONT, once ever, and the answer is saved back
 * onto the list (§8.2d), so the normal case stays three.
 *
 * 🚨 Most of a transaction is NOT a decision anyone wants to make at the
 * till. `type` is always expense, `direction` always out, `payment_method`
 * always card, `note` is the list name verbatim, and `owner_id`/`pot_id`
 * come from the location picked. None of those has UI, deliberately.
 *
 * 🚨 DISMISSING IS A LEGITIMATE OUTCOME. "Finished the shop, didn't price
 * it" writes NO completion row at all. The ticked items have already gone
 * either way — that happened before this sheet opened, and is what Finish
 * shop has always done.
 *
 * 🚨 Every date goes through src/lib/date.ts. `<input type="date">` speaks
 * 'YYYY-MM-DD', which is exactly IsoDate, so nothing here ever calls
 * `new Date(iso)` or `.toISOString().slice(0,10)` — both are live bugs the
 * ledger has already paid for.
 */
export function FinishShopSheet({
  shop,
  onClose,
}: {
  shop: ShopSnapshot
  onClose: () => void
}) {
  const { categories, locationOptions, saveShopCompletion } = useListly()
  const householdId = useHouseholdId()

  // Asked once, ever: only a list that has never had a category sees it.
  const needsCategory = shop.categoryId === ''
  const steps = useMemo(
    () => [...(needsCategory ? (['category'] as const) : []), 'amount', 'date', 'location'] as const,
    [needsCategory],
  )
  const [stepIndex, setStepIndex] = useState(0)
  const step = steps[stepIndex]

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

  // Two decimals, and nothing a person could not have meant. A blank or
  // zero amount is not a priced shop, so Continue stays muted rather than
  // silently doing nothing — the same rule every other control in this app
  // follows.
  const amount = Number.parseFloat(amountText.replace(/[^0-9.]/g, ''))
  const amountValid = Number.isFinite(amount) && amount > 0

  const canContinue =
    (step === 'category' && categoryId !== '') ||
    (step === 'amount' && amountValid) ||
    step === 'date' ||
    (step === 'location' && location !== null)

  const next = () => {
    if (!canContinue) return
    setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  }
  const back = () => setStepIndex((i) => Math.max(i - 1, 0))

  const save = () => {
    if (!location || !amountValid || saving) return
    setSaving(true)
    setError(null)
    void saveShopCompletion({
      listId: shop.listId,
      listName: shop.listName,
      itemsSnapshot: shop.itemsSnapshot,
      categoryId,
      // Rounded to pennies here rather than trusting whatever the keypad
      // produced: the ledger column is numeric and a 0.1+0.2 tail would be
      // real money in a real account.
      amount: Math.round(amount * 100) / 100,
      spendDate,
      location,
    })
      .then(onClose)
      .catch((e: unknown) => {
        setSaving(false)
        setError(`Couldn't save it: ${e instanceof Error ? e.message : String(e)}`)
      })
  }

  const stepNumber = stepIndex + 1

  return (
    <Sheet label="Price this shop" onClose={onClose}>
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
          <button className="btn ghost" onClick={onClose}>
            Skip
          </button>
        )}
        <div style={{ flex: 1 }} />
        {step === 'location' ? (
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
        Closing this leaves the shop unpriced. Nothing is added to the ledger.
      </p>
    </Sheet>
  )
}
