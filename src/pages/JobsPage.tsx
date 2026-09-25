import { useState } from 'react'
import type { JobPage } from '../types'
import { useListly } from '../context/ListlyContext'
import { dueLabel, isDueSoon, sortOpenJobs } from '../lib/jobs'
import { shortRule } from '../lib/recurrence'
import { alertSummary } from '../lib/alerts'
import { JobSheet } from '../components/JobSheet'
import { Bell, Chevron, Plus, Tick } from '../components/Icons'

const TITLE: Record<JobPage, string> = { house: 'House jobs', mine: 'To-Do' }

/**
 * House jobs and To-Do are the same page with different data — the two
 * pages are identical in behaviour and each has its own jobs (TECHNICAL.md
 * §12) — so they are ONE component parameterised by `page`.
 *
 * That mirrors the backend deliberately. PROMPT-01 §5.4 keeps `house_jobs`
 * and `my_jobs` as two tables rather than one table with a `page` column,
 * because the RLS predicate and the Sync Stream predicate genuinely differ
 * (household vs user) — but the React component is written once. Two
 * tables, one component, on purpose.
 *
 * "To-Do" is the page's NAME only (Adam, 2026-09-25). The table is still
 * `my_jobs` and the page id still 'mine', so `?tab=mine` deep links from
 * notifications keep working — renaming a published table is what
 * MIGRATION-LESSONS §19 forbids.
 *
 * There is no inline add form any more: the + beside the count opens the
 * same sheet a tap on a job does, because a job now has a repeat and an
 * alert to set as well as a name and a date (PROMPT-01 §A4).
 */
export function JobsPage({ page }: { page: JobPage }) {
  const { jobsFor, device, toggleJob, toggleRemind, setDoneOpen } = useListly()
  // null = closed, 'new' = creating, otherwise the id being edited.
  const [sheet, setSheet] = useState<string | null>(null)

  const all = jobsFor(page)
  const open = sortOpenJobs(all.filter((j) => !j.done))
  const done = all.filter((j) => j.done)
  const doneOpen = device.doneOpen[page]

  return (
    <div className="stack">
      <div className="pagehead">
        <h1 className="grow">{TITLE[page]}</h1>
        <span>{open.length} to do</span>
        <button className="icon-btn round-add" onClick={() => setSheet('new')} aria-label={`Add a job to ${TITLE[page]}`}>
          <Plus />
        </button>
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
            <button className="jobtext" onClick={() => setSheet(job.id)}>
              <span className="t">{job.text}</span>
              {job.due && (
                <span className={`chip${isDueSoon(job.due) ? ' soon' : ''}`}>{dueLabel(job.due, job.dueTime)}</span>
              )}
              {/* The repeat whenever there is one; the alert only when it is
                  not the default (Adam, 2026-09-25). */}
              {job.due && (job.repeat || (job.remind && (job.alertOffset || job.alertTime))) && (
                <span className="jobmeta">
                  {[shortRule(job.repeat), job.remind ? alertSummary(job.alertOffset, job.alertTime) : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </button>
            {/* The bell shows only when there is a due date to remind about.
                It switches this job's alerts off and on; the alert settings
                themselves are kept either way. */}
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

      {sheet && <JobSheet page={page} jobId={sheet === 'new' ? null : sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}
