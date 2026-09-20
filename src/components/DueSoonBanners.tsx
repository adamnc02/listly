import { useListly } from '../context/ListlyContext'
import { isDismissedToday } from '../lib/deviceState'
import { dueLabel, isDueSoon } from '../lib/jobs'
import { Close, Warn } from './Icons'

const SHORT = { house: 'House job', mine: 'My job' } as const

/**
 * The red due-soon banners (LISTLY-DESIGN.md §4).
 *
 * Every OPEN job on either page that is due within 3 days or overdue gets
 * one, on EVERY tab — that is why this sits in App.tsx above the router,
 * not on the jobs pages.
 *
 * It is deliberately separate from the reminder bell: a job gets a banner
 * whether or not its reminder is on. The bell is "tell me when I'm not
 * looking at the app"; the banner is "you are looking at the app, and this
 * needs you".
 *
 * Dismissal is per device and lasts for the day (Adam, 2026-09-20). Editing
 * and saving the job re-arms it.
 */
export function DueSoonBanners() {
  const { jobs, device, dismissBanner } = useListly()

  const due = jobs
    .filter((j) => !j.done && j.due && isDueSoon(j.due) && !isDismissedToday(device, j.id))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))

  return (
    <>
      {due.map((job) => (
        <div className="alert" role="alert" key={job.id}>
          <Warn />
          <div className="grow">
            <div className="t">{job.text}</div>
            <div className="w">
              {SHORT[job.page]} · {dueLabel(job.due)}
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={() => dismissBanner(job.id)}
            aria-label={`Dismiss reminder for ${job.text}`}
          >
            <Close />
          </button>
        </div>
      ))}
    </>
  )
}
