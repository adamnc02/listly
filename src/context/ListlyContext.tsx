import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  DeviceState, IsoDate, Job, JobPage, LedgerCategory, List, ShopCompletionDraft,
} from '../types'
import {
  clearDismissal,
  loadDeviceState,
  pruneDeviceState,
  saveDeviceState,
  withDismissal,
  withDoneOpen,
  withListOpen,
} from '../lib/deviceState'
import { useHouseholdId } from '../components/SyncRoot'
import { useAuth } from './AuthContext'
import {
  useFailedCompletions, useLedgerCategories, useLedgerGate, useLocationOptions,
  type FailedCompletion,
} from '../lib/powersync/ledger'
import type { LocationOption } from '../types'
import { useWatchedQuery } from '../lib/powersync/useWatchedQuery'
import { byPosition, rowToItem, rowToJob, rowToList } from '../lib/powersync/mapping'
import * as writes from '../lib/powersync/writes'

/**
 * Listly's data layer, now backed by PowerSync.
 *
 * 🚨 THE INTERFACE BELOW IS UNCHANGED FROM PHASE 1. That was the point of
 * putting the boundary here: every page, sheet and component was written
 * against this shape while the data was in memory, and none of them needed
 * touching when the backend arrived. Phase 1's `useState` became watched
 * queries; the mutators became narrow SQL.
 *
 * What is still NOT here: which lists are expanded, which banners are
 * dismissed, which Done sections are open. Those are per-device localStorage
 * (Adam, 2026-09-20) and are deliberately kept in a separate `device` slice
 * so it stays obvious they are not household data and must never get a
 * column.
 */

/**
 * What Finish shop hands to the price sheet. Captured BEFORE the ticked items
 * are deleted, because `itemsSnapshot` is exactly those rows.
 */
export interface ShopSnapshot {
  listId: string
  listName: string
  itemsSnapshot: string
  /** '' → the sheet inserts a category step at the front, once. */
  categoryId: string
}

interface ListlyValue {
  lists: List[]
  jobs: Job[]
  device: DeviceState

  visibleLists: List[]
  addList: (name: string, isDefault: boolean) => Promise<void>
  deleteList: (id: string) => void
  toggleDefault: (id: string) => void
  setListOpen: (id: string, open: boolean) => void
  addItem: (listId: string, text: string) => Promise<void>
  toggleItem: (listId: string, itemId: string) => void
  saveItem: (listId: string, itemId: string, text: string, moveToListId: string, newListName: string) => void
  deleteItem: (listId: string, itemId: string) => void
  reorderItems: (listId: string, fromIndex: number, toIndex: number) => void
  /**
   * Clears the ticked items and collapses the list — exactly what it did
   * before Phase 4 — and returns a snapshot of what was ticked so the caller
   * can open the price sheet. The snapshot is taken FIRST, because the rows
   * it describes are about to be deleted.
   */
  finishShop: (listId: string) => Promise<ShopSnapshot>

  // ── the ledger bridge (Phase 4) ──────────────────────────────────────────
  /**
   * 🚨 D4. True when the household has at least one `people` row. Everything
   * ledger-shaped in the UI is behind this, and with no ledger NONE of it
   * renders — no price sheet, no category chip, no mention of the ledger.
   */
  ledgerGateOpen: boolean
  categories: LedgerCategory[]
  locationOptions: LocationOption[]
  setListCategory: (listId: string, categoryId: string) => void
  saveShopCompletion: (draft: ShopCompletionDraft) => Promise<void>
  failedCompletions: FailedCompletion[]
  retryLedger: (completionId: string) => void

  jobsFor: (page: JobPage) => Job[]
  addJob: (page: JobPage, text: string, due: IsoDate) => Promise<void>
  toggleJob: (id: string) => void
  toggleRemind: (id: string) => void
  saveJob: (id: string, text: string, due: IsoDate, remind: boolean) => void
  deleteJob: (id: string) => void
  setDoneOpen: (page: JobPage, open: boolean) => void

  dismissBanner: (jobId: string) => void
}

const Ctx = createContext<ListlyValue | null>(null)

/** Fire-and-forget: a write failure is logged, never silently swallowed. */
const run = (p: Promise<unknown>) => {
  void p.catch((e) => console.error('[listly] write failed:', e))
}

export function ListlyProvider({ children }: { children: ReactNode }) {
  const householdId = useHouseholdId()
  const { session } = useAuth()
  const userId = session?.user?.id ?? null

  // All four read the local lst_ref_ mirror, so they work with no signal and
  // re-evaluate on every sync delivery — the moment a `people` row appears in
  // the ledger, the price step appears in Listly. No reload, no setting.
  const ledgerGateOpen = useLedgerGate()
  const categories = useLedgerCategories()
  const locationOptions = useLocationOptions(userId)
  const failedCompletions = useFailedCompletions()

  const listRows = useWatchedQuery('SELECT * FROM lst_shopping_lists')
  const itemRows = useWatchedQuery('SELECT * FROM lst_shopping_items')
  const houseRows = useWatchedQuery('SELECT * FROM lst_house_jobs')
  const mineRows = useWatchedQuery('SELECT * FROM lst_my_jobs')

  const lists = useMemo<List[]>(() => {
    const byList = new Map<string, typeof itemRows>()
    for (const row of itemRows) {
      const key = String(row.list_id ?? '')
      const bucket = byList.get(key)
      if (bucket) bucket.push(row)
      else byList.set(key, [row])
    }
    return [...listRows].sort(byPosition).map((row) => {
      const items = (byList.get(String(row.id)) ?? []).sort(byPosition).map(rowToItem)
      return rowToList(row, items)
    })
  }, [listRows, itemRows])

  const jobs = useMemo<Job[]>(
    () => [
      ...[...houseRows].sort(byPosition).map((r) => rowToJob(r, 'house')),
      ...[...mineRows].sort(byPosition).map((r) => rowToJob(r, 'mine')),
    ],
    [houseRows, mineRows],
  )

  const [device, setDevice] = useState<DeviceState>(() => loadDeviceState())

  // Prune remembered UI state for lists and jobs that no longer exist, so the
  // stored object cannot grow without bound. Runs on delivery, not on write.
  //
  // This cannot be derived during render: it reacts to rows ARRIVING from
  // another device, which is exactly the external-system case the rule
  // carves out.
  // (oxlint flags set-state-in-effect here. It cannot be derived during
  // render: it reacts to rows ARRIVING from another device, which is the
  // external-system case the rule carves out.)
  useEffect(() => {
    setDevice((d) => pruneDeviceState(d, lists.map((l) => l.id), jobs.map((j) => j.id)))
  }, [lists, jobs])

  useEffect(() => {
    saveDeviceState(device)
  }, [device])

  /**
   * A default list always shows, even when empty. A non-default list hides
   * itself when empty — unless it has never held an item, so a list you just
   * made stays on screen long enough to put something in it.
   */
  const visibleLists = useMemo(
    () => lists.filter((l) => l.isDefault || l.items.length > 0 || l.neverHadItems),
    [lists],
  )

  const findJob = useCallback((id: string) => jobs.find((j) => j.id === id), [jobs])

  const addList = useCallback(
    async (name: string, isDefault: boolean) => {
      const trimmed = name.trim()
      if (!trimmed) return
      // Deliberately NOT wrapped in run(): the caller awaits this so it can
      // show the user why it failed. Swallowing the error here is what made
      // "Add list did nothing" undiagnosable.
      const id = await writes.insertList(householdId, trimmed, isDefault)
      // A list added from the Shopping page opens ready for its first item;
      // one added from Manage lists does not, because you are still in the
      // sheet and about to add another.
      if (!isDefault) setDevice((d) => withListOpen(d, id, true))
    },
    [householdId],
  )

  const deleteList = useCallback((id: string) => run(writes.deleteList(id)), [])
  const toggleDefault = useCallback(
    (id: string) => {
      const list = lists.find((l) => l.id === id)
      if (list) run(writes.setListDefault(id, !list.isDefault))
    },
    [lists],
  )
  const setListOpen = useCallback((id: string, open: boolean) => {
    setDevice((d) => withListOpen(d, id, open))
  }, [])

  // Not wrapped in run(): the caller awaits it so a failed write can be
  // shown rather than logged to a console nobody is reading.
  const addItem = useCallback(
    async (listId: string, text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      await writes.insertItem(householdId, listId, trimmed)
    },
    [householdId],
  )

  const toggleItem = useCallback(
    (listId: string, itemId: string) => {
      const item = lists.find((l) => l.id === listId)?.items.find((i) => i.id === itemId)
      if (item) run(writes.setItemDone(itemId, !item.done))
    },
    [lists],
  )

  const deleteItem = useCallback((_listId: string, itemId: string) => run(writes.deleteItem(itemId)), [])

  const saveItem = useCallback(
    (listId: string, itemId: string, text: string, moveToListId: string, newListName: string) => {
      const trimmedText = text.trim()
      const trimmedName = newListName.trim()
      run(
        (async () => {
          const item = lists.find((l) => l.id === listId)?.items.find((i) => i.id === itemId)
          if (trimmedText && item && trimmedText !== item.text) {
            await writes.renameItem(itemId, trimmedText)
          }
          let target = moveToListId
          if (!target && trimmedName) {
            target = await writes.insertList(householdId, trimmedName, false)
          }
          if (target && target !== listId) {
            await writes.moveItem(itemId, target)
            setDevice((d) => withListOpen(d, target, true))
          }
        })(),
      )
    },
    [householdId, lists],
  )

  const reorderItems = useCallback(
    (listId: string, fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return
      const item = lists.find((l) => l.id === listId)?.items[fromIndex]
      if (item) run(writes.repositionItem(listId, item.id, toIndex))
    },
    [lists],
  )

  const finishShop = useCallback(
    async (listId: string): Promise<ShopSnapshot> => {
      const list = lists.find((l) => l.id === listId)
      // 🚨 Read the ticked names BEFORE deleting them. This is the whole
      // reason finishShop is async now.
      const ticked = await writes.tickedItemNames(listId)
      await writes.clearDoneItems(listId)
      setDevice((d) => withListOpen(d, listId, false))
      return {
        listId,
        listName: list?.name ?? '',
        itemsSnapshot: ticked.join('\n'),
        categoryId: list?.categoryId ?? '',
      }
    },
    [lists],
  )

  const setListCategory = useCallback((listId: string, categoryId: string) => {
    run(writes.setListCategory(listId, categoryId))
  }, [])

  const saveShopCompletion = useCallback(
    async (draft: ShopCompletionDraft) => {
      // A list with no category is asked once, and the answer is saved back
      // onto the list so the normal case stays three steps (§8.2d).
      const list = lists.find((l) => l.id === draft.listId)
      if (list && draft.categoryId && list.categoryId !== draft.categoryId) {
        await writes.setListCategory(draft.listId, draft.categoryId)
      }
      // Deliberately not wrapped in run(): the sheet awaits this so it can
      // show the user why it failed rather than closing on a lie.
      await writes.insertShopCompletion(householdId, draft)
    },
    [householdId, lists],
  )

  const retryLedger = useCallback((id: string) => run(writes.retryLedgerWrite(id)), [])

  const jobsFor = useCallback((page: JobPage) => jobs.filter((j) => j.page === page), [jobs])

  const addJob = useCallback(
    async (page: JobPage, text: string, due: IsoDate) => {
      const trimmed = text.trim()
      if (!trimmed) return
      await writes.insertJob(page, householdId, trimmed, due)
    },
    [householdId],
  )

  const toggleJob = useCallback(
    (id: string) => {
      const job = findJob(id)
      if (job) run(writes.setJobDone(job.page, id, !job.done))
    },
    [findJob],
  )

  const toggleRemind = useCallback(
    (id: string) => {
      const job = findJob(id)
      // A reminder fires three days before a due date; without one there is
      // nothing to fire against, and the CHECK constraint would reject it.
      if (job && job.due) run(writes.setJobRemind(job.page, id, !job.remind))
    },
    [findJob],
  )

  const saveJob = useCallback(
    (id: string, text: string, due: IsoDate, remind: boolean) => {
      const job = findJob(id)
      if (!job) return
      run(writes.saveJob(job.page, id, text.trim() || job.text, due, remind))
      // Editing and saving a job re-arms its banner.
      setDevice((d) => clearDismissal(d, id))
    },
    [findJob],
  )

  const deleteJob = useCallback(
    (id: string) => {
      const job = findJob(id)
      if (job) run(writes.deleteJob(job.page, id))
    },
    [findJob],
  )

  const setDoneOpen = useCallback((page: JobPage, open: boolean) => {
    setDevice((d) => withDoneOpen(d, page, open))
  }, [])

  const dismissBanner = useCallback((jobId: string) => {
    setDevice((d) => withDismissal(d, jobId))
  }, [])

  const value = useMemo<ListlyValue>(
    () => ({
      lists, jobs, device, visibleLists,
      addList, deleteList, toggleDefault, setListOpen,
      addItem, toggleItem, saveItem, deleteItem, reorderItems, finishShop,
      jobsFor, addJob, toggleJob, toggleRemind, saveJob, deleteJob, setDoneOpen,
      dismissBanner,
      ledgerGateOpen, categories, locationOptions, setListCategory,
      saveShopCompletion, failedCompletions, retryLedger,
    }),
    [
      lists, jobs, device, visibleLists,
      addList, deleteList, toggleDefault, setListOpen,
      addItem, toggleItem, saveItem, deleteItem, reorderItems, finishShop,
      jobsFor, addJob, toggleJob, toggleRemind, saveJob, deleteJob, setDoneOpen,
      dismissBanner,
      ledgerGateOpen, categories, locationOptions, setListCategory,
      saveShopCompletion, failedCompletions, retryLedger,
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
