import { useState } from 'react'
import { useListly, type ShopSnapshot } from '../context/ListlyContext'
import { ShoppingList } from '../components/ShoppingList'
import { ItemEditSheet } from '../components/ItemEditSheet'
import { ManageListsSheet } from '../components/ManageListsSheet'
import { FinishShopSheet } from '../components/FinishShopSheet'
import { LedgerErrors } from '../components/LedgerErrors'
import { ShopConfirmation } from '../components/ShopConfirmation'
import { Sliders } from '../components/Icons'

export function Shopping() {
  const { visibleLists, addList, finishShop } = useListly()
  const [pricing, setPricing] = useState<ShopSnapshot | null>(null)
  // The completion row just sent to the ledger, while its confirmation plays.
  const [confirming, setConfirming] = useState<string | null>(null)
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
    // (TECHNICAL.md §8). Manage lists is where default ones are made.
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

      {/* 🚨 A shop that never reached the ledger says so, here, at the top
          of the page. A silent failure is exactly the class of bug this
          workstream keeps paying for. */}
      <LedgerErrors />

      {visibleLists.map((list) => (
        <ShoppingList
          key={list.id}
          list={list}
          onEditItem={(itemId) => setEditing({ listId: list.id, itemId })}
          onPriceShop={setPricing}
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

      {hint && !draft.trim() && (
        <p className="help" style={{ color: 'var(--red)', padding: '0 6px' }} role="alert">
          {hint}
        </p>
      )}

      {manageOpen && <ManageListsSheet onClose={() => setManageOpen(false)} />}
      {pricing && (
        <FinishShopSheet
          shop={pricing}
          // 🚨 Cancel changes NOTHING — the ticked items were never deleted.
          onCancel={() => setPricing(null)}
          // Saved, or explicitly finished without pricing: only now do the
          // ticked items go and the list collapse. Only a Save hands back an
          // id — "Don't price it" sent nothing, so there is nothing to confirm.
          onComplete={(completionId) => {
            void finishShop(pricing.listId)
            setPricing(null)
            if (completionId) setConfirming(completionId)
          }}
        />
      )}
      {confirming && <ShopConfirmation completionId={confirming} onDone={() => setConfirming(null)} />}
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
