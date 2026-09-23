/**
 * verify-account-switch — whose data this phone shows after a sign-in.
 *
 * The bug this prevents (Adam, 2026-09-21): "When switching account, the old
 * list remains, it takes several force closes to change". Signing out never
 * cleared PowerSync's local database, so the next account on the phone saw
 * the previous one's lists — and its PRIVATE My jobs — until enough
 * relaunches let its own sync overwrite them.
 *
 *   TZ=Europe/London npx tsx scripts/verify-account-switch.ts
 */
import { accountSwitch } from '../src/lib/accountSwitch'
import { syncNowFinished, type SyncFacts } from '../src/lib/syncHealth'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const ADAM = 'user-adam', ELLA = 'user-ella'

check('🚨 a DIFFERENT account signs in → clear the device first', accountSwitch(ADAM, ELLA, 0) === 'clear')
check('🚨 …even with changes waiting (they belong to the other account, not this one)', accountSwitch(ADAM, ELLA, 3) === 'clear')
check('the same account signs back in → keep its data', accountSwitch(ADAM, ADAM, 0) === 'keep')
check('the same account with unsent changes → keep them, so they send', accountSwitch(ADAM, ADAM, 2) === 'keep')
check('nobody recorded, nothing waiting → clear (unknown data is never shown)', accountSwitch(null, ADAM, 0) === 'clear')
check('nobody recorded but changes waiting → adopt, never throw them away', accountSwitch(null, ADAM, 1) === 'adopt')

// Control: the behaviour this replaces — never clearing — would have kept
// Adam's data on screen for Ella.
const old = () => 'keep'
check('control: the old behaviour WOULD have kept the previous account’s data', old() === 'keep' && accountSwitch(ADAM, ELLA, 0) !== old())

// ── Sync now: finished only when BOTH directions are ──────────────────────
const pressed = new Date('2026-09-21T09:00:00Z')
const done: SyncFacts = {
  connected: true, connecting: false, hasSynced: true, downloading: false, uploading: false,
  waiting: 0, lastSyncedAt: new Date('2026-09-21T09:00:03Z'),
}
const fin = (f: Partial<SyncFacts>) => syncNowFinished({ ...done, ...f }, pressed)
check('sync now: queue empty and a sync completed after the press → finished', fin({}))
check('🚨 …but not while changes are still waiting (push not done)', !fin({ waiting: 1 }))
check('🚨 …and not if the last completed sync was BEFORE the press (pull not done)', !fin({ lastSyncedAt: new Date('2026-09-21T08:59:00Z') }))
check('…nor while downloading or uploading', !fin({ downloading: true }) && !fin({ uploading: true }))
check('…nor while disconnected', !fin({ connected: false }))
check('…nor with a download error', !fin({ downloadError: new Error('401') }))
check('…nor before the queue has been counted', !fin({ waiting: null }))

if (failed) {
  console.log(`FAIL: ${failed} check(s)`)
  process.exit(1)
}
console.log('All checks passed')
