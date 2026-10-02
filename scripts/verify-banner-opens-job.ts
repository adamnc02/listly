/**
 * verify-banner-opens-job — tapping a due-soon banner opens its job's tab and
 * flashes the row, exactly as tapping that job's reminder notification does,
 * and ✕ still only dismisses (TECHNICAL.md §13).
 *
 * The banner goes through the notification's own path: it builds the same
 * `?tab=…&job=…` URL and hands it to `parseOpen()`. If the URL it builds is
 * one `parseOpen()` refuses, the tap does nothing at all and nothing errors,
 * so this proves the round trip on real ids from `newId()`.
 *
 * The other way to break it is silent too: ✕ sits inside the tappable banner,
 * so without `stopPropagation()` every dismiss would also jump tabs.
 *
 *   TZ=Europe/London npx tsx scripts/verify-banner-opens-job.ts
 */
import { readFileSync } from 'node:fs'
import { jobOpenUrl, parseOpen } from '../src/lib/openIntent'
import { newId } from '../src/lib/ids'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

// ── the URL round trip ──────────────────────────────────────────────────────
for (const page of ['house', 'mine'] as const) {
  const job = { id: 'Ab3kQz9P', page }
  const o = parseOpen(jobOpenUrl(job))
  check(`a ${page} banner opens the ${page} tab and flashes that job`,
    o.tab === page && o.jobId === job.id, JSON.stringify(o))
}

let refused = 0
for (let i = 0; i < 2000; i++) {
  const job = { id: newId(), page: i % 2 ? 'house' as const : 'mine' as const }
  const o = parseOpen(jobOpenUrl(job))
  if (o.tab !== job.page || o.jobId !== job.id) refused++
}
check('2000 real newId() ids all survive parseOpen()', refused === 0, `${refused} refused`)

// Control: the round-trip check can fail. An id parseOpen() will not accept
// lands on the tab and flashes nothing.
const bad = parseOpen(jobOpenUrl({ id: 'has space', page: 'house' }))
check('control: an id parseOpen() refuses opens the tab but flashes nothing',
  bad.tab === 'house' && bad.jobId === null, JSON.stringify(bad))

// ── the component: the banner opens, ✕ only dismisses ───────────────────────
const banner = readFileSync(new URL('../src/components/DueSoonBanners.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

check('the whole banner carries the tap', /className="alert"[^>]*onClick=\{\(\) => onOpen\(job\)\}/.test(banner))

const closeHandler = /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\)\s*dismissBanner\(job\.id\)\s*\}\}/
check('✕ stops its tap reaching the banner, then dismisses', closeHandler.test(banner))
check('control: ✕ without stopPropagation() is caught',
  !closeHandler.test(banner.replace('e.stopPropagation()', '')))

check('opening does not dismiss (dismissBanner is called once, by ✕)',
  (banner.match(/dismissBanner\(/g) ?? []).length === 1)
check('App routes the banner through the notification path',
  app.includes('<DueSoonBanners onOpen={(job) => apply(jobOpenUrl(job))} />'))

if (failed) {
  console.log(`\nFAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll banner-open checks passed.')
