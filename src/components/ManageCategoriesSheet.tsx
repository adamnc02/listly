import { useState } from 'react'
import type { JobPage } from '../types'
import { useListly } from '../context/ListlyContext'
import { Sheet } from './Sheet'
import { Trash } from './Icons'

const TITLE: Record<JobPage, string> = { house: 'House jobs', mine: 'To-Do' }

/**
 * Manage categories (TECHNICAL.md §12): one page's categories — add, rename,
 * delete. Their ORDER is dragged on the page itself, by each category's grip,
 * the same way shopping lists are.
 *
 * Deleting a category never deletes a job: its jobs move to Other. That is
 * said before it happens, because the jobs visibly move.
 */
export function ManageCategoriesSheet({ page, onClose }: { page: JobPage; onClose: () => void }) {
  const { jobs, jobCategories, addJobCategory, renameJobCategory, deleteJobCategory } = useListly()
  const categories = jobCategories.filter((c) => c.page === page)
  const [draft, setDraft] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  // Names being edited, keyed by id; saved on blur or Enter.
  const [names, setNames] = useState<Record<string, string>>({})

  const openIn = (id: string) => jobs.filter((j) => j.page === page && !j.done && j.categoryId === id).length

  const submit = () => {
    if (!draft.trim()) {
      setHint('Type a category name first, then tap Add.')
      return
    }
    setHint(null)
    void addJobCategory(page, draft)
      .then(() => setDraft(''))
      .catch((e: unknown) => setHint(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`))
  }

  const commit = (id: string) => {
    const name = names[id]
    if (name !== undefined) renameJobCategory(id, name)
    setNames((n) => {
      const next = { ...n }
      delete next[id]
      return next
    })
  }

  return (
    <Sheet label={`Manage categories — ${TITLE[page]}`} onClose={onClose}>
      <h2>Categories</h2>
      <p className="help">
        {TITLE[page]}. Tap a name to rename it. Drag categories into order on the page. Jobs with no
        category sit in Other, at the bottom.
      </p>

      <div>
        {categories.map((c) => {
          const n = openIn(c.id)
          return (
            <div className="mrow" key={c.id}>
              <div className="grow">
                <input
                  className="nm-input"
                  value={names[c.id] ?? c.name}
                  onChange={(e) => setNames((s) => ({ ...s, [c.id]: e.target.value }))}
                  onBlur={() => commit(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  aria-label={`Rename ${c.name}`}
                />
                <div className="st">{n ? `${n} to do` : 'empty'}</div>
              </div>
              <button
                className="icon-btn del"
                onClick={() => {
                  if (!n || window.confirm(`Delete "${c.name}"? Its ${n} job(s) move to Other.`)) {
                    deleteJobCategory(c.id)
                  }
                }}
                aria-label={`Delete ${c.name} category`}
              >
                <Trash />
              </button>
            </div>
          )
        })}
        {categories.length === 0 && <div className="empty-note">No categories yet — add one below.</div>}
      </div>

      <div className="newlist">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="e.g. Garden"
          aria-label="New category name"
        />
        <button className={`btn brown${draft.trim() ? '' : ' waiting'}`} onClick={submit}>
          Add
        </button>
      </div>
      {hint && (
        <p className="help" style={{ color: 'var(--red)' }} role="alert">
          {hint}
        </p>
      )}

      <div className="actions">
        <div style={{ flex: 1 }} />
        <button className="btn sage" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  )
}
