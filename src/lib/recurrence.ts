import type { IsoDate } from '../types'
import { parseLocalDate, toLocalIsoDate } from './date'

/**
 * Recurring jobs (PROMPT-01 §0 Q2–Q7, Adam, 2026-09-25). The ONE module that
 * knows what a repeat rule means: the edit sheet builds rules through it, the
 * row describes them through it, and ticking a job done moves it on through
 * it. The server never reads a rule — the phone moves the due date, and the
 * reminder job only ever sees the date that results (TECHNICAL.md §22).
 *
 * The model is iOS Calendar's Repeat / Custom screens, in full:
 *
 *   D;N                          every N days
 *   W;N;BYDAY=MO,TH              every N weeks, on those weekdays
 *   M;N;BYMD=1,15,31             every N months, on those dates ("Each")
 *   M;N;POS=-1;KIND=WD           every N months, "On the last weekday"
 *   Y;N;BYMON=9;BYMD=24          every N years, in those months, on that date
 *   Y;N;BYMON=9;POS=1;KIND=SU    every N years, "on the first Sunday" of them
 *
 * A plain string in a text column, because the schema has no jsonb anywhere
 * and must keep it that way (ARCHITECTURE.md → The mapping boundary).
 *
 * 🚨 THREE RULES, each of which the plausible implementation gets wrong:
 *
 * 1. THE NEXT DATE COMES FROM THE SCHEDULE, NOT FROM WHEN IT WAS DONE (Q3).
 *    `nextOccurrence` is given the job's current DUE date, never today. Bins
 *    every other Tuesday stay on Tuesdays even when put out on a Thursday.
 *
 * 2. A DATE PAST THE END OF A SHORT MONTH FALLS ON THE LAST DAY (Q6: "Use
 *    the last day"). The 31st in September is the 30th; 29 Feb in 2027 is
 *    the 28th. 🚨 THIS IS NOT WHAT iOS DOES — iOS skips the month — and it is
 *    deliberate. Do not "fix" it to match iOS.
 *
 * 3. CLAMP PER MONTH, NEVER CARRY THE CLAMP FORWARD. The wanted date lives in
 *    the rule (BYMD=31), not in the previous due date, so 31 Jan → 28 Feb →
 *    31 Mar — not 28 Mar. That is why every preset is saved with its day
 *    spelled out (`presetRule`) rather than "same day as last time".
 *
 * An unparseable rule is a ONE-OFF job, never a crash: a job must never
 * vanish from the page because a rule is malformed.
 */

export type Freq = 'D' | 'W' | 'M' | 'Y'
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
/** A weekday, or iOS's "day", "weekday" and "weekend day". */
export type PosKind = Weekday | 'DAY' | 'WD' | 'WE'

export interface Rule {
  freq: Freq
  /** Every N units, 1–999. */
  interval: number
  /** Weekly only. Monday-first order, never empty. */
  byDay: Weekday[]
  /** Monthly "Each", and the date within each month for yearly. 1–31. */
  byMonthDay: number[]
  /** Yearly only. 1–12, never empty. */
  byMonth: number[]
  /** Monthly/yearly "On the…": 1–5, or -1 for "last". */
  pos: number | null
  posKind: PosKind | null
}

/** Monday first, matching the iOS weekday list and a UK calendar. */
export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
export const POS_KINDS: PosKind[] = [...WEEKDAYS, 'DAY', 'WD', 'WE']
export const POSITIONS = [1, 2, 3, 4, 5, -1]

const MAX_INTERVAL = 999

// ── dates ───────────────────────────────────────────────────────────────────
// Everything goes through lib/date.ts's local-midnight Dates. Never
// `new Date('YYYY-MM-DD')`, never `toISOString()` (README → Dates).

const iso = (y: number, m: number, d: number): IsoDate => toLocalIsoDate(new Date(y, m, d))
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
/** 0 = Monday … 6 = Sunday. */
const mondayIndex = (y: number, m: number, d: number) => (new Date(y, m, d).getDay() + 6) % 7

function parts(date: IsoDate) {
  const dt = parseLocalDate(date)
  return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() }
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const dt = parseLocalDate(date)
  dt.setDate(dt.getDate() + n)
  return toLocalIsoDate(dt)
}

/** Month arithmetic on (year, month-index) pairs, with no Date involved. */
function addMonths(y: number, m: number, n: number): [number, number] {
  const total = y * 12 + m + n
  return [Math.floor(total / 12), ((total % 12) + 12) % 12]
}

function kindMatches(kind: PosKind, weekdayIdx: number): boolean {
  if (kind === 'DAY') return true
  if (kind === 'WD') return weekdayIdx <= 4
  if (kind === 'WE') return weekdayIdx >= 5
  return WEEKDAYS[weekdayIdx] === kind
}

/**
 * "The <pos> <kind> of the month": the first Sunday, the last weekday. Null
 * when the month has no such day (a fifth Monday, most months) — that month
 * is skipped, as iOS does, because there is no sensible "last day" stand-in
 * for a weekday.
 */
export function nthKindOfMonth(y: number, m: number, pos: number, kind: PosKind): number | null {
  const matching: number[] = []
  for (let d = 1; d <= daysIn(y, m); d++) if (kindMatches(kind, mondayIndex(y, m, d))) matching.push(d)
  const hit = pos === -1 ? matching[matching.length - 1] : matching[pos - 1]
  return hit ?? null
}

/** The wanted dates, clamped to THIS month's length (rule 2) and deduped —
 *  the 30th and 31st are both the 28th in February, once. */
function clampedDays(y: number, m: number, wanted: number[]): number[] {
  const last = daysIn(y, m)
  return [...new Set(wanted.map((d) => Math.min(d, last)))].sort((a, b) => a - b)
}

/** The day a monthly/yearly rule lands on in month (y, m), or null. */
function dayInMonth(rule: Rule, y: number, m: number): number[] {
  if (rule.pos !== null && rule.posKind) {
    const d = nthKindOfMonth(y, m, rule.pos, rule.posKind)
    return d === null ? [] : [d]
  }
  return clampedDays(y, m, rule.byMonthDay)
}

// ── parse / format ──────────────────────────────────────────────────────────

const intList = (s: string) => s.split(',').map((x) => Number(x))
const isInt = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi

export function parseRule(raw: string | null | undefined): Rule | null {
  if (!raw) return null
  const [freq, intervalRaw, ...rest] = raw.split(';')
  if (freq !== 'D' && freq !== 'W' && freq !== 'M' && freq !== 'Y') return null
  const interval = Number(intervalRaw)
  if (!isInt(interval, 1, MAX_INTERVAL)) return null

  const rule: Rule = { freq, interval, byDay: [], byMonthDay: [], byMonth: [], pos: null, posKind: null }
  for (const part of rest) {
    const [key, value = ''] = part.split('=')
    if (key === 'BYDAY') {
      const days = value.split(',') as Weekday[]
      if (!days.every((d) => WEEKDAYS.includes(d))) return null
      rule.byDay = WEEKDAYS.filter((d) => days.includes(d))
    } else if (key === 'BYMD') {
      const days = intList(value)
      if (!days.every((d) => isInt(d, 1, 31))) return null
      rule.byMonthDay = [...new Set(days)].sort((a, b) => a - b)
    } else if (key === 'BYMON') {
      const months = intList(value)
      if (!months.every((mo) => isInt(mo, 1, 12))) return null
      rule.byMonth = [...new Set(months)].sort((a, b) => a - b)
    } else if (key === 'POS') {
      const p = Number(value)
      if (!POSITIONS.includes(p)) return null
      rule.pos = p
    } else if (key === 'KIND') {
      if (!POS_KINDS.includes(value as PosKind)) return null
      rule.posKind = value as PosKind
    } else {
      return null
    }
  }

  const hasPos = rule.pos !== null && rule.posKind !== null
  if ((rule.pos === null) !== (rule.posKind === null)) return null
  if (freq === 'W' && rule.byDay.length === 0) return null
  if (freq === 'M' && (rule.byMonthDay.length > 0) === hasPos) return null
  if (freq === 'Y' && (rule.byMonth.length === 0 || (rule.byMonthDay.length === 1) === hasPos)) return null
  if (freq === 'Y' && rule.byMonthDay.length > 1) return null
  return rule
}

export function formatRule(rule: Rule): string {
  const out: string[] = [rule.freq, String(rule.interval)]
  if (rule.freq === 'W') out.push(`BYDAY=${WEEKDAYS.filter((d) => rule.byDay.includes(d)).join(',')}`)
  if (rule.freq === 'Y') out.push(`BYMON=${[...rule.byMonth].sort((a, b) => a - b).join(',')}`)
  if (rule.freq === 'M' || rule.freq === 'Y') {
    if (rule.pos !== null && rule.posKind) out.push(`POS=${rule.pos}`, `KIND=${rule.posKind}`)
    else out.push(`BYMD=${[...rule.byMonthDay].sort((a, b) => a - b).join(',')}`)
  }
  return out.join(';')
}

// ── the next date ───────────────────────────────────────────────────────────

/** Guards the searches below. A valid rule always answers well inside it. */
const MAX_PERIODS = 1200

/**
 * The first date STRICTLY AFTER `fromDue` that the rule produces (rule 1).
 * Null for an unparseable rule, or one that genuinely never occurs again.
 */
export function nextOccurrence(raw: string, fromDue: IsoDate): IsoDate | null {
  const rule = parseRule(raw)
  if (!rule || !fromDue) return null
  const { y, m, d } = parts(fromDue)

  switch (rule.freq) {
    case 'D':
      return addDays(fromDue, rule.interval)

    case 'W': {
      // Later in the SAME week first, then the first chosen day of the week
      // N weeks on. Weeks start on Monday.
      const today = mondayIndex(y, m, d)
      const weekStart = addDays(fromDue, -today)
      const idx = rule.byDay.map((w) => WEEKDAYS.indexOf(w))
      const later = idx.find((i) => i > today)
      if (later !== undefined) return addDays(weekStart, later)
      return addDays(weekStart, 7 * rule.interval + idx[0])
    }

    case 'M': {
      const later = dayInMonth(rule, y, m).find((day) => day > d)
      if (later !== undefined) return iso(y, m, later)
      for (let k = 1; k <= MAX_PERIODS; k++) {
        const [ny, nm] = addMonths(y, m, k * rule.interval)
        const first = dayInMonth(rule, ny, nm)[0]
        if (first !== undefined) return iso(ny, nm, first)
      }
      return null
    }

    case 'Y': {
      const months = rule.byMonth.map((mo) => mo - 1)
      // The rest of THIS year first…
      for (const mm of months) {
        if (mm < m) continue
        const day = dayInMonth(rule, y, mm).find((dd) => mm > m || dd > d)
        if (day !== undefined) return iso(y, mm, day)
      }
      // …then every N years on.
      for (let k = 1; k <= MAX_PERIODS / 12; k++) {
        const ny = y + k * rule.interval
        for (const mm of months) {
          const day = dayInMonth(rule, ny, mm)[0]
          if (day !== undefined) return iso(ny, mm, day)
        }
      }
      return null
    }
  }
}

// ── presets ─────────────────────────────────────────────────────────────────

/** The Repeat menu, as iOS lists it. */
export type Preset = 'never' | 'D' | 'W' | '2W' | 'M' | 'Y' | 'custom'

export const PRESETS: Array<{ id: Exclude<Preset, 'custom'>; label: string }> = [
  { id: 'never', label: 'Never' },
  { id: 'D', label: 'Every Day' },
  { id: 'W', label: 'Every Week' },
  { id: '2W', label: 'Every 2 Weeks' },
  { id: 'M', label: 'Every Month' },
  { id: 'Y', label: 'Every Year' },
]

/**
 * A preset, spelled out against a due date: "Every Month" on the 31st is
 * `M;1;BYMD=31`, so February's 28th does not become March's 28th (rule 3).
 * Built at SAVE time, from the date being saved, so changing the date after
 * picking "Every Week" moves the weekday with it — as iOS does.
 */
export function presetRule(preset: Preset, due: IsoDate): string {
  if (preset === 'never' || preset === 'custom' || !due) return ''
  const { y, m, d } = parts(due)
  const wd = WEEKDAYS[mondayIndex(y, m, d)]
  switch (preset) {
    case 'D': return 'D;1'
    case 'W': return `W;1;BYDAY=${wd}`
    case '2W': return `W;2;BYDAY=${wd}`
    case 'M': return `M;1;BYMD=${d}`
    case 'Y': return `Y;1;BYMON=${m + 1};BYMD=${d}`
  }
}

/** Which menu entry a saved rule is, for the given due date. */
export function presetOf(raw: string, due: IsoDate): Preset {
  if (!raw || !parseRule(raw)) return 'never'
  const hit = PRESETS.find((p) => p.id !== 'never' && presetRule(p.id, due) === raw)
  return hit ? hit.id : 'custom'
}

/** Where the Custom screen starts for a frequency: iOS pre-selects the due
 *  date's own weekday / date / month. */
export function customStart(freq: Freq, due: IsoDate): Rule {
  const { y, m, d } = parts(due)
  const base: Rule = { freq, interval: 1, byDay: [], byMonthDay: [], byMonth: [], pos: null, posKind: null }
  if (freq === 'W') base.byDay = [WEEKDAYS[mondayIndex(y, m, d)]]
  if (freq === 'M') base.byMonthDay = [d]
  if (freq === 'Y') {
    base.byMonth = [m + 1]
    base.byMonthDay = [d]
  }
  return base
}

// ── words ───────────────────────────────────────────────────────────────────

const LONG_DAY: Record<Weekday, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
}
const SHORT_DAY: Record<Weekday, string> = {
  MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun',
}
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const POS_WORD: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last' }

export const posWord = (p: number) => POS_WORD[p]
export const kindWord = (k: PosKind, short = false): string =>
  k === 'DAY' ? 'day' : k === 'WD' ? 'weekday' : k === 'WE' ? 'weekend day' : (short ? SHORT_DAY : LONG_DAY)[k]
export const dayName = (w: Weekday) => LONG_DAY[w]

export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** "A", "A and B", "A, B and C". */
function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

const UNIT: Record<Freq, string> = { D: 'day', W: 'week', M: 'month', Y: 'year' }

function every(rule: Rule): string {
  const unit = UNIT[rule.freq]
  return rule.interval === 1 ? `every ${unit}` : `every ${rule.interval} ${unit}s`
}

/**
 * The sentence under the Custom screen, iOS's "Event will occur every week."
 * — here "Repeats every 2 weeks on Monday and Thursday."
 */
export function describeRule(raw: string): string {
  const rule = parseRule(raw)
  if (!rule) return 'Does not repeat.'
  const pos = rule.pos !== null && rule.posKind ? `the ${posWord(rule.pos)} ${kindWord(rule.posKind)}` : null
  switch (rule.freq) {
    case 'D':
      return `Repeats ${every(rule)}.`
    case 'W':
      return `Repeats ${every(rule)} on ${joinAnd(rule.byDay.map((w) => LONG_DAY[w]))}.`
    case 'M':
      return `Repeats ${every(rule)} on ${pos ?? `the ${joinAnd(rule.byMonthDay.map(ordinal))}`}.`
    case 'Y': {
      const months = joinAnd(rule.byMonth.map((mo) => MONTHS_LONG[mo - 1]))
      return pos
        ? `Repeats ${every(rule)} on ${pos} of ${months}.`
        : `Repeats ${every(rule)} on the ${ordinal(rule.byMonthDay[0])} of ${months}.`
    }
  }
}

/**
 * The row's small text (Q1): "Every 2 weeks", and the detail only where the
 * due chip does not already say it — two weekdays, two dates, "last weekday".
 */
export function shortRule(raw: string): string {
  const rule = parseRule(raw)
  if (!rule) return ''
  const base = every(rule).replace(/^e/, 'E')
  const pos = rule.pos !== null && rule.posKind ? `${posWord(rule.pos)} ${kindWord(rule.posKind, true)}` : null
  switch (rule.freq) {
    case 'D':
      return base
    case 'W':
      return rule.byDay.length > 1 ? `${base} · ${rule.byDay.map((w) => SHORT_DAY[w]).join(', ')}` : base
    case 'M':
      if (pos) return `${base} · ${pos}`
      return rule.byMonthDay.length > 1 ? `${base} · ${rule.byMonthDay.map(ordinal).join(', ')}` : base
    case 'Y': {
      const months = rule.byMonth.map((mo) => MONTHS_SHORT[mo - 1]).join(', ')
      if (pos) return `${base} · ${pos} of ${months}`
      return rule.byMonth.length > 1 ? `${base} · ${months}` : base
    }
  }
}
