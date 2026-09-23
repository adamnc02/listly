import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * A bottom sheet over a dimmed background: 26px top radius over
 * rgba(59,47,38,.4), per src/index.css's header.
 *
 * 🚨 It renders through createPortal to document.body, from the very first
 * one, and never as a plain fixed/absolute div inside the page.
 * MIGRATION-LESSONS §15 is the reason, and it took three attempts to find:
 * page components live inside a scrolling `overflow-y: auto` container, and
 * an overlay inside one is clipped by it. Bumping z-index does not help
 * (nothing is losing a stacking comparison), and switching `fixed` to
 * `absolute` makes it strictly worse. A portal removes the sheet from that
 * subtree entirely, so no ancestor's overflow or stacking context can reach
 * it.
 */
export function Sheet({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: ReactNode
}) {
  // Escape closes, and the page behind does not scroll while a sheet is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return createPortal(
    <div className="sheet-root">
      <div className="scrim">
        <button className="close-area" onClick={onClose} aria-label="Close" />
        <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
          <div className="handle" />
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
