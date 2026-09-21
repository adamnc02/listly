import { supabase } from './supabaseClient'
import { decidePushState, type PushState } from './pushState'

export type { PushState }

/**
 * Web Push, the browser half. The server half is silver-octo-invention's
 * `listly-reminders` Edge Function and `20260921090000_listly_reminders`.
 *
 * 🚨 PUSH IS THE ONLY REMINDER THERE IS. Email was dismissed on 2026-09-21
 * (Adam: no domain, no paid plan). So a phone that cannot receive push gets
 * no reminder at all — only the in-app banners — and the Settings section
 * has to make that visible, per device, rather than look the same as a
 * phone that works. `pushState()` is what it reads.
 *
 * 🚨 iOS: push exists ONLY in the Home Screen app, never in a Safari tab, and
 * permission can only be asked from a real tap. Once denied it cannot be
 * re-asked from the web at all — only in the iPhone's Settings → Notifications
 * → Listly. So nothing here ever asks on load.
 *
 * `push_subscriptions` is written over REST (not PowerSync: it is not synced,
 * and not in the publication). Its id is DERIVED from the endpoint, so
 * registering the same browser twice updates one row instead of making two
 * (MIGRATION-LESSONS §36).
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
const SW_URL = `${import.meta.env.BASE_URL}sw.js`

export function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  )
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * Registered on every boot, not only when reminders are turned on, so a
 * changed sw.js reaches every device on its next launch. It has no fetch
 * handler and caches nothing (see public/sw.js), so it cannot pin an old
 * build. A failure is logged, never thrown: push is a feature, not the app.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker
    .register(SW_URL, { scope: import.meta.env.BASE_URL })
    .catch((e: unknown) => console.error('[listly] service worker registration failed:', e))
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  if (existing) return existing
  return navigator.serviceWorker.register(SW_URL, { scope: import.meta.env.BASE_URL })
}

async function localSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** A row id that is a function of the endpoint (§36). */
async function idFor(endpoint: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))
  return 'ps_' + Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** This device's row id, or null if it has no push subscription locally. */
export async function thisDeviceId(): Promise<string | null> {
  const sub = await localSubscription()
  return sub ? idFor(sub.endpoint) : null
}

/**
 * The state the Settings section shows. `registeredIds` is the account's
 * rows from `push_subscriptions`: a device only counts as "on" when the
 * server has it too — a local subscription whose row was removed from
 * another device, or pruned as dead, reminds nobody.
 */
export async function pushState(registeredIds: string[]): Promise<PushState> {
  const ok = supported()
  return decidePushState({
    ios: isIos(),
    standalone: isStandalone(),
    supported: ok,
    permission: ok ? Notification.permission : 'default',
    hereId: ok ? await thisDeviceId() : null,
    registeredIds,
  })
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function b64url(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'This browser'
}

/**
 * 🚨 MUST be called from a tap. It asks for permission (iOS will not show
 * the prompt otherwise, and there is no second chance once it is denied),
 * subscribes, and registers this device. Throws a sentence a person can act
 * on; never fails silently.
 */
export async function turnOnHere(): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error('This build has no VITE_VAPID_PUBLIC_KEY, so it cannot register for reminders.')
  if (!supported()) throw new Error('This browser cannot show notifications.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications were turned off. Listly cannot ask again — turn them on in Settings → Notifications → Listly.'
        : 'No answer was given, so nothing was turned on. Tap again when you are ready.',
    )
  }

  const reg = await registration()
  await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }))

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      id: await idFor(sub.endpoint),
      endpoint: sub.endpoint,
      p256dh: b64url(sub.getKey('p256dh')),
      auth_key: b64url(sub.getKey('auth')),
      device_label: deviceLabel(),
      failed_count: 0,
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`Couldn't register this device: ${error.message}`)
}

/** Unregister this device: the server row, and the browser's subscription. */
export async function turnOffHere(): Promise<void> {
  const sub = await localSubscription()
  if (!sub) return
  const { error } = await supabase.from('push_subscriptions').delete().eq('id', await idFor(sub.endpoint))
  if (error) throw new Error(`Couldn't turn reminders off: ${error.message}`)
  await sub.unsubscribe()
}

export interface Device {
  id: string
  label: string
  createdAt: string
  lastOkAt: string | null
  failedCount: number
}

export async function listDevices(): Promise<Device[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, device_label, created_at, last_ok_at, failed_count')
    .order('created_at')
  if (error) throw new Error(`Couldn't load your devices: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    label: r.device_label ? String(r.device_label) : 'A device',
    createdAt: String(r.created_at),
    lastOkAt: r.last_ok_at ? String(r.last_ok_at) : null,
    failedCount: Number(r.failed_count ?? 0),
  }))
}

/** Remove any of this account's devices. If it is THIS one, unsubscribe too. */
export async function removeDevice(id: string): Promise<void> {
  if (id === (await thisDeviceId())) return turnOffHere()
  const { error } = await supabase.from('push_subscriptions').delete().eq('id', id)
  if (error) throw new Error(`Couldn't remove it: ${error.message}`)
}

/** "Send me a test reminder": every one of this account's devices, now. */
export async function sendTest(): Promise<{ devices: number; sent: number; gone: number; failed: number }> {
  const { data, error } = await supabase.functions.invoke('listly-reminders', { body: { mode: 'test' } })
  if (error) throw new Error(`The test couldn't be sent: ${error.message}`)
  return data as { devices: number; sent: number; gone: number; failed: number }
}

/**
 * On sign-out: this phone should stop getting this account's reminders
 * (Adam, 2026-09-21) — otherwise someone else signing in here would be sent
 * them. Best effort: signing out must never be blocked by it, offline or not.
 */
export async function forgetThisDevice(): Promise<void> {
  try {
    await turnOffHere()
  } catch (e) {
    console.error('[listly] could not unregister this device on sign-out:', e)
  }
}
