import { useId, useState, type ReactNode } from 'react'
import { MAX_ASSIST_LB, type Exercise, type SetEntry } from '../db'
import { durationInput, fmtNum, parseDuration, parseNum } from '../format'

export type SetValues = Pick<SetEntry, 'weight' | 'assist' | 'reps' | 'durationSec' | 'speed' | 'level' | 'calories' | 'restSec'>

/** How a big field's −/+ buttons change its text value. */
interface Step {
  by: number
  unit: string
  bump: (value: string, delta: number) => string
}

const numStep = (by: number, unit: string): Step => ({
  by,
  unit,
  bump: (v, d) => fmtNum(Math.max(0, Math.round(((parseNum(v) ?? 0) + d) * 10) / 10)),
})
const timeStep = (by: number, unit: string, bare: 'sec' | 'min'): Step => ({
  by,
  unit,
  bump: (v, d) => durationInput(Math.max(0, (parseDuration(v, bare) ?? 0) + d * (bare === 'min' ? 60 : 1))),
})

function Big({
  label,
  value,
  onChange,
  mode,
  step,
  placeholder,
  header,
}: {
  label: string
  /** Replaces the visible label (e.g. the Added/Assist toggle); `label` still names the input. */
  header?: ReactNode
  value: string
  onChange: (v: string) => void
  mode: 'decimal' | 'numeric' | 'text'
  step: Step
  placeholder?: string
}) {
  const id = useId()
  return (
    <div className="big">
      {header ?? (
        <label htmlFor={id} className="big-label">
          {label}
        </label>
      )}
      <input id={id} aria-label={header ? label : undefined} className="big-input" inputMode={mode} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <div className="big-steps">
        <button type="button" className="round" aria-label={`${label} minus ${step.by} ${step.unit}`} onClick={() => onChange(step.bump(value, -step.by))}>
          −
        </button>
        <button type="button" className="round" aria-label={`${label} plus ${step.by} ${step.unit}`} onClick={() => onChange(step.bump(value, step.by))}>
          +
        </button>
      </div>
    </div>
  )
}

function Small({
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
  const canAssist = kind === 'bodyweight' && !!exercise.assistable
  const [assistMode, setAssistMode] = useState(canAssist && !!initial?.assist)
  const [weight, setWeight] = useState(fmtNum(canAssist && initial?.assist ? initial.assist : initial?.weight))
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
      if (canAssist && assistMode) {
        if (w != null && w > MAX_ASSIST_LB) return setError(`Assist tops out at ${MAX_ASSIST_LB} lb.`)
        if (w) v.assist = w // 0 assist = plain bodyweight
      } else if (w) v.weight = w
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
    if (showRest) v.restSec = parseDuration(rest, 'sec')
    setError('')
    onSubmit(v)
  }

  return (
    <div className="set-form">
      <div className="big-fields">
        {kind === 'weight' && (
          <>
            <Big label="LBS" value={weight} onChange={setWeight} mode="decimal" step={numStep(5, 'lbs')} />
            <Big label="REPS" value={reps} onChange={setReps} mode="numeric" step={numStep(1, 'rep')} />
          </>
        )}
        {kind === 'bodyweight' && (
          <>
            <Big label="REPS" value={reps} onChange={setReps} mode="numeric" step={numStep(1, 'rep')} />
            <Big
              label={assistMode ? 'ASSIST LBS' : '+ LBS'}
              value={weight}
              onChange={setWeight}
              mode="decimal"
              step={numStep(5, 'lbs')}
              placeholder="0"
              header={
                canAssist ? (
                  <div className="mode-toggle" role="group" aria-label="Weight mode">
                    <button type="button" className={assistMode ? '' : 'on'} aria-pressed={!assistMode} onClick={() => setAssistMode(false)}>
                      Added
                    </button>
                    <button type="button" className={assistMode ? 'on' : ''} aria-pressed={assistMode} onClick={() => setAssistMode(true)}>
                      Assist
                    </button>
                  </div>
                ) : undefined
              }
            />
          </>
        )}
        {kind === 'timed' && (
          <>
            <Big label="TIME" value={duration} onChange={setDuration} mode="text" step={timeStep(5, 'seconds', 'sec')} placeholder="0:45" />
            <Big label="+ LBS" value={weight} onChange={setWeight} mode="decimal" step={numStep(5, 'lbs')} placeholder="0" />
          </>
        )}
        {kind === 'cardio' && (
          <>
            <Big label="MIN" value={duration} onChange={setDuration} mode="text" step={timeStep(1, 'minute', 'min')} placeholder="30" />
            <Big label="MPH" value={speed} onChange={setSpeed} mode="decimal" step={numStep(0.1, 'mph')} placeholder="6.0" />
          </>
        )}
      </div>
      {(kind === 'cardio' || showRest) && (
        <div className="small-fields">
          {kind === 'cardio' && exercise.levelLabel !== '' && (
            <Small label={exercise.levelLabel || 'Incline / Level'} value={level} onChange={setLevel} placeholder="—" />
          )}
          {kind === 'cardio' && <Small label="Calories" value={calories} onChange={setCalories} mode="numeric" placeholder="—" />}
          {showRest && <Small label="Rest before (m:ss)" value={rest} onChange={setRest} mode="text" placeholder="—" />}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <button type="button" className="btn primary log-btn" onClick={submit}>
        {submitLabel}
      </button>
      {(onCancel || onDelete) && (
        <div className="row gap form-extra">
          {onCancel && (
            <button type="button" className="btn grow" onClick={onCancel}>
              Cancel
            </button>
          )}
          {onDelete && (
            <button type="button" className="btn danger grow" onClick={onDelete}>
              Delete set
            </button>
          )}
        </div>
      )}
    </div>
  )
}
