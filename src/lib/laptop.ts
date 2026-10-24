import type { Job, JobCategory, List } from '../types'
import type { Tab } from './openIntent'
import { groupKeyOf, type JobGroup } from './jobGroups'

/**
 * The laptop view (TECHNICAL.md §24): at 768px and wider the bottom pill
 * becomes a side rail, and each page shows ONE list or category at a time —
 * the one picked in the rail. Below 768px nothing here is used and the app is
 * exactly the phone layout.
 *
 * Everything in this file is per DEVICE, like `deviceState.ts`: which list
 * this laptop is looking at, and whether its rail is collapsed, are not the
 * household's business and are never synced.
 */

/**
 * 🚨 Width AND height. The manifest does not lock orientation, and an iPhone
 * turned sideways is 844–932px wide — so a width-only query would switch a
 * PHONE to the laptop view, which must never change. A sideways phone is
 * under 500px tall; an iPad or a laptop window never is.
 */
export const WIDE_QUERY = '(min-width: 768px) and (min-height: 500px)'

export interface LaptopState {
  railCollapsed: boolean
  /** The list id (Shopping) or job-group key (jobs pages) last picked on each page. */
  focus: Partial<Record<Tab, string>>
  /** Pages opened out to show their lists in the expanded rail. */
  railOpen: Partial<Record<Tab, boolean>>
}

const KEY = 'listly:laptop-state:v1'

export const EMPTY_LAPTOP: LaptopState = { railCollapsed: false, focus: {}, railOpen: {} }

/** Never throws: no storage, a private window or bad JSON all mean the defaults. */
export function loadLaptopState(): LaptopState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_LAPTOP
    const p = JSON.parse(raw) as Partial<LaptopState>
    return {
      railCollapsed: p.railCollapsed === true,
      focus: p.focus && typeof p.focus === 'object' ? p.focus : {},
      railOpen: p.railOpen && typeof p.railOpen === 'object' ? p.railOpen : {},
    }
  } catch {
    return EMPTY_LAPTOP
  }
}

export function saveLaptopState(state: LaptopState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable: this session keeps working from memory.
  }
}

export interface FocusCandidate {
  id: string
  isDefault: boolean
}

/**
 * Which list a page shows: the one remembered for it if it is still there,
 * else the page's first starred (default) one, else its first, else nothing.
 *
 * 🚨 This is DERIVED on every render and never written back to storage. On a
 * cold start the lists have not synced yet, so the remembered list is
 * briefly "missing"; writing the fallback back would lose it for good, and
 * the laptop would open on the default list every time. Only a pick in the
 * rail writes `focus`.
 */
export function resolveFocus(remembered: string | undefined, candidates: readonly FocusCandidate[]): string | null {
  if (remembered && candidates.some((c) => c.id === remembered)) return remembered
  return (candidates.find((c) => c.isDefault) ?? candidates[0])?.id ?? null
}

/** The Shopping page's candidates: the VISIBLE lists, as the phone page shows them. */
export const listCandidates = (visible: readonly List[]): FocusCandidate[] =>
  visible.map((l) => ({ id: l.id, isDefault: l.isDefault }))

/** A jobs page's candidates: its groups as `groupJobs` builds them, Other included. */
export const groupCandidates = (groups: readonly JobGroup[]): FocusCandidate[] =>
  groups.map((g) => ({ id: g.key, isDefault: g.category?.isDefault ?? false }))

/**
 * The due-soon banner on a laptop shows only the FOCUSED group's jobs. The
 * queue is the phone's (`dueSoonQueue`, dismissals already applied), so the
 * order and the dismissal rule are the same; only the filter is new.
 *
 * A job is matched by `groupKeyOf` — the group it RENDERS under — so a job
 * naming a deleted category belongs to Other here exactly as it does on the
 * page. Matching on `categoryId` instead would hide its banner everywhere.
 */
export function bannerQueueFor(queue: readonly Job[], focusKey: string | null, categories: readonly JobCategory[]): Job[] {
  if (!focusKey) return []
  return queue.filter((j) => groupKeyOf(j, categories) === focusKey)
}

/** How many of the queue's jobs sit in each group: the rail's red counts. */
export function dueCountByGroup(queue: readonly Job[], categories: readonly JobCategory[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const j of queue) {
    const key = groupKeyOf(j, categories)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
