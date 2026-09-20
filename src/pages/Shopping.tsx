import { useState } from 'react'
import { useListly } from '../context/ListlyContext'
import { ShoppingList } from '../components/ShoppingList'
import { ItemEditSheet } from '../components/ItemEditSheet'
import { ManageListsSheet } from '../components/ManageListsSheet'
import { Sliders } from '../components/Icons'

export function Shopping() {
  const { visibleLists, addList } = useListly()
  const [draft, setDraft] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [editing, setEditing] = useState<{ listId: string; itemId: string } | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  // 🚨 This used to fail silently. "Add list did nothing" was reported three
  // times and the database confirmed nothing was written — but with no
  // feedback there was no way to tell whether the tap never landed, the
  // field was empty, or the write threw. Now it says which.
  const submit = () => {
    const name = draft.trim()
    if (!name) {
      setHint('Type a list name first, then tap Add list.')
      return
    }
    setHint(null)
    // The dashed box at the bottom of the page makes a NON-default list
    // (LISTLY-DESIGN.md §2). Manage lists is where default ones are made.
    void addList(name, false)
      .then(() => setDraft(''))
      .catch((e: unknown) => setHint(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`))
  }

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Shopping</h1>
        <button className="manage-btn" onClick={() => setManageOpen(true)}>
          <Sliders />
          Manage lists
        </button>
      </div>

      {visibleLists.map((list) => (
        <ShoppingList
          key={list.id}
          list={list}
          onEditItem={(itemId) => setEditing({ listId: list.id, itemId })}
        />
      ))}

      {visibleLists.length === 0 && <div className="empty">No lists yet — start one below.</div>}

      <div className="newlist">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="New list, e.g. Tesco"
          aria-label="New list name"
        />
        <button
          className={`btn brown${draft.trim() ? '' : ' waiting'}`}
          onClick={submit}
          type="button"
        >
          Add list
        </button>
      </div>

      {hint && (
        <p className="help" style={{ color: 'var(--red)', padding: '0 6px' }} role="alert">
          {hint}
        </p>
      )}

      {manageOpen && <ManageListsSheet onClose={() => setManageOpen(false)} />}
      {editing && (
        <ItemEditSheet
          listId={editing.listId}
          itemId={editing.itemId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
