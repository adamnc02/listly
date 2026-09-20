import { useState } from 'react'
import { useListly } from '../context/ListlyContext'
import { Sheet } from './Sheet'
import { Star, StarFilled, Trash } from './Icons'

/**
 * Manage lists (LISTLY-DESIGN.md §2). Shows EVERY list, hidden ones
 * included — that is the whole point of the sheet: a list that hides itself
 * when empty still exists, and this is where you find it.
 *
 * Phase 4 adds a category chip to each row here, gated on the household
 * having at least one `people` row (PROMPT-01 §8.2d / D4). Nothing about
 * that is stubbed in now: with no ledger the chip must not appear at all,
 * and the cleanest way to guarantee that today is for it not to exist.
 */
export function ManageListsSheet({ onClose }: { onClose: () => void }) {
  const { lists, toggleDefault, deleteList, addList } = useListly()
  const [draft, setDraft] = useState('')

  const submit = () => {
    addList(draft, true)
    setDraft('')
  }

  return (
    <Sheet label="Manage lists" onClose={onClose}>
      <h2>Manage lists</h2>
      <p className="help">
        Star a shop to make it a default list — it always shows, even when empty. Other lists hide
        themselves when empty.
      </p>

      <div>
        {lists.map((l) => {
          const status = l.items.length
            ? `${l.items.length} ${l.items.length === 1 ? 'item' : 'items'}`
            : l.isDefault
              ? 'empty · always shown'
              : 'empty · hidden'
          return (
            <div className="mrow" key={l.id}>
              <button
                className="icon-btn star"
                onClick={() => toggleDefault(l.id)}
                aria-pressed={l.isDefault}
                aria-label={`Default list: ${l.name}`}
              >
                {l.isDefault ? <StarFilled size={22} /> : <Star />}
              </button>
              <div className="grow">
                <div className="nm">{l.name}</div>
                <div className="st">{status}</div>
              </div>
              <button
                className="icon-btn del"
                onClick={() => {
                  // Deleting a list with items asks first — it takes the
                  // items with it and there is no undo.
                  if (
                    !l.items.length ||
                    window.confirm(`Delete "${l.name}" and its ${l.items.length} item(s)?`)
                  ) {
                    deleteList(l.id)
                  }
                }}
                aria-label={`Delete ${l.name} list`}
              >
                <Trash />
              </button>
            </div>
          )
        })}
      </div>

      <div className="newlist">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Add a default list"
          aria-label="Add a default list"
        />
        <button className="btn brown" onClick={submit}>
          Add
        </button>
      </div>

      <div className="actions">
        <div style={{ flex: 1 }} />
        <button className="btn sage" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  )
}
