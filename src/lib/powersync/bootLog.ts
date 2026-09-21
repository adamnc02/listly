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

export type BootLevel = 'ok' | 'fail' | 'note'

export interface BootStep {
  at: string
  step: string
  level: BootLevel
  detail?: string
}

const steps: BootStep[] = []

export function recordBootStep(step: string, level: BootLevel, detail?: string): void {
  steps.push({ at: new Date().toLocaleTimeString('en-GB'), step, level, detail })
  const line = `[listly] boot: ${step} — ${level}${detail ? ` — ${detail}` : ''}`
  if (level === 'fail') console.error(line)
  else console.info(line)
}

export function readBootLog(): BootStep[] {
  return [...steps]
}

export function clearBootLog(): void {
  steps.length = 0
}

/**
 * The previous start-up's log, when it was abandoned — kept across ONE
 * reload in sessionStorage, so "Try again" on a stalled loading screen does
 * not also wipe the only record of where it stalled. A force-close still
 * loses it (sessionStorage dies with the app); Try again exists so that
 * nobody has to force-close.
 */
const PREVIOUS_KEY = 'listly:boot-previous'

export interface PreviousBoot {
  why: string
  steps: BootStep[]
}

export function keepBootLogForNextStart(why: string): void {
  try {
    sessionStorage.setItem(PREVIOUS_KEY, JSON.stringify({ why, steps } satisfies PreviousBoot))
  } catch {
    /* storage blocked — nothing to keep it in */
  }
}

export function readPreviousBoot(): PreviousBoot | null {
  try {
    const raw = sessionStorage.getItem(PREVIOUS_KEY)
    return raw ? (JSON.parse(raw) as PreviousBoot) : null
  } catch {
    return null
  }
}
