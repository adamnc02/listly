import type { IsoDate, Job } from '../types'
import { parseLocalDate, todayIso } from './date'

/**
 * Job due-date logic. Every date here goes through src/lib/date.ts.
 *
 * 🚨 Why that matters, twice over (PROMPT-01 §8.2a, MIGRATION-LESSONS §14,
 * and a live Adam-reported bug in the ledger on 2026-09-16):
 *   - `new Date().toISOString().slice(0, 10)` rolls the calendar date BACK
 *     a full day during BST, so a job due today reads as due yesterday;
 *   - `new Date('2026-09-20')` parses as UTC midnight, not local midnight,
 *     and compares as LATER than a locally-built Date for the same day.
 * Both are avoided by building and parsing only through `todayIso()` and
 * `parseLocalDate()`.
 */

const MS_PER_DAY = 86400000

/** Whole days from today to `iso`. Negative is overdue. */
export function daysUntil(iso: IsoDate): number {
  const due = parseLocalDate(iso)
  const today = parseLocalDate(todayIso())
  return Math.round((due.getTime() - today.getTime()) / MS_PER_DAY)
}

/** "Due within 3 days or overdue" — the rule for both the red chip and the
 *  due-soon banner (LISTLY-DESIGN.md §3 and §4). */
export function isDueSoon(iso: IsoDate): boolean {
  return iso !== '' && daysUntil(iso) <= 3
}

function pretty(iso: IsoDate): string {
  return parseLocalDate(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** The chip's wording, matching the prototype exactly. */
export function dueLabel(iso: IsoDate): string {
  const n = daysUntil(iso)
  if (n < -1) return `Overdue by ${-n} days`
  if (n === -1) return 'Overdue since yesterday'
  if (n === 0) return 'Due today'
  if (n === 1) return 'Due tomorrow'
  if (n <= 3) return `Due in ${n} days · ${pretty(iso)}`
  return `Due ${pretty(iso)}`
}

/**
 * Open jobs: dated first, soonest first; undated after them
 * (LISTLY-DESIGN.md §3). `sort` is given a copy — sorting the array in
 * place would mutate context state.
 */
export function sortOpenJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0
    if (a.due) return -1
    if (b.due) return 1
    return 0
  })
}
