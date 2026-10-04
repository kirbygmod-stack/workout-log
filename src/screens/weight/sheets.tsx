import { useState } from 'react'
import {
  MAX_TARGET_RATE,
  MAX_WEIGHT_LB,
  MIN_TARGET_RATE,
  MIN_WEIGHT_LB,
  clearWeightGoal,
  deleteWeight,
  saveWeight,
  setTargetRate,
  setWeightGoal,
  type WeightGoal,
} from '../../db'
import { Icon } from '../../components/Icon'
import { Sheet } from '../../components/Sheet'
import {
  MIN_WEIGHINS_FOR_PROJECTION,
  dayOf,
  etaTo,
  fmtDay,
  fmtLb,
  goalDir,
  projection,
  type Projection,
  type TrendPoint,
} from '../../weight'
import { etaText } from './shared'

function projReason(p: Projection) {
  switch (p.kind) {
    case 'away':
      return 'Not trending toward goal right now.'
    case 'few':
      return `A projection needs at least ${MIN_WEIGHINS_FOR_PROJECTION} weigh-ins.`
    case 'far':
      return 'At the current rate the goal is over 2 years away.'
    default:
      return ''
  }
}

export function GoalSheet({ goal, pts, today, onClose }: { goal: WeightGoal | undefined; pts: TrendPoint[]; today: number; onClose: () => void }) {
  const [value, setValue] = useState(goal ? String(Math.round(goal.weight)) : pts.length ? String(Math.round(pts.at(-1)!.trend)) : '')
  const [error, setError] = useState('')
  const p = goal ? projection(pts, goal, today) : null
  const reason = p ? projReason(p) : ''

  const save = async () => {
    const n = parseWeight(value)
    if (n == null) return setError(`Enter a goal between ${MIN_WEIGHT_LB} and ${MAX_WEIGHT_LB} lb.`)
    if (!Number.isInteger(n)) return setError('Whole pounds only.')
    const trend = pts.at(-1)?.trend
    // Direction is fixed now, so "Reached" knows which side counts as past the goal.
    await setWeightGoal({ weight: n, ...(trend != null && n !== trend ? { dir: n < trend ? 'down' : 'up' } : {}) })
    onClose()
  }
  const clear = async () => {
    await clearWeightGoal()
    onClose()
  }

  return (
    <Sheet title="Goal weight" onClose={onClose}>
      <WeightInput value={value} onChange={(v) => (setValue(v), setError(''))} step={1} label="Goal weight" whole />
      {reason && <p className="muted small center">{reason}</p>}
      {error && <div className="error center">{error}</div>}
      <button className="btn primary log-btn" onClick={save}>
        Save
      </button>
      {goal && (
        <button className="btn danger form-extra full" onClick={clear}>
          Clear goal
        </button>
      )}
    </Sheet>
  )
}

export function TargetRateSheet({
  rate,
  goal,
  pts,
  today,
  onClose,
}: {
  rate: number | undefined
  goal: WeightGoal | undefined
  pts: TrendPoint[]
  today: number
  onClose: () => void
}) {
  const [value, setValue] = useState(rate ?? 1)
  const bump = (by: number) => setValue((v) => Math.min(MAX_TARGET_RATE, Math.max(MIN_TARGET_RATE, Math.round((v + by) * 100) / 100)))
  const goalW = goal ? Math.round(goal.weight) : null
  const dir = goal ? goalDir(goal, pts.at(-1)?.trend) : 'down'
  const preview = goalW != null ? etaText(etaTo(pts, goalW, dir, ((dir === 'down' ? -1 : 1) * value) / 7), today) : null
  const save = async () => {
    await setTargetRate(value)
    onClose()
  }
  return (
    <Sheet title="Target rate" onClose={onClose}>
      <p className="muted small center">The pace you're aiming for.</p>
      <div className="weight-input">
        <button type="button" className="round big-round" aria-label="Target rate minus 0.25" onClick={() => bump(-0.25)}>
          −
        </button>
        <div className="weight-input-mid">
          <div className="big-input weight-entry mono" aria-live="polite">
            {value.toFixed(2)}
          </div>
          <div className="muted tiny">lb / week · ±0.25</div>
        </div>
        <button type="button" className="round big-round" aria-label="Target rate plus 0.25" onClick={() => bump(0.25)}>
          +
        </button>
      </div>
      {preview && goalW != null && (
        <p className="muted small center">
          Goal <span className="mono text">{goalW}</span> lb: {preview.date}
          {preview.rel && ` · ${preview.rel}`}
        </p>
      )}
      <button className="btn primary log-btn" onClick={save}>
        Save
      </button>
    </Sheet>
  )
}

function parseWeight(v: string) {
  const n = Number(v.trim())
  if (v.trim() === '' || !isFinite(n) || n < MIN_WEIGHT_LB || n > MAX_WEIGHT_LB) return null
  return Math.round(n * 10) / 10
}

function WeightInput({
  value,
  onChange,
  step,
  label,
  whole,
}: {
  value: string
  onChange: (v: string) => void
  step: number
  label: string
  whole?: boolean
}) {
  const bump = (by: number) => {
    const n = Number(value)
    const base = value.trim() === '' || !isFinite(n) ? 0 : whole ? Math.round(n) : n
    const next = Math.min(Math.max(Math.round((base + by) * 10) / 10, MIN_WEIGHT_LB), MAX_WEIGHT_LB)
    onChange(step < 1 ? next.toFixed(1) : String(next))
  }
  return (
    <div className="weight-input">
      <button type="button" className="round big-round" aria-label={`${label} minus ${step}`} onClick={() => bump(-step)}>
        −
      </button>
      <div className="weight-input-mid">
        <input
          className="big-input weight-entry"
          inputMode={whole ? 'numeric' : 'decimal'}
          aria-label={label}
          value={value}
          placeholder={whole ? '0' : '0.0'}
          onChange={(e) => onChange(e.target.value.replace(',', '.'))}
        />
        <div className="muted tiny">lb · ±{step}</div>
      </div>
      <button type="button" className="round big-round" aria-label={`${label} plus ${step}`} onClick={() => bump(step)}>
        +
      </button>
    </div>
  )
}

export function LogSheet({
  entries,
  todayStr,
  editDate,
  onClose,
}: {
  entries: { date: string; weight: number }[]
  todayStr: string
  editDate?: string
  onClose: () => void
}) {
  const byDate = new Map(entries.map((e) => [e.date, e.weight]))
  const latest = entries.at(-1)?.weight
  const initialDate = editDate ?? todayStr
  const initial = byDate.get(initialDate) ?? latest
  const [date, setDate] = useState(initialDate)
  const [value, setValue] = useState(initial != null ? fmtLb(initial) : '')
  const [error, setError] = useState('')

  const existing = byDate.get(date)
  const showReplace = existing != null && date !== editDate

  const changeDate = (d: string) => {
    if (!d || d > todayStr) return
    setDate(d)
    setError('')
    const w = byDate.get(d)
    if (w != null) setValue(fmtLb(w))
  }

  const save = async () => {
    const n = parseWeight(value)
    if (n == null) return setError(`Enter a weight between ${MIN_WEIGHT_LB} and ${MAX_WEIGHT_LB} lb.`)
    await saveWeight(date, n, editDate)
    onClose()
  }
  const remove = async () => {
    if (!editDate) return
    if (!confirm(`Delete the weigh-in for ${fmtDay(dayOf(editDate), { weekday: 'short', month: 'short', day: 'numeric' })}?`)) return
    await deleteWeight(editDate)
    onClose()
  }

  const dateLabel = `${date === todayStr ? 'Today · ' : ''}${fmtDay(dayOf(date), { weekday: 'short', month: 'short', day: 'numeric' })}`

  return (
    <Sheet title={editDate ? 'Edit weigh-in' : 'Log weight'} onClose={onClose}>
      <label className="date-row">
        <span className="muted">
          <Icon name="history" size={16} /> Date
        </span>
        <span>{dateLabel}</span>
        <input type="date" value={date} max={todayStr} onChange={(e) => changeDate(e.target.value)} aria-label="Date" />
      </label>
      <WeightInput value={value} onChange={(v) => (setValue(v), setError(''))} step={0.2} label="Weight" />
      {showReplace && (
        <p className="muted small center">
          {date === todayStr ? 'Today' : fmtDay(dayOf(date), { month: 'short', day: 'numeric' })} already has <span className="mono">{fmtLb(existing!)}</span>. Saving replaces it.
        </p>
      )}
      {error && <div className="error center">{error}</div>}
      <button className="btn primary log-btn" onClick={save}>
        Save
      </button>
      {editDate && (
        <button className="btn danger form-extra full" onClick={remove}>
          Delete
        </button>
      )}
    </Sheet>
  )
}
