import type { JobPage } from '../types'
import { useListly } from '../context/ListlyContext'
import { Sheet } from './Sheet'
import { Tick } from './Icons'

const TITLE: Record<JobPage, string> = { house: 'House jobs', mine: 'To-Do' }

/**
 * One page's done jobs, newest first, opened from the folder in the page
 * heading (TECHNICAL.md §12). Ticking a box moves the job back to its page;
 * the sheet stays open, so several can be brought back in a row.
 *
 * A recurring job never arrives here: ticking it moves the same row on to its
 * next date. A deleted recurring job does, with its repeat cleared.
 */
export function DoneSheet({ page, onClose }: { page: JobPage; onClose: () => void }) {
  const { jobsFor, toggleJob } = useListly()
  // ISO timestamps compare as strings. A row with no done_at sorts last.
  const done = jobsFor(page)
    .filter((j) => j.done)
    .sort((a, b) => (a.doneAt === b.doneAt ? 0 : a.doneAt > b.doneAt ? -1 : 1))

  return (
    <Sheet label={`Done — ${TITLE[page]}`} onClose={onClose}>
      <h2>Done</h2>
      <p className="sub">{TITLE[page]} · tick a box to bring a job back.</p>
      <div className="done-list">
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
        {done.length === 0 && <div className="empty-note">Nothing done yet.</div>}
      </div>
    </Sheet>
  )
}
