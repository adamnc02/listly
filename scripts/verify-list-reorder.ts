/**
 * verify-list-reorder — dragging a shopping list among the VISIBLE lists.
 *
 * The Shopping page shows only visible lists; an empty non-default list hides
 * itself but keeps its `position`, so it reappears where it was
 * (TECHNICAL.md §8, §17). A drag is reported among the visible rows and
 * written against all of them. The bug this prevents:
 *
 *   - Using the visible index directly against the full order. With a hidden
 *     list between two visible ones, the dragged list lands on the wrong side
 *     of it — dropped between B and C, it reappears ABOVE B, i.e. it does not
 *     move at all on screen. The control below is exactly that version.
 *
 * Each case runs the real path: `fullIndexForVisibleMove`, then `midpoint` of
 * the neighbours, then the context's `byPosition` sort.
 *
 *   TZ=Europe/London npx tsx scripts/verify-list-reorder.ts
 */
import { fullIndexForVisibleMove } from '../src/lib/listOrder'
import { byPosition, midpoint, positionOf, type Row } from '../src/lib/powersync/mapping'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

// A, B, C are visible; H1 and H2 are hidden (empty, non-default).
const start = (): Row[] => [
  { id: 'A', position: 0 },
  { id: 'H1', position: 1 },
  { id: 'B', position: 2 },
  { id: 'C', position: 3 },
  { id: 'H2', position: 4 },
]
const hidden = new Set(['H1', 'H2'])

type Mapper = (all: string[], visible: string[], from: number, to: number) => number
/** The control: the visible index used as if it were the full index. */
const naive: Mapper = (_all, _visible, _from, to) => to

function drag(from: number, to: number, mapper: Mapper = fullIndexForVisibleMove): string {
  const rows = start().sort(byPosition)
  const all = rows.map((r) => String(r.id))
  const visible = all.filter((id) => !hidden.has(id))
  const moved = visible[from]
  const toIndex = mapper(all, visible, from, to)
  // Exactly repositionList(): neighbours in the full order, moved row removed.
  const without = rows.filter((r) => r.id !== moved)
  const pos = midpoint(positionOf(without[toIndex - 1]), positionOf(without[toIndex]))
  return rows
    .map((r) => (r.id === moved ? { ...r, position: pos } : r))
    .sort(byPosition)
    .map((r) => r.id)
    .join(',')
}

/** What the person sees: splice semantics on the visible rows. */
function expectedVisible(from: number, to: number): string {
  const v = ['A', 'B', 'C']
  const [m] = v.splice(from, 1)
  v.splice(to, 0, m)
  return v.join(',')
}
const visibleOf = (order: string) => order.split(',').filter((id) => !hidden.has(id)).join(',')

const cases: Array<[number, number, string, string]> = [
  [0, 1, 'A dropped between B and C', 'H1,B,A,C,H2'],
  [0, 2, 'A dropped at the end', 'H1,B,C,A,H2'],
  [2, 0, 'C dropped at the top', 'C,A,H1,B,H2'],
  [2, 1, 'C dropped between A and B', 'A,H1,C,B,H2'],
  [1, 0, 'B dropped at the top', 'B,A,H1,C,H2'],
]
for (const [from, to, name, full] of cases) {
  const got = drag(from, to)
  check(`${name}: on screen ${expectedVisible(from, to)}`, visibleOf(got) === expectedVisible(from, to), got)
  check(`${name}: hidden lists keep their places (${full})`, got === full, got)
}

// A hidden list after the last visible one stays after a list dropped at the end.
check('a list dropped at the end lands before the trailing hidden list', drag(0, 2).endsWith('A,H2'), drag(0, 2))

// ── control: the visible index used directly ───────────────────────────────
const wrong = drag(0, 1, naive)
check(
  'control: the visible index used directly leaves A where it was on screen',
  visibleOf(wrong) !== expectedVisible(0, 1),
  `${wrong} — the control should have FAILED to move A`,
)

if (failed) {
  console.log(`\nFAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll list-reorder checks passed')
