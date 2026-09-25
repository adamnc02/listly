/**
 * verify-recurrence — what date a recurring job moves on to when it is ticked.
 *
 * The bugs this prevents (PROMPT-01 §0 Q3, Q5, Q6, Adam, 2026-09-25):
 *
 *   - A monthly job on the 31st drifting to the 28th for ever after February.
 *     The obvious "same day as last time" implementation does exactly that:
 *     31 Jan → 28 Feb → 28 Mar → 28 Apr… The wanted date lives in the RULE.
 *   - "Fixing" the short-month rule to match iOS. iOS skips a month with no
 *     31st; Adam chose "use the last day". A control asserts the iOS answer
 *     is NOT what this gives.
 *   - Counting the next date from TODAY instead of the due date, so bins put
 *     out late slide off their Tuesday.
 *   - A malformed rule crashing the page instead of reading as a one-off.
 *
 * Every expected date here was worked out against a calendar by hand, not
 * captured from the code.
 *
 *   TZ=Europe/London npx tsx scripts/verify-recurrence.ts
 */
import {
  describeRule, formatRule, nextOccurrence, nthKindOfMonth, ordinal, parseRule,
  presetOf, presetRule, shortRule,
} from '../src/lib/recurrence'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const next = (rule: string, from: string, want: string | null, name: string) => {
  const got = nextOccurrence(rule, from)
  check(`${name}: ${rule} from ${from} → ${want}`, got === want, `got ${got}`)
}

// ── daily ───────────────────────────────────────────────────────────────────
next('D;1', '2026-09-25', '2026-09-26', 'every day')
next('D;3', '2026-09-25', '2026-09-28', 'every 3 days')
next('D;1', '2026-12-31', '2027-01-01', 'across a year end')

// ── weekly (2026-09-24 is a Thursday) ───────────────────────────────────────
next('W;1;BYDAY=TH', '2026-09-24', '2026-10-01', 'every week on Thursday')
next('W;2;BYDAY=MO,TH', '2026-09-21', '2026-09-24', 'every 2 weeks Mon+Thu: Monday → the Thursday of the SAME week')
next('W;2;BYDAY=MO,TH', '2026-09-24', '2026-10-05', 'every 2 weeks Mon+Thu: Thursday → the Monday TWO weeks on')
next('W;1;BYDAY=MO', '2026-09-23', '2026-09-28', 'a due date off the rule (a Wednesday) → the next Monday')
next('W;1;BYDAY=SA,SU', '2026-09-26', '2026-09-27', 'weekend days: Saturday → Sunday')
next('W;1;BYDAY=SA,SU', '2026-09-27', '2026-10-03', 'weekend days: Sunday → next Saturday (weeks start Monday)')

// ── monthly, "Each" ─────────────────────────────────────────────────────────
next('M;1;BYMD=1,15', '2026-09-01', '2026-09-15', 'the 1st and 15th: 1st → 15th')
next('M;1;BYMD=1,15', '2026-09-15', '2026-10-01', 'the 1st and 15th: 15th → next month\'s 1st')
next('M;2;BYMD=1,15', '2026-09-15', '2026-11-01', 'every 2 months: 15 Sep → 1 Nov')
next('M;1;BYMD=31', '2026-01-31', '2026-02-28', '🚨 Q6: the 31st in February is the 28th (last day)')
next('M;1;BYMD=31', '2026-02-28', '2026-03-31', '🚨 the clamp is NOT carried forward: 28 Feb → 31 Mar, not 28 Mar')
next('M;1;BYMD=31', '2026-03-31', '2026-04-30', 'the 31st in April is the 30th')
next('M;1;BYMD=31', '2028-01-31', '2028-02-29', 'a leap February: the 31st is the 29th')
next('M;1;BYMD=30,31', '2027-01-31', '2027-02-28', 'the 30th and 31st both clamp to 28 Feb, once')
next('M;1;BYMD=30,31', '2027-02-28', '2027-03-30', '…and March has both again')

// The whole year, one tick at a time, from the 31st of January.
{
  const want = ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31',
    '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']
  let at = '2026-01-31'
  const got: string[] = []
  for (let i = 0; i < 12; i++) got.push((at = nextOccurrence('M;1;BYMD=31', at) ?? 'null'))
  check('🚨 twelve ticks of "the 31st" land on every month\'s LAST day, never drifting', got.join() === want.join(),
    `got ${got.join(', ')}`)
}

// 🚨 CONTROL: what iOS would do. If this ever passes, someone has "fixed" Q6.
check('control: the iOS answer (skip February → 31 Mar) is NOT what this gives',
  nextOccurrence('M;1;BYMD=31', '2026-01-31') !== '2026-03-31')

// ── monthly, "On the…" ──────────────────────────────────────────────────────
// Oct 2026: the 31st is a Saturday, so the last weekday is Friday the 30th.
next('M;1;POS=-1;KIND=WD', '2026-09-30', '2026-10-30', 'the last weekday')
next('M;1;POS=1;KIND=MO', '2026-09-25', '2026-10-05', 'the first Monday, after this month\'s has passed')
next('M;1;POS=5;KIND=MO', '2026-10-05', '2026-11-30', 'the fifth Monday: October has none, so November\'s 30th')
next('M;1;POS=-1;KIND=DAY', '2027-01-31', '2027-02-28', 'the last day')
next('M;1;POS=2;KIND=WE', '2026-09-25', '2026-10-04', 'the second weekend day (Sat 3 Oct, Sun 4 Oct)')
check('nthKindOfMonth: Oct 2026 has no fifth Monday', nthKindOfMonth(2026, 9, 5, 'MO') === null)

// ── yearly ──────────────────────────────────────────────────────────────────
next('Y;1;BYMON=9;BYMD=24', '2026-09-24', '2027-09-24', 'every year on 24 Sep')
next('Y;2;BYMON=9;BYMD=24', '2026-09-24', '2028-09-24', 'every 2 years')
next('Y;1;BYMON=1,9;BYMD=24', '2026-09-24', '2027-01-24', 'two months a year: Sep → next Jan')
next('Y;1;BYMON=1,9;BYMD=24', '2027-01-24', '2027-09-24', 'two months a year: Jan → Sep')
next('Y;1;BYMON=2;BYMD=29', '2028-02-29', '2029-02-28', '🚨 29 Feb yearly: the 28th in a non-leap year (Q6)')
next('Y;1;BYMON=2;BYMD=29', '2031-02-28', '2032-02-29', '…and the 29th again in the next leap year')
next('Y;1;BYMON=9;POS=1;KIND=SU', '2026-09-25', '2027-09-05', 'the first Sunday of September')

// ── the clock change does not move a date ───────────────────────────────────
// BST ends Sun 25 Oct 2026 and starts Sun 28 Mar 2027.
next('W;1;BYDAY=SU', '2026-10-18', '2026-10-25', 'onto the autumn clock-change Sunday')
next('W;1;BYDAY=SU', '2026-10-25', '2026-11-01', 'off it')
next('D;1', '2026-10-24', '2026-10-25', 'every day, into the long day')
next('D;1', '2027-03-27', '2027-03-28', 'every day, into the short day')

// ── Q3: from the SCHEDULE, never from today ─────────────────────────────────
next('W;2;BYDAY=TU', '2026-09-22', '2026-10-06',
  'bins every other Tuesday, due 22 Sep: the next is 6 Oct however late it was put out')

// ── malformed rules are one-offs, never crashes ─────────────────────────────
for (const bad of ['', 'garbage', 'D;0', 'D;x', 'W;1', 'W;1;BYDAY=XX', 'M;1', 'M;1;BYMD=32',
  'M;1;BYMD=1;POS=1;KIND=MO', 'M;1;POS=1', 'Y;1;BYMD=24', 'Y;1;BYMON=13;BYMD=1', 'M;1;POS=6;KIND=MO']) {
  check(`unparseable "${bad}" → no next date, no throw`, nextOccurrence(bad, '2026-09-25') === null && parseRule(bad) === null)
}

// ── format round-trips ──────────────────────────────────────────────────────
for (const s of ['D;1', 'W;2;BYDAY=MO,TH', 'M;1;BYMD=1,15,31', 'M;3;POS=-1;KIND=WD', 'Y;1;BYMON=1,9;BYMD=24',
  'Y;1;BYMON=9;POS=1;KIND=SU']) {
  const rule = parseRule(s)
  check(`round-trip ${s}`, rule !== null && formatRule(rule) === s, rule ? formatRule(rule) : 'null')
}
check('BYDAY is stored Monday-first whatever order it was picked in',
  formatRule(parseRule('W;1;BYDAY=TH,MO')!) === 'W;1;BYDAY=MO,TH')

// ── presets ─────────────────────────────────────────────────────────────────
check('"Every Month" on 31 Jan is spelled out as the 31st', presetRule('M', '2026-01-31') === 'M;1;BYMD=31')
check('"Every Week" on a Thursday', presetRule('W', '2026-09-24') === 'W;1;BYDAY=TH')
check('"Every 2 Weeks" on a Thursday', presetRule('2W', '2026-09-24') === 'W;2;BYDAY=TH')
check('"Every Year" on 24 Sep', presetRule('Y', '2026-09-24') === 'Y;1;BYMON=9;BYMD=24')
check('a saved preset reads back as that preset', presetOf('W;1;BYDAY=TH', '2026-09-24') === 'W')
check('two weekdays is Custom, not a preset', presetOf('W;1;BYDAY=MO,TH', '2026-09-24') === 'custom')
check('no rule is Never', presetOf('', '2026-09-24') === 'never')

// ── words ───────────────────────────────────────────────────────────────────
const says = (rule: string, want: string) =>
  check(`describe ${rule}`, describeRule(rule) === want, `got "${describeRule(rule)}"`)
says('D;1', 'Repeats every day.')
says('W;2;BYDAY=MO,TH', 'Repeats every 2 weeks on Monday and Thursday.')
says('M;1;BYMD=1,15,31', 'Repeats every month on the 1st, 15th and 31st.')
says('M;1;POS=-1;KIND=WD', 'Repeats every month on the last weekday.')
says('Y;1;BYMON=9;POS=1;KIND=SU', 'Repeats every year on the first Sunday of September.')
says('Y;1;BYMON=9;BYMD=24', 'Repeats every year on the 24th of September.')
const short = (rule: string, want: string) =>
  check(`short ${rule}`, shortRule(rule) === want, `got "${shortRule(rule)}"`)
short('W;1;BYDAY=TH', 'Every week')
short('W;2;BYDAY=MO,TH', 'Every 2 weeks · Mon, Thu')
short('M;1;BYMD=1,15', 'Every month · 1st, 15th')
short('M;1;POS=-1;KIND=WD', 'Every month · last weekday')
short('Y;1;BYMON=9;POS=1;KIND=SU', 'Every year · first Sun of Sep')
check('ordinals: 1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 31st',
  [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal).join(' ') === '1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 31st')

if (failed) {
  console.log(`\nFAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll recurrence checks passed.')
