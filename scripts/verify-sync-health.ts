/**
 * verify-sync-health — the header dot and the Sync check panel's one answer.
 *
 * The bug this prevents (Adam, 2026-09-21, screenshot): the dot said "Sync
 * failed" while the panel said "All good" and every check was green —
 * connected, last synced 08:08:30. PowerSync was carrying a STALE uploadError:
 * it clears that only after a successful upload, so a hiccup on the
 * "nothing left, ask for a checkpoint" step leaves it set with an empty queue
 * for as long as the app is open. The dot treated any error as a failure; the
 * panel only looked at errors while disconnected. Both are now one function.
 *
 *   TZ=Europe/London npx tsx scripts/verify-sync-health.ts
 */
import { syncHealth, type SyncFacts } from '../src/lib/syncHealth'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

const healthy: SyncFacts = {
  connected: true, connecting: false, hasSynced: true, downloading: false, uploading: false,
  waiting: 0, lastSyncedAt: new Date('2026-09-21T07:08:30Z'),
}
const h = (f: Partial<SyncFacts>) => syncHealth({ ...healthy, ...f })
const tone = (f: Partial<SyncFacts>, want: string, name: string) => {
  const got = h(f)
  check(name, got.tone === want, `got ${got.tone} "${got.label}"`)
}

// ── The reported case ────────────────────────────────────────────────────
const reported = h({ uploadError: new Error('TypeError: Load failed') })
check('🚨 Adam\'s screenshot: connected, synced 08:08:30, stale upload error, NOTHING waiting → all good',
  reported.tone === 'ok' && reported.label === null, `got ${reported.tone} "${reported.label}"`)
check('…and it says so in words', reported.headline === 'Everything is synced', reported.headline)

// ── Upload errors matter only while something waits ──────────────────────
const stuck = h({ uploadError: new Error('new row violates row-level security policy'), waiting: 2 })
check('an upload error WITH changes waiting → a problem', stuck.tone === 'problem' && stuck.label === 'Not syncing',
  `got ${stuck.tone}`)
check('…which names how many and that they are safe', /2 changes not sent yet/.test(stuck.headline) && /saved on this phone/.test(stuck.detail),
  `${stuck.headline} / ${stuck.detail}`)
tone({ waiting: 1, uploading: true }, 'busy', 'changes waiting with no error → Syncing…')
tone({ waiting: null, uploadError: new Error('x') }, 'ok', 'queue not counted yet → do not cry wolf')

// ── Download errors are current (PowerSync clears them on each sync) ─────
tone({ downloadError: new Error('PSYNC_S2106 Authentication required 401') }, 'problem', 'connected but the server refuses → problem')
check('…with an action a person can take', /sign out and back in/i.test(h({ downloadError: new Error('401') }).detail))

// ── Offline is fine ──────────────────────────────────────────────────────
tone({ connected: false }, 'offline', 'not connected, has synced before → Offline')
tone({ connected: false, downloadError: new Error('Load failed') }, 'offline', 'a network error while offline → Offline, not a failure')
check('offline mentions what is waiting', /3 changes on this phone will send/.test(h({ connected: false, waiting: 3 }).detail))

// ── Before the first sync there is nothing to be offline about ───────────
tone({ connected: false, hasSynced: false }, 'connecting', 'never synced → Connecting…, never Offline')
tone({ connected: false, connecting: true }, 'connecting', 'reconnecting → Connecting…')
tone({ downloading: true }, 'busy', 'downloading → Syncing…')
tone({}, 'ok', 'healthy → the quiet dot')

// ── Control: the old dot ─────────────────────────────────────────────────
const oldDot = (f: SyncFacts) => (f.downloadError ?? f.uploadError ? 'Sync failed' : null)
check('control: the old rule WOULD have said "Sync failed" for the reported state',
  oldDot({ ...healthy, uploadError: new Error('Load failed') }) === 'Sync failed')

if (failed) {
  console.log(`FAIL: ${failed} check(s)`)
  process.exit(1)
}
console.log('All checks passed')
