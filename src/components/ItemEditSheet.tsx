import { useState } from 'react'
import { useListly } from '../context/ListlyContext'
import { Sheet } from './Sheet'

/**
 * Tap an item's text to rename it, delete it, or move it to another list
 * (TECHNICAL.md §11). There is deliberately no drag-between-lists: this
 * sheet is the move mechanism.
 *
 * Picking a chip and typing a new list name are mutually exclusive — either
 * would be a destination, and allowing both would make "which wins?" a
 * guess. Choosing one clears the other, exactly as the prototype does.
 */
export function ItemEditSheet({
  listId,
  itemId,
  onClose,
}: {
  listId: string
  itemId: string
  onClose: () => void
}) {
  const { lists, saveItem, deleteItem } = useListly()
  const list = lists.find((l) => l.id === listId)
  const item = list?.items.find((i) => i.id === itemId)

  const [text, setText] = useState(item?.text ?? '')
  const [moveTo, setMoveTo] = useState('')
  const [newName, setNewName] = useState('')

  if (!list || !item) return null

  return (
    <Sheet label="Edit item" onClose={onClose}>
      <div className="pagehead" style={{ padding: 0 }}>
        <h2>Edit item</h2>
        <span className="sub">in {list.name}</span>
      </div>

      <input
        className="field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Name"
        autoFocus
      />

      <div className="lbl">Move to another list</div>
      <div className="chips">
        {lists
          .filter((l) => l.id !== listId)
          .map((l) => (
            <button
              key={l.id}
              aria-pressed={moveTo === l.id}
              onClick={() => {
                setMoveTo(moveTo === l.id ? '' : l.id)
                setNewName('')
              }}
            >
              {l.name}
            </button>
          ))}
      </div>
      <input
        className="newname"
        value={newName}
        onChange={(e) => {
          setNewName(e.target.value)
          setMoveTo('')
        }}
        placeholder="…or name a new list"
        aria-label="Move to a new list"
      />

      <div className="actions">
        <button
          className="btn danger"
          onClick={() => {
            deleteItem(listId, itemId)
            onClose()
          }}
        >
          Delete
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn sage"
          onClick={() => {
            saveItem(listId, itemId, text, moveTo, newName)
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}
