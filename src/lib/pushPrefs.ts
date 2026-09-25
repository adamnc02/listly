import { supabase } from './supabaseClient'

/**
 * The per-person shopping-notifications switch (Adam, 2026-09-25: one switch
 * per person, covering "New stuff to buy" and "<List> complete", on every one
 * of their phones).
 *
 * `listly.push_prefs` is read and written over REST, NOT synced — like
 * push_subscriptions — so it needed no Sync Stream change. The last answer is
 * cached per device only so the switch shows something sensible offline; the
 * SERVER row is the truth, because that is what the push job reads.
 *
 * No row means ON. A person who never touches the switch is told.
 */

const cacheKey = (uid: string) => `listly:push-prefs:shopping:${uid}`

export function cachedShoppingPref(uid: string): boolean | null {
  try {
    const v = localStorage.getItem(cacheKey(uid))
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}

function cache(uid: string, on: boolean) {
  try {
    localStorage.setItem(cacheKey(uid), on ? '1' : '0')
  } catch {
    /* private window, storage refused: the switch still works, just uncached */
  }
}

export async function readShoppingPref(uid: string): Promise<boolean> {
  const { data, error } = await supabase.from('push_prefs').select('shopping').eq('user_id', uid).maybeSingle()
  if (error) throw new Error(error.message)
  const on = data ? data.shopping !== false : true
  cache(uid, on)
  return on
}

export async function writeShoppingPref(uid: string, on: boolean): Promise<void> {
  const { error } = await supabase
    .from('push_prefs')
    .upsert({ user_id: uid, shopping: on, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
  cache(uid, on)
}
