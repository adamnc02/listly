/**
 * verify-shop-confirmation — the Finish-shop confirmation's end-state rules.
 *
 * The bug this prevents: a confirmation that shows a tick and "Success" on a
 * timer. Standing in a shop with no signal, the transaction has NOT reached
 * Shared Ledger — the row is only queued on the phone — and a tick there is
 * exactly the kind of quiet lie this workstream keeps paying for: the first
 * anyone would know is a household budget that does not add up.
 *
 * Adam, 2026-09-21: "two cycles or until the sync is complete — whichever
 * finishes last", where complete means the ledger confirmed it; offline ends
 * on an honest "queued"; a refusal ends on a red cross.
 *
 *   TZ=Europe/London npx tsx scripts/verify-shop-confirmation.ts
 */
import { CAP_MS, CYCLE_MS, MIN_CYCLES, decide, ledgerOutcome, type CycleState } from '../src/lib/shopConfirmation'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

const online = { connected: true, connecting: false }
const offline = { connected: false, connecting: false }
const at = (cyclesDone: number, rest: Partial<CycleState>): CycleState => ({
  cyclesDone,
  elapsedMs: cyclesDone * CYCLE_MS,
  outcome: 'pending',
  ...online,
  ...rest,
})

// ── ledgerOutcome: reading the synced row ─────────────────────────────────
check('no row yet → pending', ledgerOutcome(undefined) === 'pending')
check('both null → pending', ledgerOutcome({ transaction_id: null, ledger_error: null }) === 'pending')
check("'' is null (the '' ↔ NULL mapping) → pending", ledgerOutcome({ transaction_id: '', ledger_error: '' }) === 'pending')
check('transaction_id set → ok', ledgerOutcome({ transaction_id: 'tx_1', ledger_error: null }) === 'ok')
check('ledger_error set → error', ledgerOutcome({ transaction_id: null, ledger_error: 'category not found' }) === 'error')

// ── "whichever finishes last" ─────────────────────────────────────────────
check('confirmed after 1 cycle still flies a 2nd note', decide(at(1, { outcome: 'ok' })) === 'continue')
check(`confirmed at cycle ${MIN_CYCLES} → tick`, decide(at(MIN_CYCLES, { outcome: 'ok' })) === 'ok')
check('pending at cycle 2, online → keeps flying', decide(at(2, {})) === 'continue')
check('confirmed at cycle 4 → tick at cycle 4', decide(at(4, { outcome: 'ok' })) === 'ok')
check('refused at cycle 2 → red cross', decide(at(2, { outcome: 'error' })) === 'error')
check('refused after 1 cycle still flies a 2nd note', decide(at(1, { outcome: 'error' })) === 'continue')

// ── the honesty rules ─────────────────────────────────────────────────────
check('offline, pending, cycle 2 → queued, never a tick', decide(at(2, offline)) === 'queued')
check('offline before cycle 2 → still flies two notes', decide(at(1, offline)) === 'continue')
check('reconnecting is not offline → keeps waiting', decide(at(2, { connected: false, connecting: true })) === 'continue')
const capCycle = Math.ceil(CAP_MS / CYCLE_MS)
check(`online but still pending at the cap (cycle ${capCycle}) → queued`, decide(at(capCycle, {})) === 'queued')
check('just under the cap → keeps flying', decide(at(capCycle - 1, {})) === 'continue')
check('confirmed exactly at the cap → tick, not queued', decide(at(capCycle, { outcome: 'ok' })) === 'ok')
// A tick is only ever the ledger's answer, whatever the clock says.
const everything: CycleState[] = []
for (let c = 0; c <= capCycle + 2; c++)
  for (const net of [online, offline, { connected: false, connecting: true }])
    everything.push(at(c, { ...net, outcome: 'pending' }))
check('no pending state ever produces a tick', everything.every((s) => decide(s) !== 'ok'))

// ── control: the naive timer this replaces ────────────────────────────────
// "Tick after two cycles" — prove the checks above would catch it.
const naive = (s: CycleState) => (s.cyclesDone >= MIN_CYCLES ? 'ok' : 'continue')
check('control: a timer-only version WOULD show a tick offline', naive(at(2, offline)) === 'ok')

if (failed) {
  console.log(`FAIL: ${failed} check(s)`)
  process.exit(1)
}
console.log('All checks passed')
