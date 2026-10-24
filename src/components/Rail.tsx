import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { JobPage } from '../types'
import type { Tab } from '../lib/openIntent'
import { useListly } from '../context/ListlyContext'
import { categoryKey } from '../lib/deviceState'
import type { RailEntry, RailPage } from '../lib/useRailPages'
import { useDragReorder } from '../lib/useDragReorder'
import { Basket, CheckSquare, Chevron, Grip, House, Plus, Sidebar, StarFilled } from './Icons'
import icon from '/apple-touch-icon.png'

const ICON: Record<Tab, ReactNode> = { shopping: <Basket />, house: <House />, mine: <CheckSquare /> }

/**
 * The laptop view's side rail (TECHNICAL.md §24), replacing the bottom pill
 * at 768px and wider. Expanded: the logo, each page with its lists opened out
 * beneath it, and the collapse button at the foot. Collapsed: the logo and
 * the page icons only; an icon opens a small menu of that page's lists.
 *
 * 🚨 It is an <aside> holding role="navigation", NEVER a <nav>. index.css
 * styles `nav` globally as the phone's floating pill and hides every `nav`
 * while the iOS keyboard is up, and index.html moves `.app > nav` by script.
 * A <nav> here would inherit all three.
 */
export function Rail({
  pages, tab, collapsed, railOpen, onTab, onPick, onToggleOpen, onToggleRail,
}: {
  pages: RailPage[]
  tab: Tab
  collapsed: boolean
  railOpen: Partial<Record<Tab, boolean>>
  onTab: (tab: Tab) => void
  onPick: (tab: Tab, id: string) => void
  onToggleOpen: (tab: Tab) => void
  onToggleRail: () => void
}) {
  // The collapsed rail's menu: which page, and how far down to draw it.
  const [fly, setFly] = useState<{ tab: Tab; top: number } | null>(null)
  const railRef = useRef<HTMLElement>(null)

  // A click anywhere outside the rail, or Escape, closes the menu.
  useEffect(() => {
    if (!fly) return
    const onDown = (e: MouseEvent) => {
      if (!railRef.current?.contains(e.target as Node)) setFly(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFly(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [fly])

  const flyPage = collapsed && fly ? pages.find((p) => p.tab === fly.tab) : undefined

  return (
    <aside className={`rail${collapsed ? ' min' : ''}`} ref={railRef}>
      <div className="rail-head">
        <img src={icon} alt="Listly" />
        {!collapsed && <div className="brand">Listly</div>}
      </div>

      <div className="rail-pages" role="navigation" aria-label="Pages">
        {pages.map((p) => {
          const open = railOpen[p.tab] ?? p.tab === tab
          return (
            <div key={p.tab} className="rail-group">
              <div className={`rail-page${p.tab === tab ? ' on' : ''}`}>
                <button
                  className="rail-go"
                  aria-current={p.tab === tab ? 'page' : undefined}
                  aria-label={collapsed ? `${p.title}, show its lists` : undefined}
                  title={collapsed ? p.title : undefined}
                  onClick={(e) => {
                    if (collapsed) {
                      const top = (e.currentTarget as HTMLElement).offsetTop
                      setFly(fly?.tab === p.tab ? null : { tab: p.tab, top })
                      return
                    }
                    onTab(p.tab)
                    if (!open) onToggleOpen(p.tab)
                  }}
                >
                  {ICON[p.tab]}
                  {!collapsed && <span className="grow">{p.title}</span>}
                  {collapsed && p.due > 0 && (
                    <span className="due-n" aria-label={`${p.due} due soon`}>{p.due}</span>
                  )}
                </button>
                {!collapsed && (
                  <button
                    className="rail-chev"
                    onClick={() => onToggleOpen(p.tab)}
                    aria-expanded={open}
                    aria-label={`${open ? 'Hide' : 'Show'} ${p.title} lists`}
                  >
                    <Chevron size={20} />
                  </button>
                )}
              </div>
              {!collapsed && open && <Entries page={p} current={p.tab === tab} onPick={onPick} draggable />}
            </div>
          )
        })}
      </div>

      <button
        className="rail-toggle"
        onClick={() => {
          setFly(null)
          onToggleRail()
        }}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand the side bar' : 'Collapse the side bar'}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <Sidebar />
      </button>

      {flyPage && fly && (
        <div className="rail-fly" style={{ top: fly.top }} role="dialog" aria-label={`${flyPage.title} lists`}>
          <h2>{flyPage.title}</h2>
          <Entries
            page={flyPage}
            current={flyPage.tab === tab}
            onPick={(t, id) => {
              setFly(null)
              onPick(t, id)
            }}
          />
        </div>
      )}
    </aside>
  )
}

/** A page's rows, the "+ New" row under them, and (in the rail) drag to reorder. */
function Entries({
  page, current, onPick, draggable = false,
}: {
  page: RailPage
  current: boolean
  onPick: (tab: Tab, id: string) => void
  draggable?: boolean
}) {
  const { reorderLists, reorderJobCategories } = useListly()
  const movable = page.entries.filter((e) => e.reorderable)
  const fixed = page.entries.filter((e) => !e.reorderable)
  // The same writes the phone's card grips make: lists among the VISIBLE
  // lists, categories among the shown categories with Other left out (§17).
  const { draggingIndex, dropIndex, containerRef, handleProps } = useDragReorder(
    movable.length,
    (from, to) =>
      page.tab === 'shopping'
        ? reorderLists(from, to)
        : reorderJobCategories(page.tab, movable.map((e) => e.id), from, to),
  )

  const row = (e: RailEntry, grip?: ReturnType<typeof handleProps>, dragging = false) => (
    <div className={`rail-row${dragging ? ' dragging' : ''}`} data-drag-row={grip ? '' : undefined}>
      {draggable &&
        (grip ? (
          <span className="grip" title="Hold, then drag to reorder" role="button" tabIndex={-1} aria-label={`Reorder ${e.name}`} {...grip}>
            <Grip />
          </span>
        ) : (
          <span className="grip-space" />
        ))}
      <button
        className={`rail-entry${current && page.focus === e.id ? ' on' : ''}`}
        aria-current={current && page.focus === e.id ? 'true' : undefined}
        onClick={() => onPick(page.tab, e.id)}
      >
        <span className="grow nm">{e.name}</span>
        {e.isDefault && (
          <span className="defmark" title="Default list">
            <StarFilled size={15} />
          </span>
        )}
        {e.due > 0 && <span className="due-n" aria-label={`${e.due} due soon`}>{e.due}</span>}
        <span className="pill">{e.count}</span>
      </button>
    </div>
  )

  return (
    <div className="rail-entries">
      {page.entries.length === 0 && (
        <p className="rail-empty">{page.tab === 'shopping' ? 'No lists yet.' : 'No categories yet.'}</p>
      )}
      <div ref={containerRef}>
        {movable.map((e, i) => (
          <div key={e.id}>
            {dropIndex === i && <div className="drop-cursor" role="presentation" />}
            {row(e, draggable ? handleProps(i) : undefined, draggingIndex === i)}
          </div>
        ))}
        {dropIndex === movable.length && <div className="drop-cursor" role="presentation" />}
      </div>
      {fixed.map((e) => (
        <div key={e.id}>{row(e)}</div>
      ))}
      <RailAdd page={page} onPick={onPick} />
    </div>
  )
}

/**
 * "+ New list" / "+ New category": the phone page's dashed box, moved into
 * the rail because the laptop page shows one list and has nowhere else for
 * it. The same rules as every add (§19): an empty field is stated, a failed
 * write is named. A new one is picked at once, so it opens ready to fill.
 */
function RailAdd({ page, onPick }: { page: RailPage; onPick: (tab: Tab, id: string) => void }) {
  const { addList, addJobCategory } = useListly()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  // A new list's id is not returned by addList, so it is recognised as the
  // first visible list that was not there when Add was pressed.
  const awaiting = useRef<Set<string> | null>(null)
  const label = page.tab === 'shopping' ? 'New list' : 'New category'

  useEffect(() => {
    const before = awaiting.current
    if (!before) return
    const fresh = page.entries.find((e) => !before.has(e.id))
    if (fresh) {
      awaiting.current = null
      onPick(page.tab, fresh.id)
    }
  }, [page.entries, page.tab, onPick])

  const submit = () => {
    const name = draft.trim()
    if (!name) {
      setHint(`Type a ${page.tab === 'shopping' ? 'list' : 'category'} name first.`)
      return
    }
    setHint(null)
    let write: Promise<void>
    if (page.tab === 'shopping') {
      awaiting.current = new Set(page.entries.map((e) => e.id))
      write = addList(name, false)
    } else {
      const jobPage: JobPage = page.tab
      write = addJobCategory(jobPage, name).then((id) => onPick(jobPage, categoryKey(jobPage, id)))
    }
    void write
      .then(() => {
        setDraft('')
        setEditing(false)
      })
      .catch((e: unknown) => {
        awaiting.current = null
        setHint(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`)
      })
  }

  if (!editing) {
    return (
      <button className="rail-entry rail-add" onClick={() => setEditing(true)}>
        <Plus />
        {label}
      </button>
    )
  }
  return (
    <div className="rail-new">
      <input
        className="line-input"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') {
            setEditing(false)
            setDraft('')
            setHint(null)
          }
        }}
        placeholder={page.tab === 'shopping' ? 'e.g. Tesco' : 'e.g. Garden'}
        aria-label={`${label} name`}
      />
      <button className={`icon-btn round-add${draft.trim() ? '' : ' waiting'}`} onClick={submit} aria-label={`Add ${label.toLowerCase()}`}>
        <Plus />
      </button>
      {hint && !draft.trim() && (
        <p className="help rail-hint" role="alert">
          {hint}
        </p>
      )}
    </div>
  )
}
