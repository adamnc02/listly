import type { IsoDate, Job, JobDraft } from '../types'
import { parseLocalDate, todayIso } from './date'
import { normaliseAlert, isHhMm } from './alerts'
import { parseRule } from './recurrence'

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

/** "Due within 3 days or overdue" — ONE rule, feeding both the red due chip
 *  and the due-soon banner (TECHNICAL.md §12, §13). They must never drift:
 *  a chip that is red while no banner shows reads as a bug in the banner. */
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

/** The chip's wording, matching the prototype exactly — plus the due time,
 *  when the job has one (PROMPT-01 §A5). */
export function dueLabel(iso: IsoDate, time = ''): string {
  const n = daysUntil(iso)
  const at = time ? ` · ${time}` : ''
  if (n < -1) return `Overdue by ${-n} days`
  if (n === -1) return 'Overdue since yesterday'
  if (n === 0) return `Due today${at}`
  if (n === 1) return `Due tomorrow${at}`
  if (n <= 3) return `Due in ${n} days · ${pretty(iso)}${at}`
  return `Due ${pretty(iso)}${at}`
}

/** What a job's row holds in the database, NULL where the app says ''. */
export interface JobColumns {
  text: string
  due_date: string | null
  due_time: string | null
  repeat_rule: string | null
  remind: 0 | 1
  alert_offset: string | null
  alert_time: string | null
}

/**
 * The create/edit sheet's answers, as the columns to write.
 *
 * 🚨 EVERY RULE HERE EXISTS BECAUSE THE DATABASE WOULD OTHERWISE REFUSE THE
 * ROW — and PowerSync DISCARDS a refused upload silently (§27), so the job
 * would look saved on this phone and exist nowhere else. So nothing that
 * reaches a job table is built any other way:
 *
 *   - no due date → no time, no repeat, bell off, default alert
 *     (`remind_needs_due`, and a repeat needs a date to repeat FROM);
 *   - no due time → no hour/minute offset (`timed_alert_needs_time`);
 *   - a malformed time or rule → dropped rather than sent.
 */
export function jobColumns(draft: JobDraft): JobColumns {
  const text = draft.text.trim()
  if (!draft.due) {
    return { text, due_date: null, due_time: null, repeat_rule: null, remind: 0, alert_offset: null, alert_time: null }
  }
  const dueTime = isHhMm(draft.dueTime) ? draft.dueTime : ''
  const alert = normaliseAlert(draft.alertOffset, draft.alertTime, dueTime)
  return {
    text,
    due_date: draft.due,
    due_time: dueTime || null,
    repeat_rule: draft.repeat && parseRule(draft.repeat) ? draft.repeat : null,
    remind: draft.remind ? 1 : 0,
    alert_offset: alert.offset || null,
    alert_time: alert.time || null,
  }
}

/** A job the sheet has not touched yet: the bell comes on with a date (Q10). */
export const EMPTY_DRAFT: JobDraft = {
  text: '', due: '', dueTime: '', repeat: '', remind: false, alertOffset: '', alertTime: '',
}

/**
 * Open jobs: dated first, soonest first; undated after them (TECHNICAL.md
 * §12). `sort` is given a copy — sorting the array in place would mutate
 * context state.
 */
export function sortOpenJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0
    if (a.due) return -1
    if (b.due) return 1
    return 0
  })
}
