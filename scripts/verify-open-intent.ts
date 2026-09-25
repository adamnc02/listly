/**
 * verify-open-intent — a tapped notification lands on the right tab, and a
 * job reminder names the right job to flash.
 *
 * The bug this follows (Adam, UAT 2026-09-25): tapping a reminder opened
 * Shopping. The fix writes the destination down in public/sw.js as well as
 * sending it — and public/sw.js is plain JS that cannot import, so it carries
 * its own copy of the tag pattern. This checks that copy against the real one
 * on every tag shape the server sends, so the two cannot drift.
 *
 *   TZ=Europe/London npx tsx scripts/verify-open-intent.ts
 */
import { readFileSync } from 'node:fs'
import { jobIdFromTag, parseOpen } from '../src/lib/openIntent'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

// ── the URL ─────────────────────────────────────────────────────────────────
const o = (url: string) => parseOpen(url)
check('?tab=house&job=Ab3kQz9P → House jobs, flash that job',
  o('https://x/listly/?tab=house&job=Ab3kQz9P').tab === 'house' && o('https://x/listly/?tab=house&job=Ab3kQz9P').jobId === 'Ab3kQz9P')
check('?tab=mine → To-Do, nothing to flash', o('?tab=mine').tab === 'mine' && o('?tab=mine').jobId === null)
check('?tab=shopping&job=… → Shopping, and never a flash', o('?tab=shopping&job=Ab3kQz9P').jobId === null)
check('no tab → nothing (the app stays where it is)', o('https://x/listly/').tab === null)
check('an unknown tab is ignored', o('?tab=ledger').tab === null)
check('a malformed job id is ignored', o('?tab=house&job=<script>').jobId === null)

// ── the tag → job id, on every shape the server sends ───────────────────────
// Keys from silver-octo-invention 20260925090000 and 20260925180000.
const tags: Array<[string, string | null]> = [
  ['house_jobs:Ab3kQz9P:00000000-0000-0000-0000-00000000000e:2026-09-26:daily', 'Ab3kQz9P'],
  ['my_jobs:Zz9x2Kq7:2026-09-26:18:00:00000000-0000-0000-0000-00000000000a:once', 'Zz9x2Kq7'],
  ['add:tesco:00000000-0000-0000-0000-00000000000e:1790000000', null],
  ['done:c7Hk2mPq', null],
  ['listly-test', null],
  ['', null],
]
for (const [tag, want] of tags) {
  check(`tag "${tag.slice(0, 32)}…" → ${want}`, jobIdFromTag(tag) === want, `got ${jobIdFromTag(tag)}`)
}

// 🚨 public/sw.js's own copy must behave identically.
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const m = /const JOB_TAG = (\/.*\/)\n/.exec(sw)
check('public/sw.js declares JOB_TAG', m !== null)
if (m) {
  const src = m[1]
  const swRe = new RegExp(src.slice(1, src.lastIndexOf('/')), src.slice(src.lastIndexOf('/') + 1))
  for (const [tag, want] of tags) {
    const got = swRe.exec(tag)?.[1] ?? null
    check(`sw.js agrees on "${tag.slice(0, 24)}…"`, got === want, `sw.js got ${got}`)
  }
}
check('public/sw.js still has NO fetch handler', !/addEventListener\(\s*['"]fetch['"]/.test(sw))

if (failed) {
  console.log(`\nFAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll open-intent checks passed.')
