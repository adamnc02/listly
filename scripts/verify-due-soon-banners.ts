/**
 * verify-due-soon-banners — which job the due-soon banner shows, and the count.
 *
 * The banner shows one job at a time with a count of how many are waiting
 * (TECHNICAL.md §13). The bugs this prevents:
 *
 *   - The count and the banner disagreeing: a count that includes a job the
 *     banner would never show (done, dismissed today, not due soon, or a
 *     House job while that tab is hidden) leaves ✕ with nothing to reveal.
 *   - The wrong job on top. The shown banner is the soonest, overdue first;
 *     showing jobs in list order would hide an overdue job behind next week.
 *   - ✕ not bringing up the next one: dismissing the head must leave the
 *     rest of the queue, in order, one shorter.
 *
 *   TZ=Europe/London npx tsx scripts/verify-due-soon-banners.ts
 */
import { toLocalIsoDate, todayIso, parseLocalDate } from '../src/lib/date'
import { dueSoonQueue } from '../src/lib/jobs'
import type { Job } from '../src/types'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

const inDays = (n: number) => {
  const d = parseLocalDate(todayIso())
  d.setDate(d.getDate() + n)
  return toLocalIsoDate(d)
}
const job = (id: string, page: Job['page'], due: string, done = false): Job => ({
  id, page, text: id, due, done, remind: false, dueTime: '', repeat: '', alertOffset: '', alertTime: '',
})

const jobs: Job[] = [
  job('mine-in-2', 'mine', inDays(2)),
  job('house-overdue', 'house', inDays(-4)),
  job('mine-next-week', 'mine', inDays(7)), // not due soon
  job('mine-today', 'mine', inDays(0)),
  job('house-done', 'house', inDays(-1), true), // done
  job('mine-undated', 'mine', ''), // no date
  job('house-in-3', 'house', inDays(3)),
]
const ids = (q: Job[]) => q.map((j) => j.id).join(',')
const none = () => false

// ── the queue ───────────────────────────────────────────────────────────────
const all = dueSoonQueue(jobs, none, false)
check('soonest first, overdue at the head', ids(all) === 'house-overdue,mine-today,mine-in-2,house-in-3', ids(all))
check('count is 4: done, undated and next week are not waiting', all.length === 4, String(all.length))

// ── ✕ brings up the next ────────────────────────────────────────────────────
const dismissed = new Set([all[0].id])
const after = dueSoonQueue(jobs, (id) => dismissed.has(id), false)
check('after ✕ the next one shows', after[0]?.id === 'mine-today', after[0]?.id)
check('after ✕ the count drops by one', after.length === 3, String(after.length))

// ── household of one ────────────────────────────────────────────────────────
const solo = dueSoonQueue(jobs, none, true)
check('House jobs are left out when the tab is hidden', ids(solo) === 'mine-today,mine-in-2', ids(solo))

// ── nothing waiting ─────────────────────────────────────────────────────────
const cleared = dueSoonQueue(jobs, () => true, false)
check('all dismissed → no banner', cleared.length === 0, String(cleared.length))

// ── control: the input order is NOT the answer ──────────────────────────────
// If the sort were dropped, the head would be the first due-soon job in list
// order. This proves the fixture can tell the two apart.
const unsorted = jobs.filter((j) => all.includes(j)).map((j) => j.id)
check('control: list order differs from the queue order', unsorted[0] !== all[0].id, unsorted.join(','))

if (failed) {
  console.log(`\nFAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll due-soon banner checks passed')
