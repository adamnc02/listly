import { useListly } from '../context/ListlyContext'
import { isDismissedToday } from '../lib/deviceState'
import { dueLabel, dueSoonQueue } from '../lib/jobs'
import type { Job } from '../types'
import { Close, Warn } from './Icons'

const SHORT = { house: 'House job', mine: 'To-Do' } as const

/**
 * The red due-soon banner (TECHNICAL.md §13).
 *
 * Every OPEN job on either page that is due within 3 days or overdue is in
 * the queue, on EVERY tab — that is why this sits in App.tsx above the
 * router, not on the jobs pages.
 *
 * ONE banner shows at a time, the soonest. A stack of full-size banners
 * pushes the list off a phone screen, so the rest wait behind it: a red count
 * over the top-right corner says how many are waiting in total, and ✕ on the
 * shown one dismisses it and brings up the next.
 *
 * It is deliberately separate from the reminder bell: a job is in the queue
 * whether or not its reminder is on. The bell is "tell me when I'm not
 * looking at the app"; the banner is "you are looking at the app, and this
 * needs you".
 *
 * Dismissal is per device and lasts for the day. Editing and saving the job
 * re-arms it.
 *
 * Tapping the banner anywhere but ✕ opens the job's tab and flashes its row,
 * the same as tapping that job's reminder notification (`onOpen`, routed
 * through `parseOpen()` in App.tsx). It does NOT dismiss: looking at a job is
 * not dealing with it. 🚨 ✕ stops its tap from reaching the banner, or every
 * dismiss would also jump tabs.
 */
export function DueSoonBanners({ onOpen }: { onOpen: (job: Job) => void }) {
  const { jobs, device, dismissBanner, householdSize } = useListly()
  // House jobs is hidden for a household of one, and so are its banners: a
  // banner for a tab you cannot open is a dead end.
  const queue = dueSoonQueue(jobs, (id) => isDismissedToday(device, id), householdSize === 1)
  const job = queue[0]
  if (!job) return null

  return (
    // The tap handler is on the whole banner so its padding and the warning
    // icon open the job too; the inner button is what a keyboard or screen
    // reader reaches, and its click bubbles up here.
    <div className="alert" role="alert" key={job.id} onClick={() => onOpen(job)}>
      {queue.length > 1 && (
        <span className="alert-count" aria-label={`${queue.length} due-soon reminders`}>
          {queue.length}
        </span>
      )}
      <Warn />
      <button className="grow alert-open" aria-label={`Show ${job.text} on ${SHORT[job.page]}`}>
        <span className="t">{job.text}</span>
        <span className="w">
          {SHORT[job.page]} · {dueLabel(job.due, job.dueTime)}
        </span>
      </button>
      <button
        className="icon-btn"
        onClick={(e) => {
          e.stopPropagation()
          dismissBanner(job.id)
        }}
        aria-label={`Dismiss reminder for ${job.text}`}
      >
        <Close />
      </button>
    </div>
  )
}
