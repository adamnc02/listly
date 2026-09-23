/**
 * verify-round-up-cache — the last known round-up answer, and what it must
 * never do.
 *
 * The bug this prevents: an empty or unreadable cache reading as "rounding is
 * on". Finish shop has to work standing in a shop with no signal, so the
 * round-up state is remembered on the phone rather than fetched every time
 * (PROMPT-05 §0.3, Adam's decision 2026-09-21). Every way that cache can be
 * empty, stale, corrupt or half-written must therefore land on OFF: a shop
 * that does not round is a visible, fixable annoyance, while a shop that
 * rounds into a jar that is not there is a 23514 the connector discards
 * silently and the shop is gone (§27).
 *
 * The second bug is the §40 one: an answer keyed on the signed-in USER rather
 * than the person. Correct with one person in the household, wrong the moment
 * there are two — Ella's Current Account shop would round into Adam's jar on
 * Adam's phone.
 *
 *   TZ=Europe/London npx tsx scripts/verify-round-up-cache.ts
 */

// A localStorage stand-in, so this runs in node. The real one can also throw
// (a private window, a full store), which is the `throwing` case below.
class MemoryStorage {
  private map = new Map<string, string>()
  constructor(private throws = false) {}
  getItem(k: string): string | null {
    if (this.throws) throw new Error('storage unavailable')
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    if (this.throws) throw new Error('storage unavailable')
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    if (this.throws) throw new Error('storage unavailable')
    this.map.delete(k)
  }
  raw(k: string) { return this.map.get(k) }
  put(k: string, v: string) { this.map.set(k, v) }
}
const store = new MemoryStorage()
;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store

const {
  cachedRoundUpFor, clearRoundUpCache, loadRoundUpCache, pruneRoundUpCache,
  saveRoundUpCache, withRoundUpAnswer,
} = await import('../src/lib/roundUpCache')

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

const KEY = 'listly:round-up-state:v1'

// ── nothing known ─────────────────────────────────────────────────────────
const TODAY = '2026-09-22'
const YESTERDAY = '2026-09-21'
check('🚨 an empty cache reads as OFF', !cachedRoundUpFor({}, 'adam', TODAY).enabled)
check('a person never seen reads as OFF', !cachedRoundUpFor(loadRoundUpCache(), 'nobody', TODAY).enabled)

// ── a real answer ─────────────────────────────────────────────────────────
let cache = withRoundUpAnswer({}, 'adam', TODAY, { enabled: true, jarPotId: 'jar-adam' }, '2026-09-22T10:00:00.000Z')
check('an answer is remembered', cachedRoundUpFor(cache, 'adam', TODAY).jarPotId === 'jar-adam')
check('it survives a save/load round trip', (() => {
  saveRoundUpCache(cache)
  return cachedRoundUpFor(loadRoundUpCache(), 'adam', TODAY).jarPotId === 'jar-adam'
})())

// 🚨 THE DATE IS PART OF THE KEY (2026-09-22). The switch is dated and can be
// changed with a future effective-from, so an answer for one day says nothing
// about another — and a "nearest earlier date" fallback would round a shop on
// the 24th using the answer fetched on the 22nd, which is the very bug that
// forced this rewrite.
check('🚨 today’s answer does NOT answer for yesterday', !cachedRoundUpFor(cache, 'adam', YESTERDAY).enabled)
check('  and each date is remembered separately', (() => {
  const two = withRoundUpAnswer(cache, 'adam', YESTERDAY, { enabled: false, jarPotId: '' })
  return cachedRoundUpFor(two, 'adam', TODAY).enabled && !cachedRoundUpFor(two, 'adam', YESTERDAY).enabled
})())

// ── whose answer ──────────────────────────────────────────────────────────
cache = withRoundUpAnswer(cache, 'ella', TODAY, { enabled: true, jarPotId: 'jar-ella' })
check('🚨 Ella’s answer is Ella’s, and Adam’s is Adam’s',
  cachedRoundUpFor(cache, 'ella', TODAY).jarPotId === 'jar-ella' &&
  cachedRoundUpFor(cache, 'adam', TODAY).jarPotId === 'jar-adam')
check('one person switching off leaves the other alone', (() => {
  const next = withRoundUpAnswer(cache, 'adam', TODAY, { enabled: false, jarPotId: '' })
  return !cachedRoundUpFor(next, 'adam', TODAY).enabled && cachedRoundUpFor(next, 'ella', TODAY).enabled
})())

// ── malformed answers all land on OFF ─────────────────────────────────────
check('🚨 “on” with no jar is read as OFF',
  !cachedRoundUpFor(withRoundUpAnswer({}, 'adam', TODAY, { enabled: true, jarPotId: '' }), 'adam', TODAY).enabled)
check('  and is not even stored as on',
  withRoundUpAnswer({}, 'adam', TODAY, { enabled: true, jarPotId: '' })[`adam|${TODAY}`].enabled === false)
store.put(KEY, '{not json')
check('🚨 unparseable storage reads as an empty cache', Object.keys(loadRoundUpCache()).length === 0)
store.put(KEY, '"a string"')
check('a JSON string, not an object, reads as empty', Object.keys(loadRoundUpCache()).length === 0)
store.put(KEY, '[1,2,3]')
check('an array reads as empty', Object.keys(loadRoundUpCache()).length === 0)
store.put(KEY, JSON.stringify({ [`adam|${TODAY}`]: { enabled: true } }))
check('🚨 a stored entry missing its jar id reads as OFF', !cachedRoundUpFor(loadRoundUpCache(), 'adam', TODAY).enabled)
store.put(KEY, JSON.stringify({ [`adam|${TODAY}`]: { enabled: 'yes', jarPotId: 'jar-adam' } }))
check('a non-boolean “enabled” is not truthy-coerced to on', !cachedRoundUpFor(loadRoundUpCache(), 'adam', TODAY).enabled)

// ── tidying up ────────────────────────────────────────────────────────────
const two = withRoundUpAnswer(withRoundUpAnswer({}, 'adam', TODAY, { enabled: true, jarPotId: 'jar-adam' }), 'ella', TODAY, { enabled: true, jarPotId: 'jar-ella' })
check('a person who has left the household is pruned', (() => {
  const pruned = pruneRoundUpCache(two, ['adam'])
  return `adam|${TODAY}` in pruned && !(`ella|${TODAY}` in pruned)
})())
// One entry per person PER DATE would otherwise grow forever.
check('🚨 entries older than the cut-off are dropped', (() => {
  const old = withRoundUpAnswer(two, 'adam', '2026-01-01', { enabled: true, jarPotId: 'jar-adam' })
  const pruned = pruneRoundUpCache(old, ['adam', 'ella'], '2026-09-01')
  return !('adam|2026-01-01' in pruned) && `adam|${TODAY}` in pruned
})())
check('🚨 a new account on this phone inherits nothing', (() => {
  saveRoundUpCache(two)
  clearRoundUpCache()
  return Object.keys(loadRoundUpCache()).length === 0
})())

// ── storage that throws ───────────────────────────────────────────────────
const throwing = new MemoryStorage(true)
;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = throwing
check('🚨 storage that throws reads as empty, not as on', Object.keys(loadRoundUpCache()).length === 0)
check('  and saving into it does not throw', (() => {
  try { saveRoundUpCache(two); clearRoundUpCache(); return true } catch { return false }
})())

console.log(failed === 0 ? '\nThe cache can only ever fail to OFF.' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
