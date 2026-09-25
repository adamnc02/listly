import { useState } from 'react'
import type { JobDraft, JobPage } from '../types'
import { useListly } from '../context/ListlyContext'
import { Sheet } from './Sheet'
import { EMPTY_DRAFT } from '../lib/jobs'
import {
  DAY_OFFSETS, DEFAULT_OFFSET, DEFAULT_TIME, isTimedOffset, offsetLabel, TIME_OFFSETS,
} from '../lib/alerts'
import {
  customStart, describeRule, formatRule, kindWord, MONTHS_SHORT, parseRule, posWord, POS_KINDS,
  POSITIONS, presetOf, presetRule, PRESETS, WEEKDAYS,
  type Freq, type PosKind, type Preset, type Rule, type Weekday,
} from '../lib/recurrence'

const PAGE_TITLE: Record<JobPage, string> = { house: 'House jobs', mine: 'To-Do' }
const FREQS: Array<{ id: Freq; label: string; unit: string }> = [
  { id: 'D', label: 'Daily', unit: 'day' },
  { id: 'W', label: 'Weekly', unit: 'week' },
  { id: 'M', label: 'Monthly', unit: 'month' },
  { id: 'Y', label: 'Yearly', unit: 'year' },
]
const DAY_LETTERS: Record<Weekday, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' }

/** Which Custom frequency to open on, given the menu entry it came from. */
function customFrom(preset: Preset, due: string): Rule {
  if (preset === 'W' || preset === '2W') return { ...customStart('W', due), interval: preset === '2W' ? 2 : 1 }
  if (preset === 'M' || preset === 'Y') return customStart(preset, due)
  return customStart('D', due)
}

/** Toggle one value in a list, refusing to empty it: a weekly rule with no
 *  weekday, or a monthly one with no date, has nothing to repeat on. */
function toggleIn<T>(list: T[], value: T): T[] {
  if (list.includes(value)) return list.length > 1 ? list.filter((v) => v !== value) : list
  return [...list, value]
}

/**
 * Create AND edit a job (PROMPT-01 §A4, Adam, 2026-09-25): opened by the +
 * in the page header, and by tapping a job. One sheet, two steps — the job
 * itself, and iOS Calendar's Custom repeat screen — so everything about a
 * job is set in one place.
 *
 * The rules it keeps (each also enforced by jobColumns() on save, and most by
 * a CHECK in the database, because a refused upload is discarded silently):
 *   - Entering a due date turns the bell ON (Q10); clearing it turns the bell
 *     off and clears the time, the repeat and any timed alert.
 *   - Hour and minute alerts are only offered once a time is set (Q8), and
 *     clearing the time falls back to the default alert.
 *   - A repeat needs a date to repeat from, so Repeat only shows with one.
 */
export function JobSheet({ page, jobId, onClose }: { page: JobPage; jobId: string | null; onClose: () => void }) {
  const { jobs, addJob, saveJob, deleteJob } = useListly()
  const job = jobId ? jobs.find((j) => j.id === jobId) : undefined

  const [draft, setDraft] = useState<JobDraft>(() => (job ? { ...job } : { ...EMPTY_DRAFT }))
  const [preset, setPreset] = useState<Preset>(() => (job ? presetOf(job.repeat, job.due) : 'never'))
  const [custom, setCustom] = useState<Rule | null>(() =>
    job && presetOf(job.repeat, job.due) === 'custom' ? parseRule(job.repeat) : null,
  )
  const [step, setStep] = useState<'job' | 'custom'>('job')
  const [hint, setHint] = useState<string | null>(null)

  // Editing a job that another phone has just deleted: nothing to edit.
  if (jobId && !job) return null

  const set = (patch: Partial<JobDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const setDue = (due: string) =>
    setDraft((d) => {
      if (!due) return { ...d, due: '', dueTime: '', remind: false, alertOffset: isTimedOffset(d.alertOffset) ? '' : d.alertOffset }
      // Q10: a date arriving turns the bell on. Changing an existing date
      // leaves the bell as the person set it.
      return { ...d, due, remind: d.due ? d.remind : true }
    })
  const setTime = (dueTime: string) =>
    setDraft((d) => ({ ...d, dueTime, alertOffset: !dueTime && isTimedOffset(d.alertOffset) ? '' : d.alertOffset }))

  const repeatRule = !draft.due ? '' : preset === 'custom' && custom ? formatRule(custom) : presetRule(preset, draft.due)
  const recurring = !!job?.repeat && !job.done

  const save = () => {
    if (!draft.text.trim()) {
      setHint('Give the job a name first.')
      return
    }
    const final: JobDraft = { ...draft, repeat: repeatRule }
    if (job) {
      saveJob(job.id, final)
      onClose()
      return
    }
    void addJob(page, final)
      .then(onClose)
      .catch((e: unknown) => setHint(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`))
  }

  if (step === 'custom' && custom) {
    return (
      <Sheet label="Custom repeat" onClose={onClose}>
        <CustomRepeat rule={custom} due={draft.due} onChange={setCustom} onDone={() => setStep('job')} />
      </Sheet>
    )
  }

  const offset = draft.alertOffset || DEFAULT_OFFSET
  const offsets = draft.dueTime ? [...TIME_OFFSETS, ...DAY_OFFSETS] : [...DAY_OFFSETS]

  return (
    <Sheet label={job ? 'Edit job' : 'New job'} onClose={onClose}>
      <div className="pagehead" style={{ padding: 0 }}>
        <h2>{job ? 'Edit job' : 'New job'}</h2>
        <span className="sub">{PAGE_TITLE[page]}</span>
      </div>

      <input
        className="field"
        value={draft.text}
        onChange={(e) => set({ text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
        placeholder="What needs doing?"
        aria-label="Name"
        autoFocus={!job}
      />

      <div className="formrow">
        <span className="lbl">Due</span>
        <input type="date" value={draft.due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
      </div>

      {draft.due && (
        <div className="formrow">
          <span className="lbl">Time</span>
          <input type="time" value={draft.dueTime} onChange={(e) => setTime(e.target.value)} aria-label="Due time" />
          {draft.dueTime && (
            <button className="btn ghost small" onClick={() => setTime('')}>
              No time
            </button>
          )}
        </div>
      )}

      {draft.due && (
        <div className="formrow">
          <span className="lbl">Repeat</span>
          <select
            value={preset}
            onChange={(e) => {
              const next = e.target.value as Preset
              if (next === 'custom') {
                setCustom((c) => c ?? customFrom(preset, draft.due))
                setPreset('custom')
                setStep('custom')
                return
              }
              setPreset(next)
            }}
            aria-label="Repeat"
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </div>
      )}
      {draft.due && preset === 'custom' && custom && (
        <button className="summary-btn" onClick={() => setStep('custom')}>
          {describeRule(formatRule(custom))} <span className="edit">Change</span>
        </button>
      )}

      {draft.due && (
        <label className="check">
          <input type="checkbox" checked={draft.remind} onChange={(e) => set({ remind: e.target.checked })} />
          Remind me
        </label>
      )}
      {draft.due && draft.remind && (
        <>
          <div className="formrow">
            <span className="lbl">Alert</span>
            <select
              value={offset}
              onChange={(e) => set({ alertOffset: e.target.value === DEFAULT_OFFSET ? '' : e.target.value })}
              aria-label="Alert"
            >
              {offsets.map((o) => (
                <option key={o} value={o}>{offsetLabel(o)}</option>
              ))}
            </select>
            {!isTimedOffset(offset) && (
              <input
                type="time"
                value={draft.alertTime || DEFAULT_TIME}
                onChange={(e) => set({ alertTime: e.target.value === DEFAULT_TIME ? '' : e.target.value })}
                aria-label="Alert time"
              />
            )}
          </div>
          <p className="help">
            {isTimedOffset(offset)
              ? 'One notification then. If it’s still not done, one at 8am every day after it’s due.'
              : 'A notification every day from then until it’s ticked done — overdue too.'}
          </p>
        </>
      )}

      {hint && !draft.text.trim() && (
        <p className="help" style={{ color: 'var(--red)' }} role="alert">
          {hint}
        </p>
      )}

      <div className="actions">
        {job && (
          <button
            className="btn danger"
            onClick={() => {
              deleteJob(job.id)
              onClose()
            }}
          >
            Delete
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className={`btn sage${draft.text.trim() ? '' : ' waiting'}`} onClick={save}>
          {job ? 'Save' : 'Add'}
        </button>
      </div>
      {recurring && <p className="help">Deleting a repeating job ends it and moves it to Done.</p>}
    </Sheet>
  )
}

/** iOS Calendar's Custom screen: Frequency, Every N, then the per-frequency
 *  grid, with the sentence that says what it all means. */
function CustomRepeat({
  rule, due, onChange, onDone,
}: { rule: Rule; due: string; onChange: (r: Rule) => void; onDone: () => void }) {
  const unit = FREQS.find((f) => f.id === rule.freq)!.unit
  const onThe = rule.pos !== null
  const setPos = (pos: number, posKind: PosKind) => onChange({ ...rule, pos, posKind, byMonthDay: [] })
  const clearPos = () => onChange({ ...rule, pos: null, posKind: null, byMonthDay: [customStart(rule.freq, due).byMonthDay[0]] })

  const posPickers = (
    <div className="formrow">
      <select value={rule.pos ?? 1} onChange={(e) => setPos(Number(e.target.value), rule.posKind ?? 'MO')} aria-label="Which">
        {POSITIONS.map((p) => (
          <option key={p} value={p}>{posWord(p)}</option>
        ))}
      </select>
      <select value={rule.posKind ?? 'MO'} onChange={(e) => setPos(rule.pos ?? 1, e.target.value as PosKind)} aria-label="Day">
        {POS_KINDS.map((k) => (
          <option key={k} value={k}>{kindWord(k)}</option>
        ))}
      </select>
    </div>
  )

  return (
    <>
      <div className="pagehead" style={{ padding: 0 }}>
        <h2>Custom</h2>
        <button className="btn sage" onClick={onDone}>
          Done
        </button>
      </div>

      <div className="chips" role="group" aria-label="Frequency">
        {FREQS.map((f) => (
          <button
            key={f.id}
            aria-pressed={rule.freq === f.id}
            onClick={() => onChange({ ...customStart(f.id, due), interval: rule.interval })}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="formrow">
        <span className="lbl">Every</span>
        <select value={rule.interval} onChange={(e) => onChange({ ...rule, interval: Number(e.target.value) })} aria-label="Every">
          {Array.from({ length: 99 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="unit">{rule.interval === 1 ? unit : `${unit}s`}</span>
      </div>

      <p className="help">{describeRule(formatRule(rule))}</p>

      {rule.freq === 'W' && (
        <div className="grid grid7" role="group" aria-label="Days of the week">
          {WEEKDAYS.map((w) => (
            <button key={w} aria-pressed={rule.byDay.includes(w)} onClick={() => onChange({ ...rule, byDay: toggleIn(rule.byDay, w) })}>
              {DAY_LETTERS[w]}
            </button>
          ))}
        </div>
      )}

      {rule.freq === 'M' && (
        <>
          <div className="chips" role="group" aria-label="Each or on the">
            <button aria-pressed={!onThe} onClick={clearPos}>Each</button>
            <button aria-pressed={onThe} onClick={() => setPos(rule.pos ?? 1, rule.posKind ?? 'MO')}>On the…</button>
          </div>
          {onThe ? posPickers : (
            <div className="grid grid7" role="group" aria-label="Dates">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  aria-pressed={rule.byMonthDay.includes(d)}
                  onClick={() => onChange({ ...rule, byMonthDay: toggleIn(rule.byMonthDay, d) })}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          {!onThe && rule.byMonthDay.some((d) => d > 28) && (
            <p className="help">In a shorter month, it falls on the last day.</p>
          )}
        </>
      )}

      {rule.freq === 'Y' && (
        <>
          <div className="grid grid4" role="group" aria-label="Months">
            {MONTHS_SHORT.map((m, i) => (
              <button
                key={m}
                aria-pressed={rule.byMonth.includes(i + 1)}
                onClick={() => onChange({ ...rule, byMonth: toggleIn(rule.byMonth, i + 1) })}
              >
                {m}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={onThe} onChange={(e) => (e.target.checked ? setPos(1, 'SU') : clearPos())} />
            Days of week
          </label>
          {onThe && posPickers}
        </>
      )}
    </>
  )
}
