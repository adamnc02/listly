import { useState } from 'react'
import type { List } from '../types'
import { useListly, type ShopSnapshot } from '../context/ListlyContext'
import { useDragReorder } from '../lib/useDragReorder'
import { Chevron, Grip, Plus, StarFilled, Tick, TickSmall } from './Icons'

/**
 * One shopping list card: header, items, add field, Finish shop.
 *
 * The count pill, the hint line above Finish shop and the empty note are
 * all worded exactly as the prototype words them — they are the design, not
 * placeholder copy.
 */
export function ShoppingList({
  list,
  onEditItem,
  onPriceShop,
}: {
  list: List
  onEditItem: (itemId: string) => void
  /** Called with the finished shop only when the D4 gate is open. */
  onPriceShop: (shop: ShopSnapshot) => void
}) {
  const { device, setListOpen, addItem, toggleItem, reorderItems, finishShop, ledgerGateOpen } =
    useListly()
  const [draft, setDraft] = useState('')
  const [addHint, setAddHint] = useState<string | null>(null)

  const open = device.openLists[list.id] ?? false
  const left = list.items.filter((i) => !i.done).length
  const got = list.items.length - left
  const count = list.items.length === 0 ? 'empty' : left ? `${left} to get` : 'all got'

  const { draggingIndex, dropIndex, containerRef, handleProps } = useDragReorder(
    list.items.length,
    (from, to) => reorderItems(list.id, from, to),
  )

  // Same rule as every other "add" in the app: an empty field is stated,
  // never silently ignored, and a failed write names itself.
  const submit = () => {
    const text = draft.trim()
    if (!text) {
      setAddHint('Type an item first.')
      return
    }
    setAddHint(null)
    void addItem(list.id, text)
      .then(() => setDraft(''))
      .catch((e: unknown) =>
        setAddHint(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`),
      )
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

          {/* The landing cursor is a real element in the flow, drawn before
              whichever row the dragged item would land above — and after the
              last row when it would go to the end. Same mechanism as My Dream
              Clean's diary and BLOC's plan page, which insert one shared
              indicator element; React just does it declaratively. */}
          <div ref={containerRef}>
            {list.items.map((item, index) => (
              <div key={item.id}>
                {dropIndex === index && <div className="drop-cursor" role="presentation" />}
                <div className={`row${draggingIndex === index ? ' dragging' : ''}`} data-drag-row>
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
              </div>
            ))}
            {dropIndex === list.items.length && <div className="drop-cursor" role="presentation" />}
          </div>

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
            <button
              className={`icon-btn round-add${draft.trim() ? '' : ' waiting'}`}
              onClick={submit}
              aria-label="Add item"
            >
              <Plus />
            </button>
          </div>

          {addHint && (
            <p className="help" style={{ color: 'var(--red)', padding: '0 8px' }} role="alert">
              {addHint}
            </p>
          )}

          {list.items.length > 0 && (
            <div className="finish">
              <div className="hint">{hint}</div>
              {/* 🚨 With no ledger this does exactly what it always did:
                  clear the ticked items and collapse. No price sheet, no
                  mention of the ledger, nothing to explain. */}
              <button
                className="btn outline"
                onClick={() => {
                  void finishShop(list.id).then((shop) => {
                    if (ledgerGateOpen) onPriceShop(shop)
                  })
                }}
              >
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
