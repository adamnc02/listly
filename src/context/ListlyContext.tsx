import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DeviceState, IsoDate, Item, Job, JobPage, List } from '../types'
import { newId } from '../lib/ids'
import { todayIso } from '../lib/date'
import {
  clearDismissal,
  loadDeviceState,
  pruneDeviceState,
  saveDeviceState,
  withDismissal,
  withDoneOpen,
  withListOpen,
} from '../lib/deviceState'
import { sampleJobs, sampleLists } from './sampleData'

/**
 * Listly's data layer.
 *
 * PHASE 1 ONLY: this holds the data in memory, exactly as the prototype
 * does, so the whole UI can be built and signed off before any schema
 * exists (PROMPT-01 §12, Phase 1: "In-memory data, exactly as the
 * prototype"). Phase 3 replaces the useState below with PowerSync watched
 * queries; every component above this file stays unchanged, which is the
 * point of putting the boundary here.
 *
 * What is NOT in memory: which lists are expanded, which banners are
 * dismissed, and which Done sections are open. Those are per-device
 * localStorage (Adam, 2026-09-20 — §5.7/§14 Q1) and are kept in a separate
 * `device` slice so it stays obvious that they are not household data and
 * must never be given a column.
 */

interface ListlyValue {
  lists: List[]
  jobs: Job[]
  device: DeviceState

  // Shopping
  visibleLists: List[]
  addList: (name: string, isDefault: boolean) => void
  deleteList: (id: string) => void
  toggleDefault: (id: string) => void
  setListOpen: (id: string, open: boolean) => void
  addItem: (listId: string, text: string) => void
  toggleItem: (listId: string, itemId: string) => void
  saveItem: (listId: string, itemId: string, text: string, moveToListId: string, newListName: string) => void
  deleteItem: (listId: string, itemId: string) => void
  reorderItems: (listId: string, fromIndex: number, toIndex: number) => void
  finishShop: (listId: string) => void

  // Jobs
  jobsFor: (page: JobPage) => Job[]
  addJob: (page: JobPage, text: string, due: IsoDate) => void
  toggleJob: (id: string) => void
  toggleRemind: (id: string) => void
  saveJob: (id: string, text: string, due: IsoDate, remind: boolean) => void
  deleteJob: (id: string) => void
  setDoneOpen: (page: JobPage, open: boolean) => void

  // Banners
  dismissBanner: (jobId: string) => void
}

const Ctx = createContext<ListlyValue | null>(null)

export function ListlyProvider({ children }: { children: ReactNode }) {
  const [lists, setLists] = useState<List[]>(sampleLists)
  const [jobs, setJobs] = useState<Job[]>(sampleJobs)
  const [device, setDevice] = useState<DeviceState>(() =>
    pruneDeviceState(
      loadDeviceState(),
      sampleLists.map((l) => l.id),
      sampleJobs.map((j) => j.id),
    ),
  )

  useEffect(() => {
    saveDeviceState(device)
  }, [device])

  /**
   * LISTLY-DESIGN.md §2: a default list always shows, even when empty. A
   * non-default list hides itself when empty — unless it has never held an
   * item yet, so a list you just made stays on screen long enough to put
   * something in it.
   */
  const visibleLists = useMemo(
    () => lists.filter((l) => l.isDefault || l.items.length > 0 || l.neverHadItems),
    [lists],
  )

  const mapList = useCallback((id: string, fn: (l: List) => List) => {
    setLists((prev) => prev.map((l) => (l.id === id ? fn(l) : l)))
  }, [])

  const addList = useCallback((name: string, isDefault: boolean) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const list: List = {
      id: newId(),
      name: trimmed,
      isDefault,
      items: [],
      createdAt: todayIso(),
      neverHadItems: true,
    }
    setLists((prev) => [...prev, list])
    // A list added from the Shopping page opens ready for its first item;
    // one added from Manage lists does not, because you are still in the
    // sheet and about to add another.
    if (!isDefault) setDevice((d) => withListOpen(d, list.id, true))
  }, [])

  const deleteList = useCallback((id: string) => {
    setLists((prev) => prev.filter((l) => l.id !== id))
  }, [])

  const toggleDefault = useCallback(
    (id: string) => mapList(id, (l) => ({ ...l, isDefault: !l.isDefault })),
    [mapList],
  )

  const setListOpen = useCallback((id: string, open: boolean) => {
    setDevice((d) => withListOpen(d, id, open))
  }, [])

  const addItem = useCallback(
    (listId: string, text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      mapList(listId, (l) => ({
        ...l,
        items: [...l.items, { id: newId(), text: trimmed, done: false }],
        neverHadItems: false,
      }))
    },
    [mapList],
  )

  const toggleItem = useCallback(
    (listId: string, itemId: string) =>
      mapList(listId, (l) => ({
        ...l,
        items: l.items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
      })),
    [mapList],
  )

  const deleteItem = useCallback(
    (listId: string, itemId: string) =>
      mapList(listId, (l) => ({ ...l, items: l.items.filter((i) => i.id !== itemId) })),
    [mapList],
  )

  /**
   * Rename, and/or move to another list. Moving keeps the SAME item object:
   * it is one row changing which list it belongs to, never a delete plus an
   * insert. That matters well before there is a database — PROMPT-01 §5.2
   * requires it so two devices converge on one row identity — so the rule
   * is built in from Phase 1 rather than retrofitted.
   */
  const saveItem = useCallback(
    (listId: string, itemId: string, text: string, moveToListId: string, newListName: string) => {
      const trimmedName = newListName.trim()
      let targetId = moveToListId

      setLists((prev) => {
        let next = prev
        if (!targetId && trimmedName) {
          targetId = newId()
          next = [
            ...next,
            {
              id: targetId,
              name: trimmedName,
              isDefault: false,
              items: [],
              createdAt: todayIso(),
              neverHadItems: true,
            },
          ]
        }

        const source = next.find((l) => l.id === listId)
        const item = source?.items.find((i) => i.id === itemId)
        if (!source || !item) return next

        const renamed: Item = { ...item, text: text.trim() || item.text }
        const moving = targetId !== '' && targetId !== listId

        return next.map((l) => {
          if (l.id === listId) {
            return moving
              ? { ...l, items: l.items.filter((i) => i.id !== itemId) }
              : { ...l, items: l.items.map((i) => (i.id === itemId ? renamed : i)) }
          }
          if (moving && l.id === targetId) {
            return { ...l, items: [...l.items, renamed], neverHadItems: false }
          }
          return l
        })
      })

      // The destination opens so the moved item is visible where it landed.
      if (targetId && targetId !== listId) setDevice((d) => withListOpen(d, targetId, true))
    },
    [],
  )

  const reorderItems = useCallback(
    (listId: string, fromIndex: number, toIndex: number) =>
      mapList(listId, (l) => {
        if (fromIndex === toIndex) return l
        const items = [...l.items]
        const [moved] = items.splice(fromIndex, 1)
        items.splice(toIndex, 0, moved)
        return { ...l, items }
      }),
    [mapList],
  )

  /**
   * Finish shop: ticked items go, unticked stay for next time, the list
   * collapses (LISTLY-DESIGN.md §2).
   *
   * Phase 4 adds the ledger step AFTER this — it does exactly this first,
   * then opens the price sheet only if the D4 gate is open (§8.2a).
   */
  const finishShop = useCallback(
    (listId: string) => {
      mapList(listId, (l) => ({ ...l, items: l.items.filter((i) => !i.done) }))
      setDevice((d) => withListOpen(d, listId, false))
    },
    [mapList],
  )

  // ---------- jobs ----------

  const jobsFor = useCallback((page: JobPage) => jobs.filter((j) => j.page === page), [jobs])

  const addJob = useCallback((page: JobPage, text: string, due: IsoDate) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setJobs((prev) => [...prev, { id: newId(), page, text: trimmed, due, remind: false, done: false }])
  }, [])

  const toggleJob = useCallback((id: string) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, done: !j.done } : j)))
  }, [])

  const toggleRemind = useCallback((id: string) => {
    setJobs((prev) =>
      // A reminder without a due date has nothing to fire against, so it is
      // refused here as well as by the CHECK constraint Phase 2 adds.
      prev.map((j) => (j.id === id && j.due ? { ...j, remind: !j.remind } : j)),
    )
  }, [])

  const saveJob = useCallback((id: string, text: string, due: IsoDate, remind: boolean) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id
          ? {
              ...j,
              text: text.trim() || j.text,
              due,
              // Removing the due date turns the reminder off
              // (LISTLY-DESIGN.md §3).
              remind: due !== '' && remind,
            }
          : j,
      ),
    )
    // Editing and saving a job re-arms its banner (LISTLY-DESIGN.md §4).
    setDevice((d) => clearDismissal(d, id))
  }, [])

  const deleteJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }, [])

  const setDoneOpen = useCallback((page: JobPage, open: boolean) => {
    setDevice((d) => withDoneOpen(d, page, open))
  }, [])

  const dismissBanner = useCallback((jobId: string) => {
    setDevice((d) => withDismissal(d, jobId))
  }, [])

  const value = useMemo<ListlyValue>(
    () => ({
      lists,
      jobs,
      device,
      visibleLists,
      addList,
      deleteList,
      toggleDefault,
      setListOpen,
      addItem,
      toggleItem,
      saveItem,
      deleteItem,
      reorderItems,
      finishShop,
      jobsFor,
      addJob,
      toggleJob,
      toggleRemind,
      saveJob,
      deleteJob,
      setDoneOpen,
      dismissBanner,
    }),
    [
      lists, jobs, device, visibleLists,
      addList, deleteList, toggleDefault, setListOpen,
      addItem, toggleItem, saveItem, deleteItem, reorderItems, finishShop,
      jobsFor, addJob, toggleJob, toggleRemind, saveJob, deleteJob, setDoneOpen,
      dismissBanner,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useListly(): ListlyValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useListly must be used inside <ListlyProvider>')
  return v
}
