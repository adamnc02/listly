/**
 * 12-hour ↔ 24-hour, for the time picker (Adam, 2026-09-25: Ella reads the
 * 12-hour clock; Adam prefers 24). Everything STORED is 'HH:MM' 24-hour —
 * this only translates what the picker shows.
 *
 * 🚨 The two hours everyone gets wrong: 12 AM is 00:xx (midnight) and 12 PM
 * is 12:xx (noon). "PM adds 12" is right for 1–11 and wrong for 12, and
 * "AM leaves it alone" is right for 1–11 and wrong for 12.
 * scripts/verify-time12.ts round-trips all 1,440 minutes of the day.
 */

export interface Time12 {
  /** 1–12. */
  hour: number
  /** 0–59. */
  minute: number
  pm: boolean
}

export function to12(hhmm: string): Time12 | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!m) return null
  const h24 = Number(m[1])
  return { hour: h24 % 12 === 0 ? 12 : h24 % 12, minute: Number(m[2]), pm: h24 >= 12 }
}

export function to24({ hour, minute, pm }: Time12): string {
  const h24 = (hour % 12) + (pm ? 12 : 0)
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** "9:05 pm" — the readout under the picker. */
export function label12(t: Time12): string {
  return `${t.hour}:${String(t.minute).padStart(2, '0')} ${t.pm ? 'pm' : 'am'}`
}
