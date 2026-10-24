import type { List } from '../types'

/** The card's count pill, and the laptop title's: what is left to get. */
export function listCount(list: List): string {
  const left = list.items.filter((i) => !i.done).length
  return list.items.length === 0 ? 'empty' : left ? `${left} to get` : 'all got'
}
