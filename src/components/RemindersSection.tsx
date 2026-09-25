import { useCallback, useEffect, useState } from 'react'
import {
  isIos,
  listDevices,
  pushState,
  removeDevice,
  sendTest,
  thisDeviceId,
  turnOffHere,
  turnOnHere,
  type Device,
  type PushState,
} from '../lib/push'

/**
 * "Reminders" in the Account sheet (PROMPT-04 §2.1).
 *
 * 🚨 THERE IS NO EMAIL FALLBACK (Adam, 2026-09-21). A device that cannot
 * receive push is simply not reminded — only the in-app banners remain. So
 * this section's real job is honesty: a phone that will not be reminded must
 * LOOK like one, never like a phone that will. Every state `pushState()` can
 * return has its own words here, and none of them is a bare button that
 * might fail.
 *
 * 🚨 The permission prompt is only ever raised by the "Turn on" tap. iOS
 * gives no second chance once it is denied, so the section says what the
 * reminder is FOR before the button, and warns that the answer sticks.
 *
 * Order, per §2.1: what it is → the permission button → this account's
 * devices. (The email toggle §2.1 once listed is gone with email.)
 */
type Loaded = { devices: Device[]; hereId: string | null; state: PushState } | { error: string }

async function load(): Promise<Loaded> {
  try {
    const devices = await listDevices()
    return { devices, hereId: await thisDeviceId(), state: await pushState(devices.map((d) => d.id)) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export function RemindersSection() {
  const [state, setState] = useState<PushState | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [hereId, setHereId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reads everything first and applies it in one go, so a half-loaded
  // section never shows "this phone gets reminders" beside an empty list.
  const apply = useCallback((r: Loaded) => {
    if ('error' in r) {
      setError(r.error)
      setState((s) => s ?? 'unsupported')
      return
    }
    setDevices(r.devices)
    setHereId(r.hereId)
    setState(r.state)
  }, [])
  const refresh = useCallback(async () => apply(await load()), [apply])

  useEffect(() => {
    let alive = true
    void load().then((r) => {
      if (alive) apply(r)
    })
    return () => {
      alive = false
    }
  }, [apply])

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label)
    setError(null)
    setNote(null)
    try {
      const msg = await fn()
      if (msg) setNote(msg)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  const device = isIos() ? (/iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone') : 'device'

  const test = () =>
    run('test', async () => {
      const r = await sendTest()
      if (r.devices === 0) return 'No devices are registered, so there was nothing to send to.'
      const parts = [`Sent to ${r.sent} of ${r.devices} ${r.devices === 1 ? 'device' : 'devices'}.`]
      if (r.gone) parts.push(`${r.gone} could no longer be reached and ${r.gone === 1 ? 'was' : 'were'} removed.`)
      if (r.failed) parts.push(`${r.failed} failed — try again in a minute.`)
      return parts.join(' ')
    })

  return (
    <div className="reminders">
      <div className="lbl">Reminders</div>
      <p className="help">
        A job with its bell on sends a notification at <b>8am</b> every day from three days before it’s
        due until it’s ticked done — or whenever you set in the job itself. House jobs remind both of
        you; To-Do only you.
      </p>

      {state === null && <p className="help">Checking this {device}…</p>}

      {state === 'needs-install' && (
        <div className="card reminder-state warn">
          <b>This {device} can’t get reminders yet.</b> They only work when Listly is opened from your
          Home Screen, not from Safari. In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>, and
          leave <b>Open as Web App</b> on. Then open Listly from the new icon and come back here.
        </div>
      )}

      {state === 'unsupported' && (
        <div className="card reminder-state warn">
          <b>This browser can’t show notifications</b>, so it won’t get reminders. The red banners inside
          Listly still show what’s due.
        </div>
      )}

      {state === 'denied' && (
        <div className="card reminder-state warn">
          <b>Notifications are turned off for Listly on this {device}.</b> Listly can’t ask again — turn
          them on in the {device}’s <b>Settings → Notifications → Listly</b>, then come back here.
          <div className="actions">
            <div style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => void run('check', async () => {})}>
              I’ve turned them on
            </button>
          </div>
        </div>
      )}

      {state === 'ask' && (
        <>
          <p className="help">
            Your {device} will ask once. If you tap <b>Don’t Allow</b>, only the {device}’s Settings app
            can undo it.
          </p>
          <div className="actions">
            <div style={{ flex: 1 }} />
            <button
              className={`btn sage${busy ? ' waiting' : ''}`}
              onClick={() => !busy && void run('on', async () => {
                await turnOnHere()
                return `Done — this ${device} will get reminders.`
              })}
            >
              {busy === 'on' ? 'Turning on…' : `Turn on reminders on this ${device}`}
            </button>
          </div>
        </>
      )}

      {state === 'off' && (
        <div className="card reminder-state warn">
          <b>Notifications are allowed, but this {device} isn’t registered</b>, so it won’t be reminded.
          <div className="actions">
            <div style={{ flex: 1 }} />
            <button
              className={`btn sage${busy ? ' waiting' : ''}`}
              onClick={() => !busy && void run('on', async () => {
                await turnOnHere()
                return `Done — this ${device} will get reminders.`
              })}
            >
              {busy === 'on' ? 'Registering…' : `Register this ${device}`}
            </button>
          </div>
        </div>
      )}

      {state === 'on' && (
        <div className="card reminder-state ok">
          <b>✓ This {device} gets reminders.</b>
          <div className="actions">
            <button
              className={`btn ghost${busy ? ' waiting' : ''}`}
              onClick={() => !busy && void run('off', async () => {
                await turnOffHere()
                return `This ${device} won’t get reminders any more.`
              })}
            >
              {busy === 'off' ? 'Turning off…' : 'Turn off here'}
            </button>
            <div style={{ flex: 1 }} />
            <button className={`btn sage${busy ? ' waiting' : ''}`} onClick={() => !busy && void test()}>
              {busy === 'test' ? 'Sending…' : 'Send me a test reminder'}
            </button>
          </div>
        </div>
      )}

      {devices.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 12 }}>Your devices</div>
          <ul className="device-list">
            {devices.map((d) => (
              <li key={d.id}>
                <div className="grow">
                  <div>
                    {d.label}
                    {d.id === hereId && <span className="sub"> · this one</span>}
                  </div>
                  <div className="sub">
                    Added {new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    {d.lastOkAt
                      ? ` · last reminded ${new Date(d.lastOkAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                      : ' · not reminded yet'}
                    {d.failedCount > 0 && ` · ${d.failedCount} failed`}
                  </div>
                </div>
                <button
                  className={`btn danger${busy ? ' waiting' : ''}`}
                  onClick={() => !busy && void run(`rm:${d.id}`, async () => {
                    await removeDevice(d.id)
                    return `${d.label} removed. It won’t be reminded any more.`
                  })}
                >
                  {busy === `rm:${d.id}` ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {devices.length === 0 && state !== null && state !== 'on' && (
        <p className="help">No devices are registered on this account, so nobody is reminded yet.</p>
      )}

      {note && <p className="help" style={{ color: 'var(--sage)' }}>{note}</p>}
      {error && <p className="help" style={{ color: 'var(--red)' }} role="alert">{error}</p>}
    </div>
  )
}
