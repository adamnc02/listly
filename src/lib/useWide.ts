import { useSyncExternalStore } from 'react'
import { WIDE_QUERY } from './laptop'

/**
 * True at 768px and wider: the laptop view (TECHNICAL.md §24). Live, so
 * resizing a window across the line switches layout without a reload.
 * Nothing that can only happen on a phone depends on it being false.
 */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(WIDE_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function snapshot(): boolean {
  return window.matchMedia(WIDE_QUERY).matches
}
