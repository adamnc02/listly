/**
 * A job's alert (PROMPT-01 §0 Q8–Q10, Adam, 2026-09-25). One alert per job,
 * stored as two text columns:
 *
 *   alert_offset  'd3' (3 days before), 'w1' (1 week), 'h2' (2 hours),
 *                 'm30' (30 minutes), 'm0' (at the due time), 'd0' (on the
 *                 day). NULL = the default, d3.
 *   alert_time    'HH:MM', for day and week offsets. NULL = 08:00.
 *
 * What each one DOES is decided by the server, in
 * `listly.job_alert_candidates()` (silver-octo-invention, 20260925090000),
 * and the words below must describe exactly that:
 *
 *   - Day and week offsets, and the default: a push every day at the alert
 *     time, from that many days before the due date, UNTIL THE JOB IS TICKED
 *     — overdue included. 🚨 That is new: before 2026-09-25 reminders
 *     stopped on the due day.
 *   - Hour and minute offsets (only offered when the job has a time): ONE
 *     push at that moment; then, if the job is still open, 08:00 every day
 *     from the day after it is due.
 *
 * The default is stored as NULL/NULL, not as 'd3'/'08:00', so the row can say
 * "this job has its own alert" by the columns alone, and a later change to
 * the default reaches every job that never chose one.
 */

export const DEFAULT_OFFSET = 'd3'
export const DEFAULT_TIME = '08:00'

/** Offered for every dated job. */
export const DAY_OFFSETS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'w1', 'w2'] as const
/** Offered only when the job has a due time (Q8). */
export const TIME_OFFSETS = ['m0', 'm5', 'm10', 'm15', 'm30', 'h1', 'h2'] as const

const OFFSET_RE = /^([dwhm])(\d{1,2})$/

/** 'HH:MM', 24-hour. What `<input type="time">` produces. */
export const isHhMm = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)

/** An hour or minute offset: fires once, and needs a due time. */
export function isTimedOffset(offset: string): boolean {
  return offset.startsWith('h') || offset.startsWith('m')
}

export function offsetLabel(offset: string): string {
  const m = OFFSET_RE.exec(offset || DEFAULT_OFFSET)
  if (!m) return offsetLabel(DEFAULT_OFFSET)
  const n = Number(m[2])
  const unit = { d: 'day', w: 'week', h: 'hour', m: 'minute' }[m[1] as 'd' | 'w' | 'h' | 'm']
  if (n === 0) return m[1] === 'd' ? 'On the day' : 'At the due time'
  return `${n} ${unit}${n === 1 ? '' : 's'} before`
}

/**
 * What to store for an alert choice. Defaults become '' (NULL), a timed
 * offset carries no time of day, and a timed offset with no due time falls
 * back to the default rather than writing a row the CHECK would refuse —
 * a refused upload is DISCARDED silently (§27), so it must never be sent.
 */
export function normaliseAlert(offset: string, time: string, dueTime: string): { offset: string; time: string } {
  let o = offset || DEFAULT_OFFSET
  if (!OFFSET_RE.test(o)) o = DEFAULT_OFFSET
  if (isTimedOffset(o) && !dueTime) o = DEFAULT_OFFSET
  if (isTimedOffset(o)) return { offset: o, time: '' }
  const t = isHhMm(time) ? time : DEFAULT_TIME
  return { offset: o === DEFAULT_OFFSET ? '' : o, time: t === DEFAULT_TIME ? '' : t }
}

/**
 * The row's small text — only when the alert is NOT the default (Q1).
 * '' for the default, so an ordinary job's row stays as it always was.
 */
export function alertSummary(offset: string, time: string): string {
  if (!offset && !time) return ''
  const o = offset || DEFAULT_OFFSET
  if (isTimedOffset(o)) return `Alert ${offsetLabel(o).toLowerCase()}`
  return `Alert ${offsetLabel(o).toLowerCase()}, ${time || DEFAULT_TIME}`
}
