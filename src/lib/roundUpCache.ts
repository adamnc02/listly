/**
 * PROMPT-05 §0.3 — the last known round-up answer for each person, kept on
 * this phone.
 *
 * 🚨 WHY A CACHE AT ALL. `round_up_state_for` is an RPC, and an RPC needs
 * signal. Finish shop is built to work standing in a shop with none — that is
 * why every other picker reads a `lst_ref_` mirror rather than the network.
 * An online-only rounding step would leave the original bug (a personal card
 * shop from Listly silently not rounding) alive in exactly the place it
 * bites. Adam, 2026-09-21, chose to cache.
 *
 * 🚨 NO ANSWER NEVER MEANS YES. A person this phone has never had an answer
 * for does not round. Every read falls back to "off", and a parse failure,
 * a private window or full storage all land in the same safe place.
 *
 * 🚨 KEYED ON THE PERSON, not the signed-in user. Ella's Current Account
 * uses Ella's answer and Ella's jar (§1.19d — her switch, her jar). Keying on
 * the login would round Ella's shop into Adam's jar on Adam's phone, which is
 * the §40 failure: correct with one person, wrong the moment there are two.
 *
 * Staleness is bounded by what it can cost: the only way to be wrong is to
 * change the switch in the ledger app while Listly has no signal, and Listly
 * then books exactly what it displayed — the two apps never disagree about
 * the shop in front of you.
 */

import { ROUND_UP_OFF, type RoundUpState } from './roundUp'

const KEY = 'listly:round-up-state:v1'

export interface CachedRoundUp extends RoundUpState {
  /** When this phone last got a real answer, ISO instant. Diagnostics only. */
  fetchedAt: string
}

export type RoundUpCache = Record<string, CachedRoundUp>

export function loadRoundUpCache(): RoundUpCache {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: RoundUpCache = {}
    for (const [personId, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const e = v as Partial<CachedRoundUp>
      // An entry that says "on" without naming a jar is malformed, and a
      // rounded shop with no jar id fails the both-or-neither CHECK and is
      // DISCARDED by the connector (§27). Read it as off.
      const jarPotId = typeof e.jarPotId === 'string' ? e.jarPotId : ''
      const enabled = e.enabled === true && jarPotId !== ''
      out[personId] = {
        enabled,
        jarPotId: enabled ? jarPotId : '',
        fetchedAt: typeof e.fetchedAt === 'string' ? e.fetchedAt : '',
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveRoundUpCache(cache: RoundUpCache): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Storage unavailable or full. This session keeps working from memory;
    // the worst case is a shop that does not round, never one that rounds
    // wrongly.
  }
}

/** The answer for one person, or "off" when this phone has never had one. */
export function cachedRoundUpFor(cache: RoundUpCache, personId: string): RoundUpState {
  const hit = cache[personId]
  if (!hit || !hit.enabled || !hit.jarPotId) return ROUND_UP_OFF
  return { enabled: true, jarPotId: hit.jarPotId }
}

export function withRoundUpAnswer(
  cache: RoundUpCache,
  personId: string,
  state: RoundUpState,
  at: string = new Date().toISOString(),
): RoundUpCache {
  const enabled = state.enabled && state.jarPotId !== ''
  return {
    ...cache,
    [personId]: { enabled, jarPotId: enabled ? state.jarPotId : '', fetchedAt: at },
  }
}

/**
 * Drops people who no longer exist in the household, so the stored object
 * cannot grow without bound — and so a person removed from the ledger stops
 * carrying a remembered "on" around. Same shape as pruneDeviceState.
 */
export function pruneRoundUpCache(cache: RoundUpCache, personIds: string[]): RoundUpCache {
  const live = new Set(personIds)
  const out: RoundUpCache = {}
  for (const [personId, entry] of Object.entries(cache)) {
    if (live.has(personId)) out[personId] = entry
  }
  return out
}

/**
 * 🚨 Signing out, or a different account signing in, must clear this.
 * The next account's phone has no business inheriting a remembered "rounding
 * is on, into pot X" for a household it may not even be in — the same rule
 * accountSwitch.ts applies to the synced data.
 */
export function clearRoundUpCache(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to do: an unreadable store is also an unwritable one, and the
    // fallback everywhere is "off".
  }
}
