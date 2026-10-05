/**
 * verify-job-categories — how a jobs page groups, orders and opens its jobs.
 *
 * Each jobs page is its categories, each a collapsible card, then "Other"
 * (TECHNICAL.md §12). The bugs this prevents:
 *
 *   - A job filed under a category the other phone has deleted vanishing
 *     from the page: its id names nothing here, so it must read as Other,
 *     not fall out of every group.
 *   - Dated jobs losing their soonest-first order inside a category, or
 *     undated ones losing their dragged order.
 *   - Other showing as an empty card, or not being last.
 *   - 🚨 A tapped reminder opening a job whose category is COLLAPSED on this
 *     phone: no row is rendered, so nothing flashes, silently. The control
 *     below is the open rule without the flash override.
 *   - An empty category that should hide still showing, or one that should
 *     show (starred, or just made) hiding — the shopping-list rule (§8),
 *     with a control that drops the rule.
 *   - A job built without its category: every job row is built by
 *     jobColumns(), and '' (Other) must be written as NULL.
 *
 *   TZ=Europe/London npx tsx scripts/verify-job-categories.ts
 */
import { groupJobs, groupKeyOf, isGroupOpen } from '../src/lib/jobGroups'
import { categoryKey, withCategoryOpen } from '../src/lib/deviceState'
import { jobColumns, EMPTY_DRAFT } from '../src/lib/jobs'
import { parseLocalDate, toLocalIsoDate, todayIso } from '../src/lib/date'
import type { DeviceState, Job, JobCategory } from '../src/types'

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
const job = (id: string, categoryId: string, due = '', done = false, page: Job['page'] = 'house'): Job => ({
  id, page, text: id, due, done, remind: false, dueTime: '', repeat: '', alertOffset: '', alertTime: '',
  doneAt: '', categoryId,
})
const cat = (id: string, page: JobCategory['page'] = 'house', extra: Partial<JobCategory> = {}): JobCategory => ({
  id, page, name: id, isDefault: false, neverHadJobs: false, ...extra,
})

// Categories in position order: Garden before Work. Jobs in position order.
const categories = [cat('garden'), cat('work'), cat('empty', 'house', { isDefault: true }), cat('admin', 'mine')]
const jobs: Job[] = [
  job('mow', 'garden'),                    // undated, first by position
  job('hedge', 'garden', inDays(5)),       // dated, later
  job('weeds', 'garden'),                  // undated, second by position
  job('bins', 'garden', inDays(1)),        // dated, sooner
  job('report', 'work', inDays(-2)),       // overdue
  job('loose', ''),                        // no category
  job('orphan', 'deleted-on-the-other-phone'),
  job('gutters', 'garden', '', true),      // done: never on the page
  job('passport', 'admin', '', false, 'mine'),
]
const groups = groupJobs('house', jobs, categories)
const ids = (js: Job[]) => js.map((j) => j.id).join(',')
const keys = groups.map((g) => g.key).join(',')

// ── grouping ───────────────────────────────────────────────────────────────
check('one group per category, in category order, then Other last', keys === 'garden,work,empty,other:house', keys)
check('an empty STARRED category still shows', groups[2]?.key === 'empty' && groups[2].dated.length + groups[2].undated.length === 0)

// ── the hide rule (the shopping-list rule, §8) ─────────────────────────────
const hideCats = [
  cat('used-empty'),                                   // has held a job, now empty
  cat('starred-empty', 'house', { isDefault: true }),
  cat('brand-new', 'house', { neverHadJobs: true }),   // just made from the box
  cat('busy'),
]
const shown = groupJobs('house', [job('x', 'busy')], hideCats).map((g) => g.key).join(',')
check('🚨 an empty, unstarred, used category hides', !shown.split(',').includes('used-empty'), shown)
check('an empty STARRED category shows', shown.includes('starred-empty'), shown)
check('🚨 a just-made category shows until it has held a job', shown.includes('brand-new'), shown)
check('a category with an open job shows', shown.includes('busy'), shown)
check('a category holding only DONE jobs counts as empty', !groupJobs('house', [job('d', 'used-empty', '', true)], hideCats).some((g) => g.key === 'used-empty'))
const preFlag = [cat('work', 'house', { neverHadJobs: true })] // existed before the flag; defaulted to true
check('🚨 a "new" category with a DONE job filed under it counts as used, and hides', groupJobs('house', [job('old', 'work', '', true)], preFlag).length === 0)
check('…while one with no job at all still shows', groupJobs('house', [], preFlag).length === 1)
const noRule = hideCats.map((c) => c.id).join(',')
check('control: without the rule every category would show', noRule.includes('used-empty') && shown !== noRule, noRule)
check('the other page’s categories are not on this page', !groups.some((g) => g.category?.id === 'admin'))
const other = groups[groups.length - 1]
check('Other holds the uncategorised job', other.undated.some((j) => j.id === 'loose'))
check('🚨 a job naming a deleted category reads as Other, not lost', other.undated.some((j) => j.id === 'orphan'), ids(other.undated))
check('done jobs are on no card', !groups.some((g) => [...g.dated, ...g.undated].some((j) => j.done)))
const otherless = groupJobs('house', jobs.filter((j) => j.id !== 'loose' && j.id !== 'orphan'), categories)
check('Other is left out entirely when it holds nothing', !otherless.some((g) => !g.category), otherless.map((g) => g.key).join(','))

// ── order inside a group ──────────────────────────────────────────────────
const garden = groups[0]
check('dated jobs first, soonest first', ids(garden.dated) === 'bins,hedge', ids(garden.dated))
check('undated jobs after, in their dragged (position) order', ids(garden.undated) === 'mow,weeds', ids(garden.undated))
check('an overdue job leads its category', groups[1].dated[0]?.id === 'report')

// ── open on this phone, and the reminder override ──────────────────────────
let device: Pick<DeviceState, 'collapsedCategories'> = { collapsedCategories: {} }
check('groups are open by default', isGroupOpen(device, 'garden', null))
device = withCategoryOpen({ ...device, openLists: {}, dismissedBanners: {} } as DeviceState, 'garden', false)
check('collapsing remembers it', !isGroupOpen(device, 'garden', null))
const bins = jobs.find((j) => j.id === 'bins')!
const flashGroup = groupKeyOf(bins, categories)
check('a job’s group key is its category', flashGroup === 'garden', flashGroup)
check('🚨 a reminder for a job in a COLLAPSED group renders that group open', isGroupOpen(device, 'garden', flashGroup))
const controlOpen = (d: typeof device, key: string) => !(key in d.collapsedCategories)
check('control: without the override the row would not render', !controlOpen(device, 'garden'), 'the control should be closed')
const orphan = jobs.find((j) => j.id === 'orphan')!
check('a reminder for an orphaned job opens Other, where it renders', groupKeyOf(orphan, categories) === categoryKey('house', ''))
device = withCategoryOpen(device as DeviceState, 'garden', true)
check('opening again forgets the collapse', isGroupOpen(device, 'garden', null) && !('garden' in device.collapsedCategories))

// ── the row that is written ────────────────────────────────────────────────
check('jobColumns carries the category', jobColumns({ ...EMPTY_DRAFT, text: 'x', categoryId: 'garden' }).category_id === 'garden')
check('Other is written as NULL, never as \'\'', jobColumns({ ...EMPTY_DRAFT, text: 'x' }).category_id === null)
check('an undated job keeps its category (the no-date branch)', jobColumns({ ...EMPTY_DRAFT, text: 'x', due: '', categoryId: 'work' }).category_id === 'work')

if (failed) {
  console.log(`\nFAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll job-category checks passed')
