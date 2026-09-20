/**
 * A tiny in-memory record of what the sync boot actually did.
 *
 * 🚨 Why this exists. On 2026-09-20 the Sync check reported "PowerSync
 * connection: Not connected. **No error reported**" while every other check
 * passed — the token was accepted with HTTP 200. So the failure was in the
 * boot sequence, and nothing anywhere had recorded which step it reached.
 *
 * PowerSync's own SyncStatus only describes the *connection*. It cannot tell
 * you that `connect()` was never called, or that `subscribe()` threw, because
 * from its point of view nothing ever started. This fills that gap: each step
 * is recorded as it happens, so "got to step 3 and stopped" is visible
 * instead of inferred.
 *
 * Deliberately module-level and not React state: it has to survive the
 * component unmounting, and it is written from an async boot that outlives
 * any single render.
 */

export interface BootStep {
  at: string
  step: string
  ok: boolean
  detail?: string
}

const steps: BootStep[] = []

export function recordBootStep(step: string, ok: boolean, detail?: string): void {
  steps.push({ at: new Date().toLocaleTimeString('en-GB'), step, ok, detail })
  const line = `[listly] boot: ${step} — ${ok ? 'ok' : 'FAILED'}${detail ? ` — ${detail}` : ''}`
  if (ok) console.info(line)
  else console.error(line)
}

export function readBootLog(): BootStep[] {
  return [...steps]
}

export function clearBootLog(): void {
  steps.length = 0
}
