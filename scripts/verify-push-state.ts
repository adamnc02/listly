/**
 * verify-push-state — what the Reminders section says about this device.
 *
 * The bug this prevents: a phone that will NOT be reminded showing "✓ This
 * iPhone gets reminders". Since 2026-09-21 there is no email fallback (Adam:
 * no domain, no paid plan), so the only thing standing between a job and a
 * missed reminder is this screen telling the truth. Two ways it could lie:
 *
 *   - "on" from the browser's own subscription alone, when the server row is
 *     gone (removed from another device, or pruned by the reminder job after
 *     a 404/410). The phone would look set up and never be reminded.
 *   - An iPhone in a Safari tab read as "unsupported" ("this browser can't"),
 *     when Add to Home Screen is three taps away.
 *
 *   TZ=Europe/London npx tsx scripts/verify-push-state.ts
 */
import { decidePushState, type DeviceFacts } from '../src/lib/pushState'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

const phone: DeviceFacts = {
  ios: true, standalone: true, supported: true, permission: 'granted', hereId: 'ps_here', registeredIds: ['ps_here'],
}
const is = (f: Partial<DeviceFacts>, want: string, name: string) => {
  const got = decidePushState({ ...phone, ...f })
  check(name, got === want, `got ${got}`)
}

is({}, 'on', 'installed, allowed, and the server has this device → on')
is({ registeredIds: [] }, 'off', '🚨 allowed and subscribed locally, but the server row is GONE → off, not on')
is({ registeredIds: ['ps_other'] }, 'off', "🚨 only ANOTHER device is registered → off for this one")
is({ hereId: null }, 'off', 'allowed but no local subscription → off')
is({ permission: 'default' }, 'ask', 'never asked → ask (and only a tap asks)')
is({ permission: 'denied' }, 'denied', 'refused → denied, which only the Settings app can undo')
is({ standalone: false, supported: false }, 'needs-install',
  '🚨 iPhone in a Safari tab (no PushManager there) → needs-install, not "unsupported"')
is({ standalone: false, permission: 'denied' }, 'needs-install', 'a Safari tab says install first, whatever else is true')
is({ ios: false, standalone: false }, 'on', 'a desktop browser needs no install (Chrome/Firefox push works in a tab)')
is({ ios: false, supported: false }, 'unsupported', 'no push support at all → unsupported')

// Control: the naive version this replaces — "on" whenever the browser has a
// subscription — would have called the gone-row phone reminded.
const naive = (f: DeviceFacts) => (f.permission === 'granted' && f.hereId ? 'on' : 'off')
check('control: a local-subscription-only check WOULD say on with the server row gone',
  naive({ ...phone, registeredIds: [] }) === 'on')

if (failed) {
  console.log(`FAIL: ${failed} check(s)`)
  process.exit(1)
}
console.log('All checks passed')
