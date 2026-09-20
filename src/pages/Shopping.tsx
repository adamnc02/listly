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

  const submit = () => {
    // The dashed box at the bottom of the page makes a NON-default list
    // (LISTLY-DESIGN.md §2). Manage lists is where default ones are made.
    addList(draft, false)
    setDraft('')
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
        <button className="btn brown" onClick={submit}>
          Add list
        </button>
      </div>

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
