import type { DeviceState, IsoDate, JobPage } from '../types'
import { todayIso } from './date'

/**
 * Per-device UI state. Never synced, never a database column.
 *
 * Adam, 2026-09-20 (PROMPT-01 §5.7 and §14 Q1): which lists are expanded and
 * which banners are dismissed are properties of THIS phone, not of the
 * household. Syncing them would mean Ella collapsing the Tesco list collapses
 * it on Adam's phone in the middle of a shop. So `is_open` never becomes a
 * column in `listly.shopping_lists`, and this file is where that decision
 * lives.
 *
 * Banner dismissal lasts until the date changes or the job is edited
 * (PROMPT-01 §5.7). That is why a dismissal stores the date it happened
 * rather than `true`: a dismissal made yesterday is simply not a dismissal
 * today, with no clean-up job needed. "Or the job is edited" is handled at
 * the point of the edit, by `clearDismissal`.
 *
 * Everything here is wrapped in try/catch and falls back to defaults. A
 * private window, cleared site data, or a browser refusing storage must
 * leave the app fully working — losing which lists were expanded is not a
 * failure worth an error.
 */

const KEY = 'listly:device-state:v1'

const EMPTY: DeviceState = {
  openLists: {},
  dismissedBanners: {},
  doneOpen: { house: false, mine: false },
}

export function loadDeviceState(): DeviceState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<DeviceState>
    return {
      openLists: parsed.openLists ?? {},
      dismissedBanners: parsed.dismissedBanners ?? {},
      doneOpen: { ...EMPTY.doneOpen, ...(parsed.doneOpen ?? {}) },
    }
  } catch {
    return EMPTY
  }
}

export function saveDeviceState(state: DeviceState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable or full. The app keeps working from memory for
    // this session; only the remembered UI state is lost.
  }
}

/** A banner is dismissed only for the day it was dismissed on. */
export function isDismissedToday(state: DeviceState, jobId: string): boolean {
  return state.dismissedBanners[jobId] === todayIso()
}

export function withDismissal(state: DeviceState, jobId: string, on: IsoDate = todayIso()): DeviceState {
  return { ...state, dismissedBanners: { ...state.dismissedBanners, [jobId]: on } }
}

/** Editing and saving a job re-arms its banner (LISTLY-DESIGN.md §4). */
export function clearDismissal(state: DeviceState, jobId: string): DeviceState {
  if (!(jobId in state.dismissedBanners)) return state
  const next = { ...state.dismissedBanners }
  delete next[jobId]
  return { ...state, dismissedBanners: next }
}

export function withListOpen(state: DeviceState, listId: string, open: boolean): DeviceState {
  return { ...state, openLists: { ...state.openLists, [listId]: open } }
}

export function withDoneOpen(state: DeviceState, page: JobPage, open: boolean): DeviceState {
  return { ...state, doneOpen: { ...state.doneOpen, [page]: open } }
}

/**
 * Drops remembered state for lists and jobs that no longer exist, so the
 * stored object cannot grow without bound as lists come and go. Cheap, and
 * it runs on load rather than on every write.
 */
export function pruneDeviceState(state: DeviceState, listIds: string[], jobIds: string[]): DeviceState {
  const lists = new Set(listIds)
  const jobs = new Set(jobIds)
  const today = todayIso()
  const openLists: Record<string, boolean> = {}
  for (const [id, open] of Object.entries(state.openLists)) {
    if (lists.has(id)) openLists[id] = open
  }
  const dismissedBanners: Record<string, IsoDate> = {}
  for (const [id, on] of Object.entries(state.dismissedBanners)) {
    if (jobs.has(id) && on === today) dismissedBanners[id] = on
  }
  return { ...state, openLists, dismissedBanners }
}
