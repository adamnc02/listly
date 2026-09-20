import { useState } from 'react'
import type { List } from '../types'
import { useListly } from '../context/ListlyContext'
import { useDragReorder } from '../lib/useDragReorder'
import { Chevron, Grip, Plus, StarFilled, Tick, TickSmall } from './Icons'

/**
 * One shopping list card: header, items, add field, Finish shop.
 *
 * The count pill, the hint line above Finish shop and the empty note are
 * all worded exactly as the prototype words them — they are the design, not
 * placeholder copy.
 */
export function ShoppingList({ list, onEditItem }: { list: List; onEditItem: (itemId: string) => void }) {
  const { device, setListOpen, addItem, toggleItem, reorderItems, finishShop } = useListly()
  const [draft, setDraft] = useState('')

  const open = device.openLists[list.id] ?? false
  const left = list.items.filter((i) => !i.done).length
  const got = list.items.length - left
  const count = list.items.length === 0 ? 'empty' : left ? `${left} to get` : 'all got'

  const { drag, shiftFor, handleProps } = useDragReorder(list.items.length, (from, to) =>
    reorderItems(list.id, from, to),
  )

  const submit = () => {
    addItem(list.id, draft)
    setDraft('')
  }

  let hint = ''
  if (list.items.length) {
    if (left) {
      hint = got
        ? `${left} unticked will stay for next time.`
        : `Nothing ticked yet — all ${left} stay for next time.`
    } else {
      hint = list.isDefault
        ? 'Everything’s ticked — list will be emptied (it’s a default, so it stays).'
        : 'Everything’s ticked — list will be emptied and hidden.'
    }
  }

  return (
    <section className={`card${open ? ' open' : ''}`}>
      <button className="listhead" onClick={() => setListOpen(list.id, !open)} aria-expanded={open}>
        <span style={{ color: 'var(--brown)' }}>
          <Chevron />
        </span>
        <span className="name">{list.name}</span>
        {list.isDefault && (
          <span className="defmark" title="Default list">
            <StarFilled />
            <span className="sr">Default list</span>
          </span>
        )}
        <span className="grow" />
        <span className="pill">{count}</span>
      </button>

      {open && (
        <div className="listbody">
          {list.items.length === 0 && <div className="empty-note">Nothing on this list yet.</div>}

          {list.items.map((item, index) => {
            const dragging = drag.index === index
            const shift = shiftFor(index)
            return (
              <div
                key={item.id}
                className={`row${dragging ? ' dragging' : ''}${!dragging && shift !== 0 ? ' shifted' : ''}`}
                style={{
                  transform: dragging
                    ? `translateY(${drag.offsetY}px)`
                    : shift !== 0
                      ? `translateY(${shift}px)`
                      : undefined,
                }}
              >
                <span
                  className="grip"
                  title="Hold, then drag to reorder"
                  role="button"
                  tabIndex={-1}
                  aria-label={`Reorder ${item.text}`}
                  {...handleProps(index)}
                >
                  <Grip />
                </span>
                <button
                  className="tick"
                  onClick={() => toggleItem(list.id, item.id)}
                  aria-pressed={item.done}
                  aria-label={`Tick off ${item.text}`}
                >
                  <span className={`box${item.done ? ' on' : ''}`}>{item.done && <Tick />}</span>
                </button>
                <button
                  className={`itemtext${item.done ? ' done' : ''}`}
                  onClick={() => onEditItem(item.id)}
                >
                  {item.text}
                </button>
              </div>
            )
          })}

          <div className="addrow">
            <input
              className="line-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="Add an item…"
              aria-label={`Add an item to ${list.name}`}
              // The phone keyboard keeps its "return" key useful for adding
              // several items in a row, which is how a list actually gets
              // written.
              enterKeyHint="done"
            />
            <button className="icon-btn round-add" onClick={submit} aria-label="Add item">
              <Plus />
            </button>
          </div>

          {list.items.length > 0 && (
            <div className="finish">
              <div className="hint">{hint}</div>
              <button className="btn outline" onClick={() => finishShop(list.id)}>
                <TickSmall />
                Finish shop
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
