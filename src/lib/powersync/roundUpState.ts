import { useCallback, useEffect, useRef, useState } from 'react'
import { sfl } from '../supabaseClient'
import { ROUND_UP_OFF, type RoundUpState } from '../roundUp'
import {
  cachedRoundUpFor,
  loadRoundUpCache,
  saveRoundUpCache,
  withRoundUpAnswer,
} from '../roundUpCache'

/**
 * PROMPT-05 §2.1 — the one thing Listly cannot read from its own mirror.
 *
 * Listly already syncs `pots` (it needs `is_coin_jar` to EXCLUDE coin jars
 * from the location picker), but it has NO access to `pay_cycles` — the
 * round-up switch, its effective-from and its dated history. Adding that
 * table to Listly's sync stream would replicate a household's entire
 * financial configuration into a shopping app to answer one yes/no question,
 * and would grow the shared `powersync` publication. So one RPC answers the
 * one question:
 *
 *   shared_finance_ledger.round_up_state_for(p_person_id, p_date)
 *     -> (enabled boolean, jar_pot_id text)
 *
 * 🚨 It is READ-ONLY, household-scoped server-side, and returns
 * `enabled = false` — never a null jar with rounding on — for a person with
 * no Coin Jar. Listly's own CHECK would otherwise discard the shop (§27).
 *
 * 🚨 The answer is CACHED on the phone (roundUpCache.ts), because Finish shop
 * has to work with no signal. This hook returns the cached answer straight
 * away and replaces it when the network answers; it never blocks the sheet,
 * and it never turns rounding ON from an empty cache without a real answer.
 */
export async function fetchRoundUpState(personId: string, dateIso: string): Promise<RoundUpState> {
  const { data, error } = await sfl().rpc('round_up_state_for', {
    p_person_id: personId,
    p_date: dateIso,
  })
  if (error) throw error
  // A `returns table` function comes back as an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { enabled?: unknown; jar_pot_id?: unknown }
    | null
    | undefined
  const jarPotId = typeof row?.jar_pot_id === 'string' ? row.jar_pot_id : ''
  const enabled = row?.enabled === true && jarPotId !== ''
  return enabled ? { enabled: true, jarPotId } : ROUND_UP_OFF
}

/**
 * The round-up answer for one person on one date, for the Finish shop sheet.
 *
 * `personId` is the OWNER of the picked location — never the signed-in user
 * (§1.19d, trap 3). Pass '' when nothing personal is picked and no call is
 * made at all.
 *
 * Refreshing on every change of person or date is deliberate: it is one tiny
 * call, made while somebody is reading a sheet, and it means the common case
 * (signal in the shop) is never stale. With no signal the call fails, the
 * cached answer stands, and nothing is shown about it — Adam, 2026-09-21.
 */
export function useRoundUpState(personId: string, dateIso: string): RoundUpState {
  const [state, setState] = useState<RoundUpState>(() =>
    personId ? cachedRoundUpFor(loadRoundUpCache(), personId) : ROUND_UP_OFF,
  )
  // Survives a re-render without re-reading localStorage, and keeps the
  // "which request am I still interested in" check honest across awaits.
  const latest = useRef(0)

  const refresh = useCallback(async (person: string, date: string, token: number) => {
    try {
      const answer = await fetchRoundUpState(person, date)
      if (latest.current !== token) return
      saveRoundUpCache(withRoundUpAnswer(loadRoundUpCache(), person, answer))
      setState(answer)
    } catch {
      // No signal, or the RPC is not deployed yet. The cached answer stands;
      // an empty cache means no rounding, which is the safe direction.
    }
  }, [])

  useEffect(() => {
    if (!personId) {
      setState(ROUND_UP_OFF)
      return
    }
    const token = ++latest.current
    setState(cachedRoundUpFor(loadRoundUpCache(), personId))
    void refresh(personId, dateIso, token)
  }, [personId, dateIso, refresh])

  return state
}
