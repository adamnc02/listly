import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useListly } from '../context/ListlyContext'
import { listDevices, pushState, type PushState } from '../lib/push'
import { cachedShoppingPref, readShoppingPref, writeShoppingPref } from '../lib/pushPrefs'

/**
 * "Notify me about shopping" (Adam, 2026-09-25) — one switch per person, on
 * the Shopping page, covering both "New stuff to buy" and "<List> complete".
 *
 * Two truths it must not blur:
 *   - the SWITCH is about the person, and is saved on the server for all
 *     their phones;
 *   - whether THIS phone can receive anything at all is a separate fact, and
 *     the line under the switch says so when it cannot — a switch showing
 *     "on" on a phone that will never be notified would be a lie (the same
 *     rule as the Reminders section, TECHNICAL.md §22).
 *
 * Hidden in a household of one: there is nobody whose shopping to hear about.
 */
export function ShoppingPushToggle() {
  const { session } = useAuth()
  const { householdSize } = useListly()
  const uid = session?.user?.id ?? ''
  const [on, setOn] = useState<boolean | null>(() => (uid ? cachedShoppingPref(uid) : null))
  const [device, setDevice] = useState<PushState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) return
    let live = true
    readShoppingPref(uid)
      .then((v) => live && setOn(v))
      .catch(() => live && setOn((v) => v ?? true))
    listDevices()
      .then((ds) => pushState(ds.map((d) => d.id)))
      .then((s) => live && setDevice(s))
      .catch(() => live && setDevice('unsupported'))
    return () => {
      live = false
    }
  }, [uid])

  if (!uid || householdSize === 1) return null

  const toggle = (next: boolean) => {
    const before = on
    setOn(next)
    setError(null)
    writeShoppingPref(uid, next).catch((e: unknown) => {
      // Name the failure and put the switch back: a switch that looks
      // changed but was not saved is the lie this component exists to avoid.
      setOn(before)
      setError(`Couldn't save that — ${e instanceof Error ? e.message : String(e)}. Are you offline?`)
    })
  }

  return (
    <div className="card shop-notify">
      <label className="check">
        <input type="checkbox" checked={on ?? true} disabled={on === null} onChange={(e) => toggle(e.target.checked)} />
        Notify me about shopping
      </label>
      <p className="help">When someone adds things to a list, or finishes a shop. On all your phones.</p>
      {device && device !== 'on' && (on ?? true) && (
        <p className="help warn">This device isn’t set up for notifications, so nothing will arrive here — turn them on in Account → Reminders.</p>
      )}
      {error && (
        <p className="help" style={{ color: 'var(--red)' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
