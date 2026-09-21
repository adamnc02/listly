/**
 * Which reminders state a device is in — pure, so
 * scripts/verify-push-state.ts can prove every case without a phone.
 *
 * 🚨 There is no email fallback (Adam, 2026-09-21), so this decides whether
 * the Settings section tells the truth. The rule it must never break: a
 * device reads 'on' ONLY when the server has its registration too. A local
 * browser subscription whose row was removed from another device, or pruned
 * as dead by the reminder job, reminds nobody — and must say so.
 */
export type PushState =
  /** No service worker / PushManager / Notification at all. */
  | 'unsupported'
  /** An iPhone or iPad, but not opened from the Home Screen. */
  | 'needs-install'
  /** The user said no. Only the phone's own Settings can undo it. */
  | 'denied'
  /** Never asked on this device. */
  | 'ask'
  /** Permission granted, but this device is not registered for reminders. */
  | 'off'
  /** This device is registered and will be reminded. */
  | 'on'

export interface DeviceFacts {
  ios: boolean
  standalone: boolean
  supported: boolean
  permission: 'default' | 'granted' | 'denied'
  /** This browser's own subscription, as a row id — null if it has none. */
  hereId: string | null
  /** This account's rows in push_subscriptions. */
  registeredIds: string[]
}

export function decidePushState(f: DeviceFacts): PushState {
  // First: in a Safari tab on iOS, PushManager does not exist at all, so
  // this has to be asked before "supported" or it would read as a browser
  // that can never do it — when three taps would fix it.
  if (f.ios && !f.standalone) return 'needs-install'
  if (!f.supported) return 'unsupported'
  if (f.permission === 'denied') return 'denied'
  if (f.permission === 'default') return 'ask'
  return f.hereId !== null && f.registeredIds.includes(f.hereId) ? 'on' : 'off'
}
