import type { DeviceState, Job, JobCategory, JobPage } from '../types'
import { categoryKey } from './deviceState'
import { sortOpenJobs } from './jobs'

/**
 * How a jobs page is grouped (TECHNICAL.md §12). One group per category, in
 * the category order, then "Other" last.
 *
 * Inside a group: DATED jobs first, soonest first (`sortOpenJobs`, exactly
 * the order the page had before categories), then UNDATED jobs in their
 * dragged order. 🚨 Only undated jobs carry a grip — a dragged dated job
 * would be put straight back by the date sort, so offering the drag would be
 * a lie.
 *
 * 🚨 An EMPTY category hides itself, exactly as a shopping list does
 * (TECHNICAL.md §8): unless it is starred (`isDefault`), or has never held a
 * job — without that second clause a category made from the page's "New
 * category" box would vanish the moment it was made. "Never held a job" is
 * `neverHadJobs` AND no job, open or done, names it: every category that
 * existed before the flag did was given `true`, and a done job filed under
 * it is the evidence it has been used. (`usedCategoryIds` below.) A
 * hidden category still exists: Categories lists it, and the job sheet can
 * file a job under it, which brings it back. "Empty" means no OPEN job;
 * done jobs live in the Done folder.
 *
 * "Other" is every open job with no category, AND every job naming a
 * category that does not exist here (deleted on the other phone while this
 * one filed a job under it). It is not a row, cannot be renamed or dragged,
 * and is left out entirely when it holds nothing.
 */
export interface JobGroup {
  /** Device-state key: the category id, or `other:<page>`. */
  key: string
  /** null for Other. */
  category: JobCategory | null
  dated: Job[]
  /** In position order. Only these reorder. */
  undated: Job[]
}

/**
 * @param jobs every job, already in position order (the context's order)
 * @param categories the page's categories, already in position order
 */
export function groupJobs(page: JobPage, jobs: readonly Job[], categories: readonly JobCategory[]): JobGroup[] {
  const mine = categories.filter((c) => c.page === page)
  const known = new Set(mine.map((c) => c.id))
  const open = jobs.filter((j) => j.page === page && !j.done)
  const inGroup = (id: string) => open.filter((j) => (known.has(j.categoryId) ? j.categoryId : '') === id)
  const build = (category: JobCategory | null): JobGroup => {
    const members = inGroup(category?.id ?? '')
    return {
      key: categoryKey(page, category?.id ?? ''),
      category,
      dated: sortOpenJobs(members.filter((j) => j.due)),
      undated: members.filter((j) => !j.due),
    }
  }
  const used = usedCategoryIds(page, jobs)
  const groups = mine
    .map(build)
    .filter(
      (g) =>
        g.dated.length + g.undated.length > 0 ||
        g.category?.isDefault ||
        (g.category?.neverHadJobs && !used.has(g.category.id)),
    )
  const other = build(null)
  if (other.dated.length + other.undated.length > 0) groups.push(other)
  return groups
}

/** Categories some job on this page names, open OR done. */
export function usedCategoryIds(page: JobPage, jobs: readonly Job[]): Set<string> {
  return new Set(jobs.filter((j) => j.page === page && j.categoryId).map((j) => j.categoryId))
}

/** The group key a job renders under — what a tapped reminder must expand. */
export function groupKeyOf(job: Job, categories: readonly JobCategory[]): string {
  const known = categories.some((c) => c.page === job.page && c.id === job.categoryId)
  return categoryKey(job.page, known ? job.categoryId : '')
}

/**
 * Whether a group renders open on this phone. Open unless collapsed here —
 * 🚨 and ALWAYS open when it holds the job a tapped reminder or due-soon
 * banner is opening (`flashGroup`): a collapsed group renders no rows, so the
 * flash would land on nothing, silently.
 */
export function isGroupOpen(device: Pick<DeviceState, 'collapsedCategories'>, key: string, flashGroup: string | null): boolean {
  return key === flashGroup || !(key in device.collapsedCategories)
}
