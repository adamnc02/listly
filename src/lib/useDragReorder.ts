import { useCallback, useRef, useState } from 'react'

/**
 * Long-press-then-drag reordering, for touch AND mouse, showing a landing
 * cursor.
 *
 * ── The visual, and where it comes from ────────────────────────────────
 * The dragged row stays where it is and fades; a 3px line shows where it
 * would land if released now. That is My Dream Clean's diary reorder
 * (`.diary-drop-indicator`), which BLOC's plan page already ported
 * (`.plan-drop-indicator`, whose own comment cites MDC). Adam asked Listly
 * to match, so the same idiom is used here and the CSS mirrors theirs: 3px
 * tall, 2px radius, accent colour, with a 2px surface-coloured ring so the
 * line separates cleanly from whatever it sits between.
 *
 * ── What is deliberately NOT copied ────────────────────────────────────
 * Both of those apps drive the drag with **HTML5 drag-and-drop**
 * (`draggable="true"` + `ondragstart`/`ondragover`) and no touch shim.
 * Those events do not fire from touch on iPhone Safari, so that mechanism
 * cannot work on the device Listly is built for (APP-KNOWLEDGE: iOS only).
 * Pointer Events are used instead — one implementation covering touch, pen
 * and mouse — with `setPointerCapture` so the gesture survives the finger
 * sliding outside the row it started on.
 *
 * ── The gesture ────────────────────────────────────────────────────────
 *   - press and hold the grip for LONG_PRESS_MS -> the row fades and the
 *     cursor appears;
 *   - moving before then cancels, so the list still scrolls normally under
 *     a finger that happens to start on the grip;
 *   - releasing commits; a cancelled pointer aborts with no change.
 */

const LONG_PRESS_MS = 350
/** Movement beyond this before the long-press fires means "I am scrolling". */
const CANCEL_SLOP_PX = 8

export interface DragReorder {
  /** The row being dragged, or null. It renders faded and stays in place. */
  draggingIndex: number | null
  /**
   * Where the cursor is drawn: the index the row would land BEFORE, from 0
   * to `count` inclusive (`count` meaning "after the last row"). Null when
   * no drag is in progress. Same semantics as MDC's `diaryDragBeforeIndex`.
   */
  dropIndex: number | null
  containerRef: (el: HTMLDivElement | null) => void
  handleProps: (index: number) => {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void
  }
}

/**
 * Turns a "insert before this position" index — which refers to the array
 * BEFORE the dragged row is removed — into the target index for an array
 * move that removes first and then inserts (standard splice semantics, and
 * what `reorderItems` does). Lifted from MDC's `diaryDragToIdx`, including
 * its reasoning.
 */
function toIndexFromBefore(beforeIdx: number, fromIdx: number, count: number): number {
  if (beforeIdx >= count) return count - 1 // dropped below everything — lands at the end
  if (beforeIdx <= fromIdx) return beforeIdx // earlier than the removal, so unaffected
  return beforeIdx - 1 // shifts down by one once the earlier dragged row is removed
}

export function useDragReorder(count: number, onReorder: (from: number, to: number) => void): DragReorder {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const container = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number | null>(null)
  const startY = useRef(0)
  const active = useRef(false)
  const fromIndex = useRef(0)
  const dropBefore = useRef(0)
  /**
   * Row midpoints, measured ONCE when the drag starts.
   *
   * Measuring live would feed back on itself: the cursor is a real element
   * in the flow, so drawing it moves every row below it by its own height,
   * which changes the measurement that decided where to draw it. Nothing
   * else moves during a drag in this idiom — the dragged row stays put —
   * so one measurement stays valid for the whole gesture.
   */
  const midpoints = useRef<number[]>([])

  const setContainer = useCallback((el: HTMLDivElement | null) => {
    container.current = el
  }, [])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const reset = useCallback(() => {
    clearTimer()
    active.current = false
    document.body.classList.remove('rows-dragging')
    setDraggingIndex(null)
    setDropIndex(null)
  }, [clearTimer])

  const measure = useCallback(() => {
    const el = container.current
    if (!el) {
      midpoints.current = []
      return
    }
    midpoints.current = Array.from(el.querySelectorAll<HTMLElement>('[data-drag-row]')).map((row) => {
      const r = row.getBoundingClientRect()
      return r.top + r.height / 2
    })
  }, [])

  /** The index the row would land before, from the pointer's Y. */
  const beforeIndexFor = useCallback((clientY: number): number => {
    const mids = midpoints.current
    for (let i = 0; i < mids.length; i++) {
      if (clientY < mids[i]) return i
    }
    return mids.length
  }, [])

  const onPointerDown = useCallback(
    (index: number) => (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return // a right-click is not a drag

      startY.current = e.clientY
      fromIndex.current = index
      dropBefore.current = index

      const target = e.currentTarget as HTMLElement
      const pointerId = e.pointerId

      timer.current = window.setTimeout(() => {
        active.current = true
        measure()
        // Capture AFTER the press qualifies, so an ordinary scroll never
        // has the pointer taken away from it.
        try {
          target.setPointerCapture(pointerId)
        } catch {
          // Safari can refuse if the pointer was already released.
        }
        document.body.classList.add('rows-dragging')
        if ('vibrate' in navigator) navigator.vibrate?.(10)
        setDraggingIndex(index)
        setDropIndex(index)
      }, LONG_PRESS_MS)
    },
    [measure],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!active.current) {
        // Still deciding. A real scroll cancels the pending long press.
        if (Math.abs(e.clientY - startY.current) > CANCEL_SLOP_PX) clearTimer()
        return
      }
      e.preventDefault()
      const before = beforeIndexFor(e.clientY)
      dropBefore.current = before
      setDropIndex(before)
    },
    [beforeIndexFor, clearTimer],
  )

  const onPointerUp = useCallback(() => {
    if (active.current) {
      const from = fromIndex.current
      const to = toIndexFromBefore(dropBefore.current, from, count)
      if (to !== from && to >= 0) onReorder(from, to)
    }
    reset()
  }, [count, onReorder, reset])

  return {
    draggingIndex,
    dropIndex,
    containerRef: setContainer,
    handleProps: (index: number) => ({
      onPointerDown: onPointerDown(index),
      onPointerMove,
      onPointerUp,
      onPointerCancel: reset,
    }),
  }
}
