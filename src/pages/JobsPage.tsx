import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Job, JobPage } from '../types'
import { useListly } from '../context/ListlyContext'
import { dueLabel, isDueSoon } from '../lib/jobs'
import { groupJobs, groupKeyOf, isGroupOpen, type JobGroup } from '../lib/jobGroups'
import { shortRule } from '../lib/recurrence'
import { alertSummary } from '../lib/alerts'
import { useDragReorder, type DragReorder } from '../lib/useDragReorder'
import { JobSheet } from '../components/JobSheet'
import { DoneSheet } from '../components/DoneSheet'
import { ManageCategoriesSheet } from '../components/ManageCategoriesSheet'
import { Bell, Chevron, Folder, Grip, Plus, Sliders } from '../components/Icons'
import { EMPTY_DRAFT } from '../lib/jobs'

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
 * The page is built like Shopping: the page's categories, each a
 * collapsible card dragged into order by its grip, with its own "Add a
 * job…" row; then "Other" for jobs with no category (lib/jobGroups.ts);
 * then a dashed box that makes a new category. A job is added by name into
 * its card; its date, repeat and alert are set by tapping it, which opens
 * the job sheet.
 */
export function JobsPage({
  page, flashJobId = null, flashKey = 0,
}: { page: JobPage; flashJobId?: string | null; flashKey?: number }) {
  const { jobsFor, jobs, jobCategories, device, setCategoryOpen, reorderJobCategories, addJobCategory } = useListly()
  // The id of the job being edited, or null.
  const [sheet, setSheet] = useState<string | null>(null)
  const [catDraft, setCatDraft] = useState('')
  const [catHint, setCatHint] = useState<string | null>(null)
  const [doneSheet, setDoneSheet] = useState(false)
  const [doneHint, setDoneHint] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const all = jobsFor(page)
  const openCount = all.filter((j) => !j.done).length
  const doneCount = all.length - openCount
  const groups = groupJobs(page, jobs, jobCategories)
  const categoryGroups = groups.filter((g) => g.category)
  const other = groups.find((g) => !g.category)

  // 🚨 A tapped reminder or due-soon banner names its job (lib/openIntent.ts).
  // If the job's category is collapsed on THIS phone its row is not rendered,
  // and the flash would land on nothing, silently. So the flashed job's group
  // renders open, and is remembered open.
  const flashJob = flashJobId ? all.find((j) => j.id === flashJobId && !j.done) : undefined
  const flashGroup = flashJob ? groupKeyOf(flashJob, jobCategories) : null
  // Safe as an effect only because setCategoryOpen is stable and opening an
  // already-open group returns the SAME state (withCategoryOpen), so React
  // bails out. A version that always built a new object would loop.
  useEffect(() => {
    if (flashGroup) setCategoryOpen(flashGroup, true)
  }, [flashGroup, flashKey, setCategoryOpen])

  // Bring the flashed row into view. The flash itself is CSS on the row. A
  // job that is done, deleted, or on the other page is simply not found.
  const flashRow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    flashRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [flashJobId, flashKey])

  const isOpen = (key: string) => isGroupOpen(device, key, flashGroup)

  // Categories reorder by the grip on their header (§17). Other is not in
  // this list and has no grip: it is always last. `data-drag-list`, because
  // each card contains job rows marked `data-drag-row`.
  const {
    draggingIndex: catDragging, dropIndex: catDrop, containerRef: catContainer, handleProps: catHandle,
  } = useDragReorder(
    categoryGroups.length,
    (from, to) => reorderJobCategories(page, categoryGroups.map((g) => g.key), from, to),
    'data-drag-list',
  )

  // The dashed box at the bottom, as Shopping's "New list": an empty field is
  // stated, a failed write named (§19).
  const submitCategory = () => {
    if (!catDraft.trim()) {
      setCatHint('Type a category name first, then tap Add category.')
      return
    }
    setCatHint(null)
    void addJobCategory(page, catDraft)
      .then(() => setCatDraft(''))
      .catch((e: unknown) => setCatHint(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`))
  }

  const card = (g: JobGroup, drag?: { handle: ReturnType<DragReorder['handleProps']>; dragging: boolean }) => (
    <CategoryCard
      page={page}
      group={g}
      open={isOpen(g.key)}
      onToggle={() => setCategoryOpen(g.key, !isOpen(g.key))}
      onEdit={setSheet}
      flashJobId={flashJobId}
      flashKey={flashKey}
      flashRow={flashRow}
      drag={drag}
    />
  )

  return (
    <div className="stack">
      <div className="pagehead">
        <h1 className="grow">{TITLE[page]}</h1>
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
        <button className="manage-btn" onClick={() => setManageOpen(true)}>
          <Sliders />
          Categories
        </button>
      </div>

      {doneHint && !doneCount && (
        <p className="help" style={{ padding: '0 6px' }} role="status">
          Nothing done yet — ticked jobs go in the folder.
        </p>
      )}

      {categoryGroups.length > 0 && (
        <div className="stack" ref={catContainer}>
          {categoryGroups.map((g, index) => (
            <div key={g.key}>
              {catDrop === index && <div className="drop-cursor between" role="presentation" />}
              {card(g, { handle: catHandle(index), dragging: catDragging === index })}
            </div>
          ))}
          {catDrop === categoryGroups.length && <div className="drop-cursor between" role="presentation" />}
        </div>
      )}

      {other && card(other)}

      {groups.length === 0 && (
        <div className="empty">
          {jobCategories.some((c) => c.page === page)
            ? 'All jobs done. Nice.'
            : 'No categories yet — start one below.'}
        </div>
      )}

      <div className="newlist">
        <input
          value={catDraft}
          onChange={(e) => setCatDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitCategory()
          }}
          placeholder="New category, e.g. Garden"
          aria-label="New category name"
        />
        <button className={`btn brown${catDraft.trim() ? '' : ' waiting'}`} onClick={submitCategory} type="button">
          Add category
        </button>
      </div>
      {catHint && !catDraft.trim() && (
        <p className="help" style={{ color: 'var(--red)', padding: '0 6px' }} role="alert">
          {catHint}
        </p>
      )}

      {sheet && <JobSheet page={page} jobId={sheet} onClose={() => setSheet(null)} />}
      {doneSheet && <DoneSheet page={page} onClose={() => setDoneSheet(false)} />}
      {manageOpen && <ManageCategoriesSheet page={page} onClose={() => setManageOpen(false)} />}
    </div>
  )
}

/**
 * One category (or Other) as a collapsible card: dated jobs first, soonest
 * first, with no grip; then undated jobs, which carry a grip and drag within
 * the card. Its own component because each card owns a drag hook.
 */
function CategoryCard({
  page, group, open, onToggle, onEdit, flashJobId, flashKey, flashRow, drag,
}: {
  page: JobPage
  group: JobGroup
  open: boolean
  onToggle: () => void
  onEdit: (jobId: string) => void
  flashJobId: string | null
  flashKey: number
  flashRow: RefObject<HTMLDivElement | null>
  drag?: { handle: ReturnType<DragReorder['handleProps']>; dragging: boolean }
}) {
  const { reorderJobs, addJob } = useListly()
  const [draft, setDraft] = useState('')
  const [addHint, setAddHint] = useState<string | null>(null)
  const name = group.category?.name ?? 'Other'
  const count = group.dated.length + group.undated.length
  const undatedIds = group.undated.map((j) => j.id)
  const { draggingIndex, dropIndex, containerRef, handleProps } = useDragReorder(
    group.undated.length,
    (from, to) => reorderJobs(page, undatedIds, from, to),
  )

  // Same rule as a list's "Add an item…": an empty field is stated, never
  // silently ignored, and a failed write names itself (§19). The job lands
  // in THIS card, undated; tapping it sets the rest.
  const submit = () => {
    const text = draft.trim()
    if (!text) {
      setAddHint('Type a job first.')
      return
    }
    setAddHint(null)
    void addJob(page, { ...EMPTY_DRAFT, text, categoryId: group.category?.id ?? '' })
      .then(() => setDraft(''))
      .catch((e: unknown) => setAddHint(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`))
  }

  const row = (job: Job, grip?: ReturnType<DragReorder['handleProps']>, dragging = false) => (
    <JobRow
      job={job}
      onEdit={onEdit}
      flash={job.id === flashJobId}
      flashRow={flashRow}
      grip={grip}
      dragging={dragging}
    />
  )

  return (
    <section className={`card jobcat${open ? ' open' : ''}${drag?.dragging ? ' dragging' : ''}`} data-drag-list={drag ? '' : undefined}>
      <div className="listhead">
        {drag ? (
          <span
            className="grip"
            title="Hold, then drag to reorder"
            role="button"
            tabIndex={-1}
            aria-label={`Reorder ${name}`}
            {...drag.handle}
          >
            <Grip />
          </span>
        ) : (
          <span className="grip-space" />
        )}
        <button className="listtoggle" onClick={onToggle} aria-expanded={open}>
          <span style={{ color: 'var(--brown)' }}>
            <Chevron />
          </span>
          <span className="name">{name}</span>
          <span className="grow" />
          <span className="pill">{count ? `${count} to do` : 'empty'}</span>
        </button>
      </div>

      {open && (
        <div className="listbody">
          {count === 0 && <div className="empty-note">Nothing in {name} yet.</div>}
          {group.dated.map((job) => (
            <div key={job.id === flashJobId ? `${job.id}:${flashKey}` : job.id}>{row(job)}</div>
          ))}
          <div ref={containerRef}>
            {group.undated.map((job, index) => (
              <div key={job.id === flashJobId ? `${job.id}:${flashKey}` : job.id}>
                {dropIndex === index && <div className="drop-cursor" role="presentation" />}
                {row(job, handleProps(index), draggingIndex === index)}
              </div>
            ))}
            {dropIndex === group.undated.length && <div className="drop-cursor" role="presentation" />}
          </div>

          <div className="addrow">
            <input
              className="line-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="Add a job…"
              aria-label={`Add a job to ${name}`}
              enterKeyHint="done"
            />
            <button className={`icon-btn round-add${draft.trim() ? '' : ' waiting'}`} onClick={submit} aria-label="Add job">
              <Plus />
            </button>
          </div>
          {addHint && !draft.trim() && (
            <p className="help" style={{ color: 'var(--red)', padding: '0 8px' }} role="alert">
              {addHint}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function JobRow({
  job, onEdit, flash, flashRow, grip, dragging,
}: {
  job: Job
  onEdit: (jobId: string) => void
  flash: boolean
  flashRow: RefObject<HTMLDivElement | null>
  /** Undated jobs only: a dated job sorts by date, so dragging it would be
   *  undone at once. */
  grip?: ReturnType<DragReorder['handleProps']>
  dragging: boolean
}) {
  const { toggleJob, toggleRemind } = useListly()
  return (
    <div
      className={`row${flash ? ' flash' : ''}${dragging ? ' dragging' : ''}`}
      style={{ minHeight: 52 }}
      data-drag-row={grip ? '' : undefined}
      ref={flash ? flashRow : undefined}
    >
      {grip ? (
        <span
          className="grip"
          title="Hold, then drag to reorder"
          role="button"
          tabIndex={-1}
          aria-label={`Reorder ${job.text}`}
          {...grip}
        >
          <Grip />
        </span>
      ) : (
        <span className="grip-space" />
      )}
      <button
        className="tick"
        onClick={() => toggleJob(job.id)}
        aria-pressed={false}
        aria-label={`Mark ${job.text} done`}
      >
        <span className="box" />
      </button>
      <button className="jobtext" onClick={() => onEdit(job.id)}>
        <span className="t">{job.text}</span>
        {job.due && <span className={`chip${isDueSoon(job.due) ? ' soon' : ''}`}>{dueLabel(job.due, job.dueTime)}</span>}
        {/* The repeat whenever there is one; the alert only when it is not
            the default. */}
        {job.due && (job.repeat || (job.remind && (job.alertOffset || job.alertTime))) && (
          <span className="jobmeta">
            {[shortRule(job.repeat), job.remind ? alertSummary(job.alertOffset, job.alertTime) : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </button>
      {/* The bell shows only when there is a due date to remind about. It
          switches this job's alerts off and on; the settings are kept. */}
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
  )
}
