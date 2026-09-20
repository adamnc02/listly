import { useState } from 'react'
import { useListly } from '../context/ListlyContext'
import { Sheet } from './Sheet'

const PAGE_TITLE = { house: 'House jobs', mine: 'My jobs' } as const

/**
 * Tap a job to edit its text, due date and reminder (LISTLY-DESIGN.md §3).
 *
 * The reminder checkbox appears only when a due date is set, and clearing
 * the date turns the reminder off — a reminder fires three days before a
 * due date, so without one there is nothing for it to fire against. The
 * context enforces the same rule on save, and Phase 2 adds it a third time
 * as a CHECK constraint (`check (not remind or due_date is not null)`), so
 * it cannot be violated by any path.
 */
export function JobEditSheet({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { jobs, saveJob, deleteJob } = useListly()
  const job = jobs.find((j) => j.id === jobId)

  const [text, setText] = useState(job?.text ?? '')
  const [due, setDue] = useState(job?.due ?? '')
  const [remind, setRemind] = useState(job?.remind ?? false)

  if (!job) return null

  return (
    <Sheet label="Edit job" onClose={onClose}>
      <div className="pagehead" style={{ padding: 0 }}>
        <h2>Edit job</h2>
        <span className="sub">{PAGE_TITLE[job.page]}</span>
      </div>

      <input
        className="field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Name"
        autoFocus
      />

      <label className="lbl" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        Due date
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>

      {due !== '' && (
        <label className="check">
          <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
          Remind me about this job
        </label>
      )}

      <div className="actions">
        <button
          className="btn danger"
          onClick={() => {
            deleteJob(jobId)
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
            saveJob(jobId, text, due, remind)
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}
