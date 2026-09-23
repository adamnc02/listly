import { useState } from 'react'
import { useListly } from '../context/ListlyContext'
import { Sheet } from './Sheet'
import { Star, StarFilled, Trash } from './Icons'

/**
 * Manage lists (TECHNICAL.md §10). Shows EVERY list, hidden ones
 * included — that is the whole point of the sheet: a list that hides itself
 * when empty still exists, and this is where you find it.
 *
 * Phase 4 adds the category chip (PROMPT-01 §8.2d). The category is a
 * property of the LIST, not of a shop, so it is set here and not at the till.
 *
 * 🚨 The chip is behind the D4 gate. With no `people` row in the household
 * there is no ledger, a category means nothing, and the chip must not appear
 * AT ALL — not greyed out, not empty. Nothing on this screen should mention
 * a ledger that does not exist.
 */
export function ManageListsSheet({ onClose }: { onClose: () => void }) {
  const { lists, toggleDefault, deleteList, addList, ledgerGateOpen, categories, setListCategory } =
    useListly()
  const [draft, setDraft] = useState('')
  const [picking, setPicking] = useState<string | null>(null)
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? ''

  const submit = () => {
    if (!draft.trim()) return
    void addList(draft, true).then(() => setDraft(''))
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
                {ledgerGateOpen && (
                  <button
                    className={`cat-chip${l.categoryId ? '' : ' unset'}`}
                    onClick={() => setPicking(picking === l.id ? null : l.id)}
                    aria-expanded={picking === l.id}
                    aria-label={`Ledger category for ${l.name}`}
                  >
                    {l.categoryId ? categoryName(l.categoryId) || 'Category' : 'Set a category'}
                  </button>
                )}
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
              {ledgerGateOpen && picking === l.id && (
                <div className="chips cat-picker">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      aria-pressed={l.categoryId === c.id}
                      onClick={() => {
                        // 🚨 Stored exactly as read, '@<household_id>'
                        // suffix intact (§31).
                        setListCategory(l.id, c.id)
                        setPicking(null)
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
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
        <button className={`btn brown${draft.trim() ? '' : ' waiting'}`} onClick={submit}>
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
