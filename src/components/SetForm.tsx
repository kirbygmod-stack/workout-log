import { useState } from 'react'
import type { Exercise, SetEntry } from '../db'
import { durationInput, fmtNum, parseDuration, parseNum } from '../format'

export type SetValues = Pick<SetEntry, 'weight' | 'reps' | 'durationSec' | 'speed' | 'level' | 'calories' | 'restSec'>

function Stepper({
  label,
  value,
  onChange,
  step,
  mode,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  step: number
  mode: 'decimal' | 'numeric'
  placeholder?: string
}) {
  const bump = (d: number) => {
    const n = parseNum(value) ?? 0
    onChange(fmtNum(Math.max(0, n + d)))
  }
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="stepper">
        <button type="button" className="step" onClick={() => bump(-step)} aria-label={`${label} minus ${step}`}>
          −
        </button>
        <input className="input num" inputMode={mode} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="step" onClick={() => bump(step)} aria-label={`${label} plus ${step}`}>
          +
        </button>
      </div>
    </label>
  )
}

function Plain({
  label,
  value,
  onChange,
  mode = 'decimal',
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mode?: 'decimal' | 'numeric' | 'text'
  placeholder?: string
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input num" inputMode={mode} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/**
 * Inputs for one set, adapted to the exercise kind.
 * `showRest` is for editing an already-logged set (rest is measured automatically for new ones).
 */
export function SetForm({
  exercise,
  initial,
  submitLabel,
  showRest,
  onSubmit,
  onCancel,
  onDelete,
}: {
  exercise: Exercise
  initial?: SetValues
  submitLabel: string
  showRest?: boolean
  onSubmit: (v: SetValues) => void
  onCancel?: () => void
  onDelete?: () => void
}) {
  const kind = exercise.kind
  const [weight, setWeight] = useState(fmtNum(initial?.weight))
  const [reps, setReps] = useState(initial?.reps != null ? String(initial.reps) : '')
  const [duration, setDuration] = useState(durationInput(initial?.durationSec))
  const [speed, setSpeed] = useState(fmtNum(initial?.speed))
  const [level, setLevel] = useState(fmtNum(initial?.level))
  const [calories, setCalories] = useState(fmtNum(initial?.calories))
  const [rest, setRest] = useState(durationInput(initial?.restSec))
  const [error, setError] = useState('')

  const submit = () => {
    const v: SetValues = {}
    if (kind === 'weight' || kind === 'bodyweight') {
      const r = parseNum(reps)
      if (!r || r <= 0) return setError('Enter reps.')
      v.reps = Math.round(r)
      const w = parseNum(weight)
      if (kind === 'weight' && w == null) return setError('Enter weight.')
      if (w != null && w < 0) return setError('Weight can’t be negative.')
      if (w) v.weight = w
      else if (kind === 'weight') v.weight = 0
    }
    if (kind === 'timed') {
      const d = parseDuration(duration, 'sec')
      if (!d) return setError('Enter time (e.g. 45 or 1:30).')
      v.durationSec = d
      const w = parseNum(weight)
      if (w) v.weight = w
    }
    if (kind === 'cardio') {
      const d = parseDuration(duration, 'min')
      if (!d) return setError('Enter duration in minutes (e.g. 30 or 25:30).')
      const s = parseNum(speed)
      if (!s || s <= 0) return setError('Enter speed (mph).')
      v.durationSec = d
      v.speed = s
      const l = parseNum(level)
      if (l != null) v.level = l
      const c = parseNum(calories)
      if (c != null) v.calories = c
    }
    if (showRest) {
      const r = parseDuration(rest, 'sec')
      v.restSec = r
    }
    setError('')
    onSubmit(v)
  }

  return (
    <div className="set-form">
      <div className="set-fields">
        {kind === 'weight' && (
          <>
            <Stepper label="lbs" value={weight} onChange={setWeight} step={5} mode="decimal" />
            <Stepper label="Reps" value={reps} onChange={setReps} step={1} mode="numeric" />
          </>
        )}
        {kind === 'bodyweight' && (
          <>
            <Stepper label="Reps" value={reps} onChange={setReps} step={1} mode="numeric" />
            <Stepper label="+ lbs (optional)" value={weight} onChange={setWeight} step={5} mode="decimal" placeholder="0" />
          </>
        )}
        {kind === 'timed' && (
          <>
            <Plain label="Time (sec or m:ss)" value={duration} onChange={setDuration} mode="text" placeholder="0:45" />
            <Plain label="+ lbs (optional)" value={weight} onChange={setWeight} placeholder="0" />
          </>
        )}
        {kind === 'cardio' && (
          <>
            <Plain label="Minutes (or mm:ss)" value={duration} onChange={setDuration} mode="text" placeholder="30" />
            <Plain label="Speed (mph)" value={speed} onChange={setSpeed} placeholder="6.0" />
            {exercise.levelLabel !== '' && (
              <Plain label={`${exercise.levelLabel || 'Incline / Level'} (opt.)`} value={level} onChange={setLevel} />
            )}
            <Plain label="Calories (opt.)" value={calories} onChange={setCalories} mode="numeric" />
          </>
        )}
        {showRest && <Plain label="Rest before (m:ss)" value={rest} onChange={setRest} mode="text" placeholder="—" />}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row gap">
        <button type="button" className="btn primary grow" onClick={submit}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        {onDelete && (
          <button type="button" className="btn danger" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
