/**
 * verify-job-alerts — what a job's alert choice is stored as, and what its
 * row says about it (PROMPT-01 §0 Q8–Q10, Adam, 2026-09-25).
 *
 * The bugs this prevents:
 *
 *   - An upload the database refuses. An hour/minute offset with no due time,
 *     or an offset the server's CHECK does not know, is rejected 23514 — and
 *     PowerSync's connector DISCARDS a rejected write silently (§27). The job
 *     would look saved on the phone and never be saved anywhere else.
 *   - The default stored as 'd3'/'08:00' instead of NULL, so every job's row
 *     grows "Alert 3 days before, 08:00" and the "only if it differs from the
 *     default" rule (Q1) quietly stops meaning anything.
 *
 *   TZ=Europe/London npx tsx scripts/verify-job-alerts.ts
 */
import {
  alertSummary, DAY_OFFSETS, normaliseAlert, offsetLabel, TIME_OFFSETS,
} from '../src/lib/alerts'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const stores = (args: [string, string, string], want: { offset: string; time: string }, name: string) => {
  const got = normaliseAlert(...args)
  check(name, got.offset === want.offset && got.time === want.time, `got ${JSON.stringify(got)}`)
}

// 🚨 Must equal the alert_offset CHECK in silver-octo-invention's
// 20260925090000_listly_job_alerts.sql. If either changes, change both.
const SERVER_OFFSET_CHECK = /^(d([0-9]|[12][0-9]|30)|w[1-4]|h([1-9]|1[0-9]|2[0-3])|m([0-9]|[1-5][0-9]))$/

// ── what gets stored ────────────────────────────────────────────────────────
stores(['d3', '08:00', ''], { offset: '', time: '' }, '🚨 the default is stored as NULL/NULL, not d3/08:00')
stores(['', '', ''], { offset: '', time: '' }, 'nothing chosen is the default')
stores(['d2', '09:00', ''], { offset: 'd2', time: '09:00' }, '2 days before at 09:00')
stores(['d3', '09:30', ''], { offset: '', time: '09:30' }, 'the default offset at another time keeps only the time')
stores(['w1', '', ''], { offset: 'w1', time: '' }, '1 week before, at the default 08:00')
stores(['h1', '09:00', '18:00'], { offset: 'h1', time: '' }, 'an hour offset carries no time of day')
stores(['h1', '', ''], { offset: '', time: '' }, '🚨 an hour offset with NO due time falls back to the default (the CHECK would refuse it)')
stores(['m30', '', ''], { offset: '', time: '' }, '🚨 …and so does a minute offset')
stores(['bogus', '', ''], { offset: '', time: '' }, 'an unknown offset falls back to the default')
stores(['d2', '25:00', ''], { offset: 'd2', time: '' }, 'an impossible time falls back to 08:00')

// ── every offset the sheet offers is one the server accepts ────────────────
for (const o of [...DAY_OFFSETS, ...TIME_OFFSETS]) {
  check(`the server CHECK accepts ${o}`, SERVER_OFFSET_CHECK.test(o))
}
check('control: the server CHECK refuses a nonsense offset', !SERVER_OFFSET_CHECK.test('x9'))

// ── what the row says ───────────────────────────────────────────────────────
const row = (o: string, t: string, want: string) =>
  check(`row for (${o || 'default'}, ${t || 'default'}) → "${want}"`, alertSummary(o, t) === want, `got "${alertSummary(o, t)}"`)
row('', '', '')
row('d2', '09:00', 'Alert 2 days before, 09:00')
row('', '09:30', 'Alert 3 days before, 09:30')
row('w1', '', 'Alert 1 week before, 08:00')
row('h1', '', 'Alert 1 hour before')
row('m0', '', 'Alert at the due time')
row('d0', '', 'Alert on the day, 08:00')

// ── labels ──────────────────────────────────────────────────────────────────
const label = (o: string, want: string) => check(`label ${o} → "${want}"`, offsetLabel(o) === want, `got "${offsetLabel(o)}"`)
label('d1', '1 day before')
label('d3', '3 days before')
label('w2', '2 weeks before')
label('m5', '5 minutes before')
label('h2', '2 hours before')
label('m0', 'At the due time')
label('d0', 'On the day')

if (failed) {
  console.log(`\nFAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll job-alert checks passed.')
