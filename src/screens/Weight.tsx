import { useLiveQuery } from 'dexie-react-hooks'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_WEIGHT_LB,
  MIN_WEIGHT_LB,
  clearWeightGoal,
  db,
  deleteWeight,
  getWeightGoal,
  saveWeight,
  setWeightGoal,
  type WeightGoal,
} from '../db'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import {
  BUCKET_LABEL,
  MIN_SPAN,
  MIN_WEIGHINS_FOR_PROJECTION,
  PRESETS,
  bucketKindFor,
  dateOf,
  dayOf,
  dotLabel,
  dots as makeDots,
  fmtDay,
  fmtLb,
  goalDir,
  localToday,
  matchPreset,
  maxSpan,
  minV0,
  lineStep,
  linePoints,
  monotone,
  presetSpan,
  projection,
  trendPoints,
  windowChange,
  xTicks,
  yScale,
  type Dot,
  type PresetId,
  type Projection,
  type TrendPoint,
} from '../weight'

type SheetState = { kind: 'log'; editDate?: string } | { kind: 'goal' } | null

export function Weight() {
  const [todayStr] = useState(() => localToday())
  const today = dayOf(todayStr)
  const [screen, setScreen] = useState<'main' | 'entries'>('main')
  const [sheet, setSheet] = useState<SheetState>(null)

  const data = useLiveQuery(async () => ({
    entries: await db.weights.orderBy('date').toArray(),
    goal: await getWeightGoal(),
  }))
  const pts = useMemo(() => (data ? trendPoints(data.entries) : []), [data])

  if (!data) return null
  const { goal } = data

  const sheets = (
    <>
      {sheet?.kind === 'log' && (
        <LogSheet entries={data.entries} todayStr={todayStr} editDate={sheet.editDate} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'goal' && <GoalSheet goal={goal} pts={pts} today={today} onClose={() => setSheet(null)} />}
    </>
  )

  if (screen === 'entries') {
    return (
      <>
        <Entries pts={pts} today={today} onBack={() => setScreen('main')} onEdit={(date) => setSheet({ kind: 'log', editDate: date })} />
        {sheets}
      </>
    )
  }

  return (
    <div className="weight">
      <div className="row between weight-title">
        <h1>Weight</h1>
        <button className="btn primary small log-weight" onClick={() => setSheet({ kind: 'log' })}>
          <Icon name="plus" size={16} width={2.5} /> Log weight
        </button>
      </div>

      <WeightChart pts={pts} today={today} goal={goal} />

      <GoalCard pts={pts} goal={goal} today={today} onOpen={() => setSheet({ kind: 'goal' })} />

      <button className="settings-link" onClick={() => setScreen('entries')}>
        <Icon name="list" size={20} />
        <span className="grow">Entries</span>
        <Icon name="chevron" size={18} />
      </button>
      {sheets}
    </div>
  )
}

// ---------- chart ----------

const PLOT_H = 300
const TOP = 22
const BOTTOM = 20
const AXIS_W = 34
const INSET = 6
const TAP_SLOP = 5

/** Text color for a change: mint toward the goal, red away from it, grey at 0 or with no goal. */
function toneFor(diff: number | null, goal: WeightGoal | undefined, pts: TrendPoint[]) {
  if (diff == null || diff === 0 || !goal) return 'muted'
  const dir = goalDir(goal, pts.at(-1)?.trend)
  return (dir === 'down' ? diff < 0 : diff > 0) ? 'up' : 'down'
}

function WeightChart({ pts, today, goal }: { pts: TrendPoint[]; today: number; goal: WeightGoal | undefined }) {
  const [w, ref] = useWidth<HTMLDivElement>()
  const [view, setView] = useState(() => {
    const s = presetSpan('1M', pts, today)
    return { v0: today - s, span: s }
  })
  const [chosen, setChosen] = useState<PresetId | null>('1M')
  const [sel, setSel] = useState<{ key: number; kind: string } | null>(null)
  const gesture = useRef<{
    ptrs: Map<number, { x: number; y: number }>
    pan?: { x: number; v0: number }
    pinch?: { dist: number; span: number; anchor: number }
    down?: { x: number; y: number; moved: boolean }
  }>({ ptrs: new Map() })

  const maxS = maxSpan(pts, today)
  const clamp = (v0: number, span: number) => {
    const s = Math.min(Math.max(span, MIN_SPAN), maxS)
    return { span: s, v0: Math.min(Math.max(v0, minV0(pts, today)), today - s) }
  }
  const { v0, span } = clamp(view.v0, view.span)
  const v1 = v0 + span
  const preset = matchPreset(v0, span, pts, today, chosen)
  // ALL is always monthly; everything else averages by visible span.
  const kind = preset === 'ALL' ? 'monthly' : bucketKindFor(span)

  const plotL = AXIS_W + INSET
  const plotR = Math.max(plotL + 10, w - INSET)
  const X = (day: number) => plotL + ((day - v0) / span) * (plotR - plotL)
  const dayAtX = (x: number) => v0 + ((x - plotL) / (plotR - plotL)) * span

  // The line is drawn through fewer trend points as the view widens; stems and the popup read the same curve.
  const step = lineStep(span)
  const lpts = useMemo(() => linePoints(pts, step), [pts, step])
  const curve = useMemo(() => monotone(lpts), [lpts])
  const shownDots = useMemo(() => makeDots(pts, v0, v1, kind), [pts, v0, v1, kind])

  // Y range: visible dots plus the visible stretch of the trend.
  const inView = pts.filter((p) => p.day > v0 && p.day <= v1)
  const yVals = [...shownDots.map((d) => d.weight), ...lpts.filter((p) => p.x > v0 && p.x <= v1).map((p) => p.y)]
  if (pts.length && inView.length) {
    yVals.push(curve.at(Math.max(v0, pts[0].day)), curve.at(Math.min(v1, pts.at(-1)!.day)))
  }
  const ys = yVals.length ? yScale(yVals) : null
  const Y = (v: number) => (ys ? TOP + PLOT_H - ((v - ys.lo) / (ys.hi - ys.lo)) * PLOT_H : 0)

  // Trend path, clipped to the plot.
  const path = ys && lpts.length >= 2 ? curve.path(X, Y) : ''

  const r = kind === 'daily' ? (span > 14 ? 3.2 : 4) : kind === 'weekly' ? 3.8 : 4.4
  const dotPos = shownDots.map((d) => ({ d, cx: X(d.day), cy: Y(d.weight), ty: Y(curve.at(d.day)) }))
  const selDot = (sel && dotPos.find((p) => p.d.key === sel.key && p.d.kind === sel.kind)) || null

  const trendEnd = pts.length ? curveEnd(pts, v1) : null
  const diff = windowChange(pts, v0, v1)
  const tone = toneFor(diff, goal, pts)
  const rangeText = preset ?? `${fmtDay(Math.floor(v0) + 1)} – ${v1 >= today - 0.01 ? 'today' : fmtDay(Math.floor(v1))}`

  // ----- gestures: pinch zooms, one finger pans, a tap selects a dot -----
  const svgX = (clientX: number) => clientX - (ref.current?.getBoundingClientRect().left ?? 0)
  const setClamped = (nv0: number, ns: number) => setView(clamp(nv0, ns))

  const onDown = (e: React.PointerEvent) => {
    const g = gesture.current
    e.currentTarget.setPointerCapture(e.pointerId)
    g.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.ptrs.size === 1) {
      g.pan = { x: svgX(e.clientX), v0 }
      g.down = { x: e.clientX, y: e.clientY, moved: false }
      g.pinch = undefined
    } else if (g.ptrs.size === 2) {
      const [a, b] = [...g.ptrs.values()]
      g.pinch = { dist: Math.max(Math.abs(a.x - b.x), 20), span, anchor: dayAtX(svgX((a.x + b.x) / 2)) }
      g.pan = undefined
      if (g.down) g.down.moved = true
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g.ptrs.has(e.pointerId)) return
    g.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.down && Math.hypot(e.clientX - g.down.x, e.clientY - g.down.y) > TAP_SLOP) g.down.moved = true
    if (g.pinch && g.ptrs.size >= 2) {
      const [a, b] = [...g.ptrs.values()]
      const ns = Math.min(Math.max((g.pinch.span * g.pinch.dist) / Math.max(Math.abs(a.x - b.x), 20), MIN_SPAN), maxS)
      const frac = (svgX((a.x + b.x) / 2) - plotL) / (plotR - plotL)
      setClamped(g.pinch.anchor - frac * ns, ns)
    } else if (g.pan && g.down?.moved) {
      setClamped(g.pan.v0 - ((svgX(e.clientX) - g.pan.x) / (plotR - plotL)) * span, span)
    }
  }
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current
    const tap = g.ptrs.size === 1 && g.down && !g.down.moved
    g.ptrs.delete(e.pointerId)
    if (tap) {
      const rect = ref.current!.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      let best: (typeof dotPos)[number] | null = null
      let bd = 24
      for (const p of dotPos) {
        const dd = Math.hypot(p.cx - x, p.cy - y)
        if (dd < bd) {
          bd = dd
          best = p
        }
      }
      setSel(best ? { key: best.d.key, kind: best.d.kind } : null)
    }
    g.pinch = undefined
    if (g.ptrs.size === 1) {
      // Lifting one finger of a pinch: carry on panning with the other.
      const p = [...g.ptrs.values()][0]
      g.pan = { x: svgX(p.x), v0 }
      g.down = { x: p.x, y: p.y, moved: true }
    } else {
      g.pan = undefined
      g.down = undefined
    }
  }
  const onWheel = (e: React.WheelEvent) => {
    // Desktop: scroll or trackpad pinch zooms.
    const x = svgX(e.clientX)
    const anchor = dayAtX(x)
    const ns = Math.min(Math.max(span * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.003)), MIN_SPAN), maxS)
    setClamped(anchor - ((x - plotL) / (plotR - plotL)) * ns, ns)
  }

  const pickPreset = (id: PresetId) => {
    const s = presetSpan(id, pts, today)
    setView({ v0: today - s, span: s })
    setChosen(id)
    setSel(null)
  }

  const ticks = xTicks(v0, v1)
  const H = TOP + PLOT_H + BOTTOM

  return (
    <>
      <section className="card weight-card">
        <div className="row between weight-head">
          <div>
            <div className="muted small">Trend weight</div>
            <div className="mono weight-big">
              {trendEnd != null ? fmtLb(trendEnd) : '—'}
              {trendEnd != null && <span className="muted unit"> lb</span>}
            </div>
          </div>
          <div className="weight-chg">
            <div className={`mono weight-diff ${tone}`}>
              {diff == null ? '—' : `${diff < 0 ? '▼' : diff > 0 ? '▲' : ''}${fmtLb(Math.abs(diff))} lb`}
            </div>
            <div className="muted tiny">
              {rangeText} · {BUCKET_LABEL[kind]}
            </div>
          </div>
        </div>

        <div
          ref={ref}
          className="weight-chart"
          style={{ height: H }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={onWheel}
        >
          {w > 0 && (
            <svg width={w} height={H} role="img" aria-label={chartLabel(pts, v0, v1)}>
              <defs>
                <clipPath id="weight-plot">
                  <rect x={AXIS_W} y={TOP - 8} width={w - AXIS_W} height={PLOT_H + 16} />
                </clipPath>
              </defs>
              {ticks.map((t) => (
                <g key={t.day}>
                  {X(t.day) > AXIS_W + 1 && X(t.day) <= w && <line x1={X(t.day)} x2={X(t.day)} y1={TOP} y2={TOP + PLOT_H} className="grid" />}
                  {t.label && t.labelDay != null && (
                    <text x={X(t.labelDay)} y={12} textAnchor="middle" className="axis">
                      {t.label}
                    </text>
                  )}
                </g>
              ))}
              {ys &&
                range(ys.lo + ys.step, ys.hi - ys.step / 2, ys.step).map((v) => (
                  <g key={v}>
                    <line x1={AXIS_W} x2={w} y1={Y(v)} y2={Y(v)} className="grid" />
                    <text x={AXIS_W - 6} y={Y(v) + 4} textAnchor="end" className="axis mono">
                      {v}
                    </text>
                  </g>
                ))}
              <line x1={AXIS_W} x2={AXIS_W} y1={TOP} y2={TOP + PLOT_H} className="edge" />
              <g clipPath="url(#weight-plot)">
                {dotPos.map(({ d, cx, cy, ty }) => (
                  <line key={`s${d.key}`} x1={cx} x2={cx} y1={ty} y2={cy} className="stem" />
                ))}
                {path && <path d={path} className="trend" />}
                {dotPos.map(({ d, cx, cy }) => (
                  <circle key={`d${d.key}`} cx={cx} cy={cy} r={r} className="dot" />
                ))}
                {selDot && <circle cx={selDot.cx} cy={selDot.cy} r={r + 4.5} className="dot-ring" />}
              </g>
              <text x={AXIS_W} y={H - 4} className="axis">
                {fmtDay(Math.floor(v0) + 1)}
              </text>
              <text x={w} y={H - 4} textAnchor="end" className="axis">
                {v1 >= today - 0.01 ? 'Today' : fmtDay(Math.floor(v1))}
              </text>
            </svg>
          )}
          {pts.length === 0 && <div className="chart-empty muted small">Log your first weigh-in to start the trend.</div>}
          {pts.length > 0 && shownDots.length === 0 && <div className="chart-empty muted small">No weigh-ins in this range.</div>}
          {selDot && <DotPopup dot={selDot.d} trend={curve.at(selDot.d.day)} today={today} cx={selDot.cx} cy={selDot.cy} w={w} />}
        </div>
      </section>

      <div className="range weight-range" role="group" aria-label="Time range">
        {PRESETS.map((p) => (
          <button key={p} className={p === preset ? 'on' : ''} aria-pressed={p === preset} onClick={() => pickPreset(p)}>
            {p}
          </button>
        ))}
      </div>
    </>
  )
}

/** Trend at the right edge of the view: the curve there, or the last weigh-in's trend if the edge is past it. */
function curveEnd(pts: TrendPoint[], v1: number) {
  let v: number | null = null
  for (const p of pts) {
    if (p.day <= v1) v = p.trend
    else break
  }
  return v
}

function DotPopup({ dot, trend, today, cx, cy, w }: { dot: Dot; trend: number; today: number; cx: number; cy: number; w: number }) {
  const PW = 172
  const PH = dot.n > 1 ? 70 : 54
  const left = Math.min(Math.max(cx - PW / 2, AXIS_W), w - PW)
  const top = cy - PH - 14 < TOP ? cy + 14 : cy - PH - 14
  return (
    <div className="dot-pop" style={{ left, top, width: PW }}>
      <div className="muted tiny">{dotLabel(dot, today)}</div>
      <div className="mono dot-pop-val">
        {fmtLb(dot.weight)} lb{dot.n > 1 && <span className="muted tiny"> avg</span>}
      </div>
      <div className="muted tiny">
        {dot.n > 1 ? `${dot.n} weigh-ins · ` : ''}trend {fmtLb(trend)}
      </div>
    </div>
  )
}

function chartLabel(pts: TrendPoint[], v0: number, v1: number) {
  const vis = pts.filter((p) => p.day > v0 && p.day <= v1)
  if (vis.length === 0) return 'Weight chart, no weigh-ins in this range'
  return `Weight trend from ${fmtLb(vis[0].trend)} to ${fmtLb(vis.at(-1)!.trend)} pounds over ${vis.length} weigh-ins`
}

function range(from: number, to: number, step: number) {
  const out: number[] = []
  for (let v = from; v <= to; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

// ---------- goal ----------

function projText(p: Projection) {
  switch (p.kind) {
    case 'date':
      return fmtDay(p.day)
    case 'far':
      return 'Over 2 yrs'
    case 'reached':
      return 'Reached'
    default:
      return '—'
  }
}

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

function GoalCard({ pts, goal, today, onOpen }: { pts: TrendPoint[]; goal: WeightGoal | undefined; today: number; onOpen: () => void }) {
  if (!goal) {
    return (
      <button className="settings-link goal-empty" onClick={onOpen}>
        <span className="grow">Set a goal</span>
        <Icon name="chevron" size={18} />
      </button>
    )
  }
  const trend = pts.at(-1)?.trend
  const p = projection(pts, goal, today)
  const toGo = trend == null ? null : p.kind === 'reached' ? 0 : Math.abs(trend - goal.weight)
  return (
    <button className="card goal-card" onClick={onOpen} aria-label="Edit goal">
      <div>
        <div className="muted tiny">Goal</div>
        <div className="mono goal-num">{fmtLb(goal.weight)}</div>
      </div>
      <div>
        <div className="muted tiny">To go</div>
        <div className="mono goal-num">{toGo == null ? '—' : fmtLb(toGo)}</div>
      </div>
      <div className="goal-proj">
        <div className="muted tiny">Projected</div>
        <div className={`mono goal-num ${p.kind === 'date' || p.kind === 'far' || p.kind === 'reached' ? 'up' : 'muted'}`}>{projText(p)}</div>
      </div>
    </button>
  )
}

function GoalSheet({ goal, pts, today, onClose }: { goal: WeightGoal | undefined; pts: TrendPoint[]; today: number; onClose: () => void }) {
  const [value, setValue] = useState(goal ? fmtLb(goal.weight) : pts.length ? String(Math.round(pts.at(-1)!.trend)) : '')
  const [error, setError] = useState('')
  const p = goal ? projection(pts, goal, today) : null
  const reason = p ? projReason(p) : ''

  const save = async () => {
    const n = parseWeight(value)
    if (n == null) return setError(`Enter a goal between ${MIN_WEIGHT_LB} and ${MAX_WEIGHT_LB} lb.`)
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
      <WeightInput value={value} onChange={(v) => (setValue(v), setError(''))} step={1} label="Goal weight" />
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

// ---------- log sheet ----------

function parseWeight(v: string) {
  const n = Number(v.trim())
  if (v.trim() === '' || !isFinite(n) || n < MIN_WEIGHT_LB || n > MAX_WEIGHT_LB) return null
  return Math.round(n * 10) / 10
}

function WeightInput({ value, onChange, step, label }: { value: string; onChange: (v: string) => void; step: number; label: string }) {
  const bump = (by: number) => {
    const n = Number(value)
    const base = value.trim() === '' || !isFinite(n) ? 0 : n
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
          inputMode="decimal"
          aria-label={label}
          value={value}
          placeholder="0.0"
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

function LogSheet({
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

// ---------- entries ----------

function Entries({ pts, today, onBack, onEdit }: { pts: TrendPoint[]; today: number; onBack: () => void; onEdit: (date: string) => void }) {
  const groups: { month: string; rows: { p: TrendPoint; prev?: TrendPoint }[] }[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const month = fmtDay(pts[i].day, { month: 'long', year: 'numeric' })
    if (groups.at(-1)?.month !== month) groups.push({ month, rows: [] })
    groups.at(-1)!.rows.push({ p: pts[i], prev: pts[i - 1] })
  }
  return (
    <div className="weight-entries">
      <button className="btn ghost back" onClick={onBack}>
        <Icon name="back" size={18} /> Weight
      </button>
      <h1>Entries</h1>
      {pts.length === 0 && <p className="muted">Weigh-ins you log show up here.</p>}
      {groups.map((g) => (
        <section key={g.month}>
          <div className="kicker entries-month">{g.month}</div>
          <div className="entries-card">
            {g.rows.map(({ p, prev }) => {
              const d = prev ? p.weight - prev.weight : null
              return (
                <button key={p.day} className="entry-row" onClick={() => onEdit(dateOf(p.day))}>
                  <span className="grow">{p.day === today ? 'Today' : fmtDay(p.day, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span className="mono entry-w">{fmtLb(p.weight)}</span>
                  <span className="mono muted entry-d">{d == null ? '' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmtLb(Math.abs(d))}`}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

// ---------- util ----------

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [w, ref] as const
}
