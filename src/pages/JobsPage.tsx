import { useState } from 'react'
import type { JobPage } from '../types'
import { useListly } from '../context/ListlyContext'
import { dueLabel, isDueSoon, sortOpenJobs } from '../lib/jobs'
import { JobEditSheet } from '../components/JobEditSheet'
import { Bell, Chevron, Tick } from '../components/Icons'

const TITLE: Record<JobPage, string> = { house: 'House jobs', mine: 'My jobs' }

/**
 * House jobs and My jobs are the same page with different data
 * (LISTLY-DESIGN.md §3: "The two pages are identical in behaviour; each has
 * its own jobs"), so they are ONE component parameterised by `page`.
 *
 * That mirrors the backend deliberately. PROMPT-01 §5.4 keeps `house_jobs`
 * and `my_jobs` as two tables rather than one table with a `page` column,
 * because the RLS predicate and the Sync Stream predicate genuinely differ
 * (household vs user) — but the React component is written once. Two
 * tables, one component, on purpose.
 */
export function JobsPage({ page }: { page: JobPage }) {
  const { jobsFor, device, addJob, toggleJob, toggleRemind, setDoneOpen } = useListly()
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const all = jobsFor(page)
  const open = sortOpenJobs(all.filter((j) => !j.done))
  const done = all.filter((j) => j.done)
  const doneOpen = device.doneOpen[page]

  // A job needs a name; a due date is optional. Say so rather than ignoring
  // the tap — the same rule as every other "add" in the app.
  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setHint('Give the job a name first.')
      return
    }
    setHint(null)
    void addJob(page, trimmed, due)
      .then(() => {
        setText('')
        setDue('')
      })
      .catch((e: unknown) =>
        setHint(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`),
      )
  }

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>{TITLE[page]}</h1>
        <span>{open.length} to do</span>
      </div>

      <div className="card jobform">
        <input
          className="line-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Add a job…"
          aria-label="New job"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="due-lbl">
            Due
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <button className={`btn sage${text.trim() ? '' : ' waiting'}`} onClick={submit}>
            Add
          </button>
        </div>
        {hint && (
          <p className="help" style={{ color: 'var(--red)', margin: 0 }} role="alert">
            {hint}
          </p>
        )}
      </div>

      <div className="card jobs">
        {open.map((job) => (
          <div className="row" style={{ minHeight: 52 }} key={job.id}>
            <button
              className="tick"
              onClick={() => toggleJob(job.id)}
              aria-pressed={false}
              aria-label={`Mark ${job.text} done`}
            >
              <span className="box" />
            </button>
            <button className="jobtext" onClick={() => setEditing(job.id)}>
              <span className="t">{job.text}</span>
              {job.due && (
                <span className={`chip${isDueSoon(job.due) ? ' soon' : ''}`}>{dueLabel(job.due)}</span>
              )}
            </button>
            {/* The bell shows only when there is a due date to remind about. */}
            {job.due && (
              <button
                className="icon-btn bell"
                onClick={() => toggleRemind(job.id)}
                aria-pressed={job.remind}
                aria-label={`Remind me about ${job.text}`}
                title={job.remind ? 'Reminder on' : 'Set a reminder'}
              >
                <Bell />
              </button>
            )}
          </div>
        ))}
        {open.length === 0 && <div className="empty">All jobs done. Nice.</div>}
      </div>

      <div className={`card done-card${doneOpen ? ' open' : ''}`}>
        <button
          className="donehead"
          onClick={() => setDoneOpen(page, !doneOpen)}
          aria-expanded={doneOpen}
        >
          <Chevron />
          <span className="name">Done</span>
          <span style={{ fontSize: 20 }}>{done.length}</span>
        </button>
        {doneOpen && (
          <div style={{ padding: '0 8px 10px' }}>
            {done.map((job) => (
              <div className="row" style={{ minHeight: 46 }} key={job.id}>
                <button
                  className="tick"
                  onClick={() => toggleJob(job.id)}
                  aria-pressed={true}
                  aria-label={`Move ${job.text} back`}
                >
                  <span className="box on">
                    <Tick />
                  </span>
                </button>
                <span className="donetext">{job.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <JobEditSheet jobId={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
