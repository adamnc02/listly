import type { JobPage } from '../types'
import type { Tab } from './openIntent'
import { useListly } from '../context/ListlyContext'
import { isDismissedToday } from './deviceState'
import { dueSoonQueue } from './jobs'
import { groupJobs } from './jobGroups'
import { dueCountByGroup, groupCandidates, listCandidates, resolveFocus, type LaptopState } from './laptop'

/** One row under a page in the rail: a shopping list, or a job group. */
export interface RailEntry {
  id: string
  name: string
  /** Unticked items, or open jobs. */
  count: number
  isDefault: boolean
  /** Due-soon jobs in it that the banner would show (dismissals applied). */
  due: number
  /** Other is always last and has no grip. */
  reorderable: boolean
}

export interface RailPage {
  tab: Tab
  title: string
  entries: RailEntry[]
  /** What the page shows: `resolveFocus` of the remembered pick. */
  focus: string | null
  due: number
}

const TITLE: Record<Tab, string> = { shopping: 'Shopping', house: 'House jobs', mine: 'To-Do' }

/**
 * Everything the laptop view derives from the data: each page's rail rows,
 * which one it shows, and the due-soon counts — computed once in the shell
 * so the rail and the page can never disagree about which list is focused.
 */
export function useRailPages(laptop: LaptopState, showHouse: boolean): RailPage[] {
  const { visibleLists, jobs, jobCategories, device, householdSize } = useListly()
  const queue = dueSoonQueue(jobs, (id) => isDismissedToday(device, id), householdSize === 1)
  const due = dueCountByGroup(queue, jobCategories)

  const shopping: RailPage = {
    tab: 'shopping',
    title: TITLE.shopping,
    entries: visibleLists.map((l) => ({
      id: l.id, name: l.name, count: l.items.filter((i) => !i.done).length,
      isDefault: l.isDefault, due: 0, reorderable: true,
    })),
    focus: resolveFocus(laptop.focus.shopping, listCandidates(visibleLists)),
    due: 0,
  }
  const jobsPage = (page: JobPage): RailPage => {
    const groups = groupJobs(page, jobs, jobCategories)
    const entries = groups.map((g) => ({
      id: g.key,
      name: g.category?.name ?? 'Other',
      count: g.dated.length + g.undated.length,
      isDefault: g.category?.isDefault ?? false,
      due: due.get(g.key) ?? 0,
      reorderable: g.category !== null,
    }))
    return {
      tab: page, title: TITLE[page], entries,
      focus: resolveFocus(laptop.focus[page], groupCandidates(groups)),
      due: entries.reduce((n, e) => n + e.due, 0),
    }
  }
  return showHouse ? [shopping, jobsPage('house'), jobsPage('mine')] : [shopping, jobsPage('mine')]
}
