/**
 * Dragging a row among the VISIBLE rows, written against the FULL order.
 *
 * The Shopping page shows only the visible lists — an empty non-default list
 * hides itself (TECHNICAL.md §8) — but every list keeps its `position`, so a
 * hidden one reappears where it was. A drag therefore has to be translated:
 * the hook reports a move among the visible rows, and the write needs the
 * index among ALL rows.
 *
 * 🚨 Using the visible index directly against the full order is the plausible
 * wrong answer. With a hidden list between two visible ones it lands the
 * dragged list on the wrong side of the hidden one, or beside a list it was
 * never dropped next to. `scripts/verify-list-reorder.ts` carries that version
 * as its control.
 *
 * Semantics match `useDragReorder` and `repositionItem`: remove the moved row,
 * then insert at `to` (splice). The result is an index into the full order
 * WITH the moved row removed — exactly what `midpoint()` is given.
 */
export function fullIndexForVisibleMove(
  allIds: string[],
  visibleIds: string[],
  from: number,
  to: number,
): number {
  const moved = visibleIds[from]
  const allWithout = allIds.filter((id) => id !== moved)
  const visibleWithout = visibleIds.filter((id) => id !== moved)
  // Dropped before a visible row: land immediately before it, so any hidden
  // rows above that row stay above the moved one.
  if (to < visibleWithout.length) return allWithout.indexOf(visibleWithout[to])
  // Dropped at the end: immediately after the last visible row. Hidden rows
  // after it stay after it.
  const last = visibleWithout[visibleWithout.length - 1]
  return last === undefined ? allWithout.length : allWithout.indexOf(last) + 1
}
