import { useEffect, useRef, useState } from 'react'
import type { JobPage } from '../types'
import { useListly } from '../context/ListlyContext'
import { dueLabel, isDueSoon, sortOpenJobs } from '../lib/jobs'
import { shortRule } from '../lib/recurrence'
import { alertSummary } from '../lib/alerts'
import { JobSheet } from '../components/JobSheet'
import { DoneSheet } from '../components/DoneSheet'
import { Bell, Folder, Plus } from '../components/Icons'

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
export function JobsPage({
  page, flashJobId = null, flashKey = 0,
}: { page: JobPage; flashJobId?: string | null; flashKey?: number }) {
  const { jobsFor, toggleJob, toggleRemind } = useListly()
  // null = closed, 'new' = creating, otherwise the id being edited.
  const [sheet, setSheet] = useState<string | null>(null)
  const [doneSheet, setDoneSheet] = useState(false)
  const [doneHint, setDoneHint] = useState(false)

  const all = jobsFor(page)
  const open = sortOpenJobs(all.filter((j) => !j.done))
  const doneCount = all.filter((j) => j.done).length

  // A tapped reminder names its job (src/lib/openIntent.ts): bring the row
  // into view. The flash itself is CSS on the row. A job that is done,
  // deleted, or on the other page is simply not found, and nothing happens.
  const flashRow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    flashRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [flashJobId, flashKey])

  return (
    <div className="stack">
      <div className="pagehead">
        <h1 className="grow">{TITLE[page]}</h1>
        <span>{open.length} to do</span>
        {/* Done is a folder with a count, opening a sheet. With nothing done
            it is .waiting and says so if tapped (§19). */}
        <button
          className={`icon-btn done-btn${doneCount ? '' : ' waiting'}`}
          onClick={() => {
            if (!doneCount) {
              setDoneHint(true)
              return
            }
            setDoneHint(false)
            setDoneSheet(true)
          }}
          aria-label={`Done jobs, ${doneCount}`}
        >
          <Folder />
          {doneCount > 0 && <span className="done-count" aria-hidden="true">{doneCount}</span>}
        </button>
        <button className="icon-btn round-add" onClick={() => setSheet('new')} aria-label={`Add a job to ${TITLE[page]}`}>
          <Plus />
        </button>
      </div>

      {doneHint && !doneCount && (
        <p className="help" style={{ padding: '0 6px' }} role="status">
          Nothing done yet — ticked jobs go in the folder.
        </p>
      )}

      <div className="card jobs">
        {open.map((job) => (
          <div
            className={`row${job.id === flashJobId ? ' flash' : ''}`}
            style={{ minHeight: 52 }}
            // A new key per tap restarts the animation on a second tap.
            key={job.id === flashJobId ? `${job.id}:${flashKey}` : job.id}
            ref={job.id === flashJobId ? flashRow : undefined}
          >
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

      {sheet && <JobSheet page={page} jobId={sheet === 'new' ? null : sheet} onClose={() => setSheet(null)} />}
      {doneSheet && <DoneSheet page={page} onClose={() => setDoneSheet(false)} />}
    </div>
  )
}
