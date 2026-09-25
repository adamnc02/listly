import { useEffect, useRef, useState } from 'react'
import { to12, to24, type Time12 } from '../lib/time12'

/**
 * The 12-hour time picker (Adam, 2026-09-25): AM/PM at the top, then an hour
 * drum (1–12) and a minute drum (00–59). "Set" hands back 'HH:MM' 24-hour —
 * the only form anything stores — so the time field beside the clock button
 * shows the 24-hour figure Adam prefers, and Ella never has to read it.
 *
 * The drum is BLOC's rest-timer picker (bloc-app index.html, buildPicker()):
 * three rows showing, the middle one chosen, faded above and below, a line
 * either side of the chosen row, drag to turn. Ported to React, and given
 * three more ways to turn it that BLOC's phone-only drum did not need — a
 * mouse wheel or trackpad, the arrow keys, and a tap on the row above or
 * below — because Listly's UAT runs on a laptop.
 *
 * It clamps at the ends rather than wrapping, as BLOC's does.
 */

// 🚨 These three move together, as in BLOC: the window is exactly three
// rows, so the chosen row is centred only while DRUM_H === ROW_H * 3.
const ROW_H = 56
const DRUM_H = ROW_H * 3
/** Wheel/trackpad travel that counts as one row. */
const WHEEL_STEP = 40

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

function Drum({
  label, values, index, onChange, pad,
}: { label: string; values: number[]; index: number; onChange: (i: number) => void; pad: boolean }) {
  const [dragging, setDragging] = useState(false)
  const start = useRef({ y: 0, index: 0, moved: false })
  const wheel = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const clamp = (i: number) => Math.max(0, Math.min(values.length - 1, i))

  // A native, non-passive wheel listener: React's onWheel is passive, so it
  // could not stop the sheet behind from scrolling while the drum turns.
  const latest = useRef({ index, onChange })
  useEffect(() => {
    latest.current = { index, onChange }
  })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      wheel.current += e.deltaY
      const steps = Math.trunc(wheel.current / WHEEL_STEP)
      if (steps !== 0) {
        wheel.current -= steps * WHEEL_STEP
        latest.current.onChange(Math.max(0, Math.min(values.length - 1, latest.current.index + steps)))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [values.length])

  const offset = -(index * ROW_H) + (DRUM_H / 2 - ROW_H / 2)
  const text = (v: number) => (pad ? String(v).padStart(2, '0') : String(v))

  return (
    <div className="drum-wrap">
      <div className="drum-label">{label}</div>
      <div
        ref={box}
        className="drum"
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={values[index]}
        aria-valuetext={text(values[index])}
        aria-valuemin={values[0]}
        aria-valuemax={values[values.length - 1]}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(clamp(index - 1)) }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(clamp(index + 1)) }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = { y: e.clientY, index, moved: false }
          setDragging(true)
        }}
        onPointerMove={(e) => {
          if (!dragging) return
          const delta = start.current.y - e.clientY
          if (Math.abs(delta) > 4) start.current.moved = true
          onChange(clamp(start.current.index + Math.round(delta / ROW_H)))
        }}
        onPointerUp={(e) => {
          setDragging(false)
          // A tap without a drag picks the row it landed on — the one above
          // or below the chosen row, as on iOS.
          if (!start.current.moved) {
            const rect = e.currentTarget.getBoundingClientRect()
            const row = Math.floor((e.clientY - rect.top) / ROW_H) - 1
            if (row !== 0) onChange(clamp(index + row))
          }
        }}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="drum-band" aria-hidden="true" />
        <div className="drum-fade" aria-hidden="true" />
        <div className={`drum-col${dragging ? '' : ' settle'}`} style={{ transform: `translateY(${offset}px)` }}>
          {values.map((v) => (
            <div key={v} className="drum-row">{text(v)}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Where the drums start for an empty field: now, to the next 5 minutes. */
function startingTime(): Time12 {
  const now = new Date()
  let mins = now.getHours() * 60 + Math.ceil(now.getMinutes() / 5) * 5
  mins %= 24 * 60
  const hhmm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  return to12(hhmm)!
}

export function TimeWheel({
  title, value, fallback, onSet, onCancel,
}: {
  title: string
  /** The field's current 'HH:MM', or ''. */
  value: string
  /** What an empty field starts on: a fixed 'HH:MM', or '' for "now". */
  fallback: string
  onSet: (hhmm: string) => void
  onCancel: () => void
}) {
  const [t, setT] = useState<Time12>(() => to12(value) ?? to12(fallback) ?? startingTime())

  return (
    <>
      <div className="pagehead" style={{ padding: 0 }}>
        <h2>{title}</h2>
      </div>

      <div className="chips ampm" role="group" aria-label="AM or PM">
        <button aria-pressed={!t.pm} onClick={() => setT({ ...t, pm: false })}>AM</button>
        <button aria-pressed={t.pm} onClick={() => setT({ ...t, pm: true })}>PM</button>
      </div>

      <div className="drums">
        <Drum label="Hour" values={HOURS} index={t.hour - 1} pad={false} onChange={(i) => setT({ ...t, hour: HOURS[i] })} />
        <div className="drum-colon" aria-hidden="true">:</div>
        <Drum label="Min" values={MINUTES} index={t.minute} pad onChange={(i) => setT({ ...t, minute: MINUTES[i] })} />
      </div>

      {/* Only the 24-hour figure (Adam, 2026-09-25): the drums already show
          the 12-hour time, and this is where Ella learns what it is on the
          24-hour clock — the form the field and the job's chip will show. */}
      <p className="help drum-readout">
        That’s <b>{to24(t)}</b> on the 24-hour clock
      </p>

      <div className="actions">
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sage" onClick={() => onSet(to24(t))}>
          Set
        </button>
      </div>
    </>
  )
}
