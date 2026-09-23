import { powerSyncDb } from './database'
import { appendPosition, midpoint, positionOf, toDbId, type Row } from './mapping'
import { newId } from '../ids'
import { todayIso } from '../date'
import type { IsoDate, JobPage, ShopCompletionDraft } from '../../types'

/**
 * One function per mutation, so the context stays thin.
 *
 * 🚨 EVERY UPDATE IS NARROW — it sets only the fields that genuinely changed.
 * PowerSync resolves conflicts per column, which is what lets two phones edit
 * the same list at once without one clobbering the other. A convenient
 * "write the whole row" helper would quietly destroy that everywhere at once,
 * so there isn't one.
 *
 * `user_id` is never sent: it defaults to auth.uid() server-side, and sending
 * it would write null over that default.
 */

const JOB_TABLE: Record<JobPage, string> = { house: 'lst_house_jobs', mine: 'lst_my_jobs' }

async function siblings(sql: string, params: unknown[]): Promise<Array<number | null>> {
  const rows = await powerSyncDb.getAll<Row>(sql, params)
  return rows.map((r) => positionOf(r))
}

// ── shopping lists ──────────────────────────────────────────────────────────

export async function insertList(householdId: string, name: string, isDefault: boolean): Promise<string> {
  const id = newId()
  const pos = appendPosition(
    await siblings('SELECT position FROM lst_shopping_lists WHERE household_id = ?', [householdId]),
  )
  await powerSyncDb.execute(
    `INSERT INTO lst_shopping_lists
       (id, household_id, name, is_default, never_had_items, category_id, created_at, position)
     VALUES (?, ?, ?, ?, 1, NULL, ?, ?)`,
    [id, householdId, name, isDefault ? 1 : 0, todayIso(), pos],
  )
  return id
}

export async function renameList(id: string, name: string): Promise<void> {
  await powerSyncDb.execute('UPDATE lst_shopping_lists SET name = ? WHERE id = ?', [name, id])
}

export async function setListDefault(id: string, isDefault: boolean): Promise<void> {
  await powerSyncDb.execute('UPDATE lst_shopping_lists SET is_default = ? WHERE id = ?', [isDefault ? 1 : 0, id])
}

export async function setListCategory(id: string, categoryId: string): Promise<void> {
  // 🚨 Stored EXACTLY as read from lst_ref_categories, '@<household_id>'
  // suffix intact. Never strip it, never add one (§31).
  await powerSyncDb.execute('UPDATE lst_shopping_lists SET category_id = ? WHERE id = ?', [toDbId(categoryId), id])
}

export async function deleteList(id: string): Promise<void> {
  // Items are deleted explicitly, child-first, rather than relying on the
  // server's ON DELETE CASCADE: within one upload, deletes must go
  // child-first or an FK-bound write is discarded (§27).
  await powerSyncDb.execute('DELETE FROM lst_shopping_items WHERE list_id = ?', [id])
  await powerSyncDb.execute('DELETE FROM lst_shopping_lists WHERE id = ?', [id])
}

// ── shopping items ──────────────────────────────────────────────────────────

export async function insertItem(householdId: string, listId: string, text: string): Promise<string> {
  const id = newId()
  const pos = appendPosition(
    await siblings('SELECT position FROM lst_shopping_items WHERE list_id = ?', [listId]),
  )
  await powerSyncDb.execute(
    'INSERT INTO lst_shopping_items (id, household_id, list_id, text, done, position) VALUES (?, ?, ?, ?, 0, ?)',
    [id, householdId, listId, text, pos],
  )
  // The list has now held an item, so the "just created, keep it visible
  // while empty" rule stops applying to it for good.
  await powerSyncDb.execute(
    'UPDATE lst_shopping_lists SET never_had_items = 0 WHERE id = ? AND never_had_items = 1',
    [listId],
  )
  return id
}

export async function setItemDone(id: string, done: boolean): Promise<void> {
  await powerSyncDb.execute('UPDATE lst_shopping_items SET done = ? WHERE id = ?', [done ? 1 : 0, id])
}

export async function renameItem(id: string, text: string): Promise<void> {
  await powerSyncDb.execute('UPDATE lst_shopping_items SET text = ? WHERE id = ?', [text, id])
}

export async function deleteItem(id: string): Promise<void> {
  await powerSyncDb.execute('DELETE FROM lst_shopping_items WHERE id = ?', [id])
}

/**
 * 🚨 Moving an item between lists is an UPDATE of list_id + position — never
 * a delete plus an insert. The row identity has to stay stable or two devices
 * will not converge on one row.
 */
export async function moveItem(itemId: string, toListId: string): Promise<void> {
  const pos = appendPosition(
    await siblings('SELECT position FROM lst_shopping_items WHERE list_id = ?', [toListId]),
  )
  await powerSyncDb.execute('UPDATE lst_shopping_items SET list_id = ?, position = ? WHERE id = ?', [
    toListId,
    pos,
    itemId,
  ])
  await powerSyncDb.execute(
    'UPDATE lst_shopping_lists SET never_had_items = 0 WHERE id = ? AND never_had_items = 1',
    [toListId],
  )
}

/** Drag-to-reorder: one row's position changes, and only that row is written. */
export async function repositionItem(listId: string, itemId: string, toIndex: number): Promise<void> {
  const rows = await powerSyncDb.getAll<Row>(
    'SELECT id, position FROM lst_shopping_items WHERE list_id = ? ORDER BY position, id',
    [listId],
  )
  const without = rows.filter((r) => r.id !== itemId)
  const pos = midpoint(positionOf(without[toIndex - 1]), positionOf(without[toIndex]))
  await powerSyncDb.execute('UPDATE lst_shopping_items SET position = ? WHERE id = ?', [pos, itemId])
}

/** The ticked item names, in list order, before Finish shop deletes them. */
export async function tickedItemNames(listId: string): Promise<string[]> {
  const rows = await powerSyncDb.getAll<Row>(
    'SELECT text FROM lst_shopping_items WHERE list_id = ? AND done = 1 ORDER BY position, id',
    [listId],
  )
  return rows.map((r) => String(r.text ?? '')).filter(Boolean)
}

/** Finish shop: ticked items go, unticked stay. One statement, no read. */
export async function clearDoneItems(listId: string): Promise<void> {
  await powerSyncDb.execute('DELETE FROM lst_shopping_items WHERE list_id = ? AND done = 1', [listId])
}

// ── the ledger bridge ───────────────────────────────────────────────────────

/**
 * A priced shop. Writing this row is the ENTIRETY of Listly's write path into
 * `shared_finance_ledger`: a `BEFORE INSERT OR UPDATE OF amount` trigger on
 * the server turns it into a real `transactions` row
 * (`20260920160000_listly_ledger_bridge`).
 *
 * It is a local INSERT, so it works offline and syncs when there is signal.
 * Nothing here talks to the ledger directly, and nothing here can produce a
 * malformed ledger row — the trigger decides every ledger field.
 *
 * 🚨 `transaction_id` and `ledger_error` are deliberately NOT written. They
 * are the trigger's to set, and sending them would write nulls over its
 * answer on the way up.
 *
 * 🚨 `user_id` is never sent: it defaults to auth.uid() server-side.
 */
export async function insertShopCompletion(
  householdId: string,
  draft: ShopCompletionDraft,
): Promise<string> {
  const id = newId()
  await powerSyncDb.execute(
    `INSERT INTO lst_shop_completions
       (id, household_id, list_id, list_name, completed_at, amount, spend_date,
        category_id, payment_method, location, owner_id, pot_id, items_snapshot,
        rounded_from, rounding_pot_id, round_up_skipped)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'card', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      householdId,
      toDbId(draft.listId),
      draft.listName,
      new Date().toISOString(),
      draft.amount,
      toDbId(draft.spendDate),
      toDbId(draft.categoryId),
      draft.location.location,
      // A joint shop stores NO owner. Verified 2026-09-20: the ledger never
      // reads ownerId on a joint-located expense (§8.2c).
      toDbId(draft.location.location === 'joint' ? '' : draft.location.ownerId),
      toDbId(draft.location.location === 'pot' ? draft.location.potId : ''),
      // Kept in Listly only. Adam, 2026-09-20: "only amount needs to be
      // recorded to shared-ledger-finance, but would be handy to have that
      // information in listly's tables". The trigger never reads it.
      toDbId(draft.itemsSnapshot),
      // PROMPT-05. 🚨 The PAIR, decided and DISPLAYED in the sheet before
      // Save — never recomputed server-side. Null on every shop that did
      // not round, which is most of them. `draft.amount` is already the
      // rounded figure when these are set.
      draft.roundedFrom,
      toDbId(draft.roundingPotId ?? ''),
      // 1/0, not true/false: SQLite holds booleans as integers, and
      // toServerRecord turns this back into a real boolean on the way up.
      draft.roundUpSkipped ? 1 : 0,
    ],
  )
  return id
}

/**
 * "Couldn't add to the ledger — tap to retry."
 *
 * 🚨 Re-writing `amount` is the retry. The trigger fires on
 * `UPDATE OF amount`, and PowerSync sends a PATCH of the changed columns, so
 * `set amount = amount` puts `amount` in the statement's SET list and the
 * trigger runs again — whether or not the value differs.
 *
 * `ledger_error` is cleared locally at the same time so the banner goes as
 * soon as it is tapped. The server's own answer overwrites it either way
 * moments later: on success `ledger_error` comes back null, and on a repeat
 * failure it comes back with the new message.
 */
export async function retryLedgerWrite(id: string): Promise<void> {
  await powerSyncDb.execute(
    'UPDATE lst_shop_completions SET amount = amount, ledger_error = NULL WHERE id = ?',
    [id],
  )
}

// ── jobs ────────────────────────────────────────────────────────────────────

export async function insertJob(
  page: JobPage,
  householdId: string,
  text: string,
  due: IsoDate,
): Promise<string> {
  const id = newId()
  const table = JOB_TABLE[page]
  const pos = appendPosition(
    page === 'house'
      ? await siblings(`SELECT position FROM ${table} WHERE household_id = ?`, [householdId])
      : await siblings(`SELECT position FROM ${table}`, []),
  )
  if (page === 'house') {
    await powerSyncDb.execute(
      `INSERT INTO ${table} (id, household_id, text, due_date, remind, done, done_at, position)
       VALUES (?, ?, ?, ?, 0, 0, NULL, ?)`,
      [id, householdId, text, toDbId(due), pos],
    )
  } else {
    // my_jobs has no household_id: it is keyed on the login, and user_id is
    // set by the database's own default.
    await powerSyncDb.execute(
      `INSERT INTO ${table} (id, text, due_date, remind, done, done_at, position)
       VALUES (?, ?, ?, 0, 0, NULL, ?)`,
      [id, text, toDbId(due), pos],
    )
  }
  return id
}

export async function setJobDone(page: JobPage, id: string, done: boolean): Promise<void> {
  await powerSyncDb.execute(
    `UPDATE ${JOB_TABLE[page]} SET done = ?, done_at = ? WHERE id = ?`,
    [done ? 1 : 0, done ? new Date().toISOString() : null, id],
  )
}

export async function setJobRemind(page: JobPage, id: string, remind: boolean): Promise<void> {
  // The CHECK constraint refuses remind = true with no due date, and a 23514
  // is discarded silently (§27) — so this never sets it without one. The UI
  // hides the control too; belt and braces.
  await powerSyncDb.execute(
    `UPDATE ${JOB_TABLE[page]} SET remind = ? WHERE id = ? AND (due_date IS NOT NULL OR ? = 0)`,
    [remind ? 1 : 0, id, remind ? 1 : 0],
  )
}

export async function saveJob(
  page: JobPage,
  id: string,
  text: string,
  due: IsoDate,
  remind: boolean,
): Promise<void> {
  // Clearing the due date must clear `remind` in the SAME statement, or the
  // row momentarily violates the CHECK and the write is discarded.
  await powerSyncDb.execute(
    `UPDATE ${JOB_TABLE[page]} SET text = ?, due_date = ?, remind = ? WHERE id = ?`,
    [text, toDbId(due), due !== '' && remind ? 1 : 0, id],
  )
}

export async function deleteJob(page: JobPage, id: string): Promise<void> {
  await powerSyncDb.execute(`DELETE FROM ${JOB_TABLE[page]} WHERE id = ?`, [id])
}
