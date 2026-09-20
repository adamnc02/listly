import { useCallback, useRef, useState } from 'react'

/**
 * Long-press-then-drag reordering, for touch AND mouse.
 *
 * LISTLY-DESIGN.md §2 flags this as a real-build gap: "The prototype uses
 * desktop mouse drag; the real build needs touch drag (e.g. long-press,
 * then drag)". HTML5 drag-and-drop, which the prototype uses, does not fire
 * on iOS Safari at all — so on the phone this app is actually for, the
 * prototype cannot reorder anything.
 *
 * Pointer Events are used instead: one implementation covers touch, pen and
 * mouse, and `setPointerCapture` keeps the gesture alive even when the
 * finger slides outside the row it started on.
 *
 * How it behaves:
 *   - press and hold the grip for LONG_PRESS_MS -> the row lifts;
 *   - moving before then cancels, so the list still scrolls normally under
 *     a finger that happens to start on the grip;
 *   - once lifted, the row follows the finger and its neighbours slide to
 *     show where it will land;
 *   - releasing commits the move; Escape or a cancelled pointer aborts it.
 *
 * Rows are assumed to be uniform height within one list, which they are
 * (`.row { min-height: 48px }` and one line of text). The height is
 * measured from the live DOM rather than hard-coded, so a wrapped item
 * still lands where it looks like it will.
 */

const LONG_PRESS_MS = 350
/** Movement beyond this before the long-press fires means "I am scrolling". */
const CANCEL_SLOP_PX = 8

export interface DragState {
  /** Index of the row being dragged, or null when nothing is being dragged. */
  index: number | null
  /** Where it would land if released now. */
  targetIndex: number
  /** Pixels the lifted row is offset from its home position. */
  offsetY: number
}

const IDLE: DragState = { index: null, targetIndex: 0, offsetY: 0 }

export function useDragReorder(count: number, onReorder: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<DragState>(IDLE)

  const timer = useRef<number | null>(null)
  const startY = useRef(0)
  const rowHeight = useRef(48)
  const active = useRef(false)
  const fromIndex = useRef(0)
  const targetIndex = useRef(0)

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
    setDrag(IDLE)
  }, [clearTimer])

  const onPointerDown = useCallback(
    (index: number) => (e: React.PointerEvent<HTMLElement>) => {
      // Ignore secondary mouse buttons; a right-click is not a drag.
      if (e.button !== 0) return

      const row = (e.currentTarget as HTMLElement).closest('.row') as HTMLElement | null
      if (row) rowHeight.current = row.getBoundingClientRect().height || 48

      startY.current = e.clientY
      fromIndex.current = index
      targetIndex.current = index

      const target = e.currentTarget as HTMLElement
      const pointerId = e.pointerId

      timer.current = window.setTimeout(() => {
        active.current = true
        // Capture AFTER the press qualifies, so a plain scroll never has the
        // pointer taken away from it.
        try {
          target.setPointerCapture(pointerId)
        } catch {
          // Safari can refuse if the pointer has already been released.
        }
        document.body.classList.add('rows-dragging')
        if ('vibrate' in navigator) navigator.vibrate?.(10)
        setDrag({ index, targetIndex: index, offsetY: 0 })
      }, LONG_PRESS_MS)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const dy = e.clientY - startY.current

      if (!active.current) {
        // Still deciding. A real scroll cancels the pending long press.
        if (Math.abs(dy) > CANCEL_SLOP_PX) clearTimer()
        return
      }

      e.preventDefault()
      const shift = Math.round(dy / rowHeight.current)
      const next = Math.min(count - 1, Math.max(0, fromIndex.current + shift))
      targetIndex.current = next
      setDrag({ index: fromIndex.current, targetIndex: next, offsetY: dy })
    },
    [clearTimer, count],
  )

  const onPointerUp = useCallback(() => {
    if (active.current && targetIndex.current !== fromIndex.current) {
      onReorder(fromIndex.current, targetIndex.current)
    }
    reset()
  }, [onReorder, reset])

  const onPointerCancel = useCallback(() => reset(), [reset])

  /**
   * How far a row that is NOT being dragged should slide, to open a gap at
   * the target position.
   */
  const shiftFor = useCallback(
    (index: number): number => {
      if (drag.index === null || index === drag.index) return 0
      const { index: from, targetIndex: to } = drag
      if (from < to && index > from && index <= to) return -rowHeight.current
      if (from > to && index >= to && index < from) return rowHeight.current
      return 0
    },
    [drag],
  )

  return {
    drag,
    shiftFor,
    /** Spread onto the grip handle of each row. */
    handleProps: (index: number) => ({
      onPointerDown: onPointerDown(index),
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    }),
  }
}
