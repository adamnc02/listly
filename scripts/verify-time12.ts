/**
 * verify-time12 — the 12-hour picker writes the right 24-hour time.
 *
 * The bug this prevents: 12 o'clock. "PM adds 12" turns 12:30 pm into 24:30,
 * and "AM leaves it alone" turns 12:15 am into 12:15 — noon instead of just
 * after midnight. Either one sets an alert twelve hours out, silently, for
 * the one person (Ella) who is using the 12-hour picker precisely because
 * she does not read the 24-hour figure it writes.
 *
 *   TZ=Europe/London npx tsx scripts/verify-time12.ts
 */
import { label12, to12, to24 } from '../src/lib/time12'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const pair = (hhmm: string, hour: number, minute: number, pm: boolean) => {
  const t = to12(hhmm)
  check(`${hhmm} reads as ${hour}:${String(minute).padStart(2, '0')} ${pm ? 'pm' : 'am'}`,
    t !== null && t.hour === hour && t.minute === minute && t.pm === pm, JSON.stringify(t))
  check(`${hour}:${String(minute).padStart(2, '0')} ${pm ? 'pm' : 'am'} writes ${hhmm}`, to24({ hour, minute, pm }) === hhmm,
    to24({ hour, minute, pm }))
}

pair('00:00', 12, 0, false)   // 🚨 midnight is 12 AM
pair('00:15', 12, 15, false)
pair('12:00', 12, 0, true)    // 🚨 noon is 12 PM
pair('12:30', 12, 30, true)
pair('01:05', 1, 5, false)
pair('09:00', 9, 0, false)
pair('13:00', 1, 0, true)
pair('21:05', 9, 5, true)
pair('23:59', 11, 59, true)

// Every minute of the day, both ways.
let bad = 0
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m++) {
    const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const t = to12(hhmm)
    if (!t || t.hour < 1 || t.hour > 12 || to24(t) !== hhmm) bad++
  }
}
check('all 1,440 minutes round-trip, and every hour shown is 1–12', bad === 0, `${bad} wrong`)

check('an empty or malformed time has no 12-hour reading', to12('') === null && to12('7pm') === null && to12('24:00') === null)
check('the readout', label12({ hour: 9, minute: 5, pm: true }) === '9:05 pm')

if (failed) {
  console.log(`\nFAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll 12-hour time checks passed.')
