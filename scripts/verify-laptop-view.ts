/**
 * verify-laptop-view — the laptop view's rules (TECHNICAL.md §24).
 *
 * At 768px and wider the rail picks ONE list per page and the page shows only
 * that one. The bugs this prevents:
 *
 *   - A remembered list lost on every cold start. The lists arrive a moment
 *     after the first render, so the remembered one is briefly "missing"; a
 *     version that writes the fallback back to storage opens on the default
 *     list every time. The control below is that version.
 *   - A due-soon banner hidden everywhere. The banner shows only the focused
 *     group's jobs; matching on `categoryId` instead of the group the job
 *     RENDERS under hides a job filed under a deleted category for good —
 *     it shows in Other, and Other's banner would not include it. Control
 *     included.
 *   - A phone switched to the laptop view by turning it sideways. An iPhone
 *     on its side is 844–932px wide; the query must also need height.
 *
 *   TZ=Europe/London npx tsx scripts/verify-laptop-view.ts
 */
import {
  WIDE_QUERY, bannerQueueFor, dueCountByGroup, groupCandidates, loadLaptopState, resolveFocus,
  type FocusCandidate,
} from '../src/lib/laptop'
import { groupJobs } from '../src/lib/jobGroups'
import type { Job, JobCategory } from '../src/types'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

// ── resolveFocus ──────────────────────────────────────────────────────────
const lists: FocusCandidate[] = [
  { id: 'aldi', isDefault: false },
  { id: 'tesco', isDefault: true },
  { id: 'market', isDefault: false },
]
check('a remembered list that exists is shown', resolveFocus('market', lists) === 'market')
check('no memory: the first starred list', resolveFocus(undefined, lists) === 'tesco')
check('a remembered list that is gone: the first starred one', resolveFocus('deleted', lists) === 'tesco')
check(
  'no starred list: the first one',
  resolveFocus(undefined, lists.map((l) => ({ ...l, isDefault: false }))) === 'aldi',
)
check('nothing at all: null', resolveFocus('tesco', []) === null)

// The cold start: render 1 has no lists yet, render 2 has them. Memory is
// read-only to resolution, so render 2 still lands on the remembered list.
{
  const memory: { focus?: string } = { focus: 'market' }
  const render = (cands: FocusCandidate[]) => resolveFocus(memory.focus, cands)
  render([])
  check('cold start: the remembered list survives the empty first render', render(lists) === 'market')

  // Control: the plausible wrong version writes what it resolved back.
  const bad: { focus?: string } = { focus: 'market' }
  const badRender = (cands: FocusCandidate[]) => {
    const r = resolveFocus(bad.focus, cands)
    bad.focus = r ?? undefined
    return r
  }
  badRender([])
  check('control: writing the fallback back DOES lose it', badRender(lists) !== 'market', String(bad.focus))
}

// ── banners and the rail's counts ─────────────────────────────────────────
const cat = (id: string, page: 'house' | 'mine', name: string, isDefault = false): JobCategory =>
  ({ id, page, name, isDefault, neverHadJobs: false })
const job = (id: string, page: 'house' | 'mine', categoryId: string): Job => ({
  id, page, text: id, due: '2026-10-25', remind: true, done: false, dueTime: '', repeat: '',
  alertOffset: '', alertTime: '', doneAt: '', categoryId,
})
const categories = [cat('work', 'mine', 'Work', true), cat('home', 'mine', 'Home'), cat('garden', 'house', 'Garden')]
// The queue as dueSoonQueue hands it over: due-soon, dismissals applied.
const queue = [
  job('emails', 'mine', 'work'),
  job('timesheet', 'mine', 'work'),
  job('library', 'mine', 'home'),
  job('orphan', 'mine', 'deleted-on-the-other-phone'),
  job('bins', 'house', ''),
  job('lawn', 'house', 'garden'),
]

const ids = (js: Job[]) => js.map((j) => j.id).join(',')
check('Work shows only Work’s jobs', ids(bannerQueueFor(queue, 'work', categories)) === 'emails,timesheet')
check('Shopping (no group) shows none', bannerQueueFor(queue, null, categories).length === 0)
check('House Other shows the uncategorised job', ids(bannerQueueFor(queue, 'other:house', categories)) === 'bins')
check(
  'To-Do Other shows a job whose category was deleted',
  ids(bannerQueueFor(queue, 'other:mine', categories)) === 'orphan',
)
{
  // Control: matching on categoryId leaves the orphan in no banner at all.
  const naive = (key: string) => queue.filter((j) => (j.categoryId || `other:${j.page}`) === key)
  check('control: a categoryId match loses the orphan', naive('other:mine').length === 0)
}

const counts = dueCountByGroup(queue, categories)
check('rail counts per group', counts.get('work') === 2 && counts.get('home') === 1 && counts.get('other:mine') === 1)
check('rail counts cover every queued job', [...counts.values()].reduce((a, b) => a + b, 0) === queue.length)

// The jobs pages' candidates are exactly the groups the page renders, Other last.
{
  const groups = groupJobs('mine', queue, categories)
  const cands = groupCandidates(groups)
  check('job candidates: the starred category first in line', resolveFocus(undefined, cands) === 'work')
  check('job candidates end with Other', cands[cands.length - 1]?.id === 'other:mine')
}

// ── the breakpoint ────────────────────────────────────────────────────────
{
  // A tiny evaluator for the two clauses the query is allowed to contain.
  const matches = (w: number, h: number) =>
    WIDE_QUERY.split(' and ').every((c) => {
      const m = /\((min-width|min-height): (\d+)px\)/.exec(c)
      if (!m) throw new Error(`unexpected clause ${c}`)
      return (m[1] === 'min-width' ? w : h) >= Number(m[2])
    })
  check('a laptop window is wide', matches(1280, 800))
  check('an iPad in portrait is wide', matches(768, 1024))
  check('a phone is not', !matches(390, 844))
  check('a phone on its side is not', !matches(932, 430) && !matches(844, 390))
}

// ── storage never throws ──────────────────────────────────────────────────
{
  const g = globalThis as { localStorage?: unknown }
  g.localStorage = { getItem: () => '{not json' }
  const s = loadLaptopState()
  check('bad stored JSON falls back to defaults', s.railCollapsed === false && Object.keys(s.focus).length === 0)
  g.localStorage = { getItem: () => { throw new Error('denied') } }
  check('storage that throws falls back to defaults', loadLaptopState().railCollapsed === false)
}

if (failed) {
  console.log(`FAIL: ${failed} check(s)`)
  process.exit(1)
}
console.log('All laptop-view checks passed.')
