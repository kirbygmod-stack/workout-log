import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_TARGET_RATE,
  MAX_WEIGHT_LB,
  MIN_TARGET_RATE,
  MIN_WEIGHT_LB,
  clearWeightGoal,
  db,
  deleteWeight,
  getTargetRate,
  getWeightGoal,
  saveWeight,
  setTargetRate,
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
  etaTo,
  fmtDay,
  fmtFuture,
  fmtLb,
  forecast,
  goalProgress,
  goalDir,
  localToday,
  matchPreset,
  maxSpan,
  milestones,
  minV0,
  lineStep,
  linePoints,
  monotone,
  presetSpan,
  projection,
  rates,
  relDays,
  trendChange,
  trendPoints,
  trendSlope,
  windowChange,
  xTicks,
  yScale,
  type Dot,
  type Eta,
  type PresetId,
  type Projection,
  type RateId,
  type TrendPoint,
} from '../weight'

type SheetState = { kind: 'log'; editDate?: string } | { kind: 'goal' } | { kind: 'rate' } | null

export function Weight() {
  const [todayStr] = useState(() => localToday())
  const today = dayOf(todayStr)
  const [screen, setScreen] = useState<'main' | 'entries'>('main')
  const [sheet, setSheet] = useState<SheetState>(null)

  const data = useLiveQuery(async () => ({
    entries: await db.weights.orderBy('date').toArray(),
    goal: await getWeightGoal(),
    targetRate: await getTargetRate(),
  }))
  const pts = useMemo(() => (data ? trendPoints(data.entries) : []), [data])

  if (!data) return null
  const { goal, targetRate } = data

  const sheets = (
    <>
      {sheet?.kind === 'log' && (
        <LogSheet entries={data.entries} todayStr={todayStr} editDate={sheet.editDate} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'goal' && <GoalSheet goal={goal} pts={pts} today={today} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'rate' && <TargetRateSheet rate={targetRate} goal={goal} pts={pts} today={today} onClose={() => setSheet(null)} />}
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

      <TrendsCard pts={pts} today={today} goal={goal} />

      <ProjectionsCard
        pts={pts}
        today={today}
        goal={goal}
        targetRate={targetRate}
        onGoal={() => setSheet({ kind: 'goal' })}
        onRate={() => setSheet({ kind: 'rate' })}
      />

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

/** A signed lb amount with its own arrow span (4px gap), e.g. ▼2.8. */
function Delta({ v, tone }: { v: number | null; tone: string }) {
  if (v == null) return <div className="mono weight-num muted">—</div>
  return (
    <div className={`mono weight-num ${tone}`}>
      {v !== 0 && <span className="weight-arrow">{v < 0 ? '▼' : '▲'}</span>}
      {fmtLb(Math.abs(v))}
    </div>
  )
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
  const slope = trendSlope(pts, today)
  const perWeek = slope == null ? null : slope * 7
  const rateTone = toneFor(perWeek, goal, pts)
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
        <div className="weight-head">
          <div className="muted weight-lbl">Current weight</div>
          <div className="muted weight-lbl center">{preset ? `${rangeText} · ${BUCKET_LABEL[kind]}` : rangeText}</div>
          <div className="muted weight-lbl right">lb / week</div>
          <div className="mono weight-big">
            {trendEnd != null ? fmtLb(trendEnd) : '—'}
            {trendEnd != null && <span className="muted unit"> lb</span>}
          </div>
          <div className="center">
            <Delta v={diff} tone={tone} />
          </div>
          <div className="right">
            <Delta v={perWeek} tone={rateTone} />
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

function GoalSheet({ goal, pts, today, onClose }: { goal: WeightGoal | undefined; pts: TrendPoint[]; today: number; onClose: () => void }) {
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

// ---------- trends ----------

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const TREND_TILES: { days: number | 'all'; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 'all', label: 'All time' },
]

/** Digits that spin up from 0 like an odometer once `go` turns true. */
function Odometer({ text, go, delay }: { text: string; go: boolean; delay: number }) {
  return (
    <span className="odo" aria-label={text}>
      {[...text].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="odo-digit" aria-hidden="true">
            <span
              className="odo-strip"
              style={{ transform: `translateY(${go ? -(10 + Number(ch)) * 1.2 : 0}em)`, transitionDelay: `${delay + i * 70}ms` }}
            >
              {'01234567890123456789'.split('').map((d, k) => (
                <span key={k}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} aria-hidden="true">
            {ch}
          </span>
        ),
      )}
    </span>
  )
}

function TrendsCard({ pts, today, goal }: { pts: TrendPoint[]; today: number; goal: WeightGoal | undefined }) {
  const ref = useRef<HTMLElement>(null)
  // The roll plays the first time the card scrolls into view each time the tab opens.
  const [go, setGo] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion() || typeof IntersectionObserver !== 'function') return setGo(true)
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setGo(true)
          io.disconnect()
        }
      },
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section ref={ref} className="card trends-card">
      <h3>Trends</h3>
      <div className="trend-tiles">
        {TREND_TILES.map((t, i) => {
          const v = trendChange(pts, today, t.days)
          const tone = toneFor(v, goal, pts)
          return (
            <div key={t.label}>
              <div className={`trend-tile mono ${tone}`}>{v == null ? '—' : <Odometer text={fmtLb(Math.abs(v))} go={go} delay={i * 110} />}</div>
              <div className="trend-lbl">
                {v != null && <div>{v > 0 ? 'Gained' : 'Lost'}</div>}
                <div>{t.label}</div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---------- projections ----------

const RATE_TABS: { id: RateId; label: string; name: string }[] = [
  { id: 'current', label: 'Current', name: 'current' },
  { id: 'overall', label: 'Overall', name: 'overall' },
  { id: 'target', label: 'Target', name: 'target' },
]

/** Animates toward `value` (count up/down) whenever it changes. */
function useTween(value: number | null, ms = 450) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (value == null || from.current == null || reducedMotion()) {
      from.current = value
      setShown(value)
      return
    }
    const a = from.current
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const v = a + (value - a) * (1 - (1 - k) ** 3)
      from.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

function etaText(e: Eta, today: number) {
  switch (e.kind) {
    case 'date':
      return { date: fmtFuture(today + e.days, today), rel: relDays(e.days) }
    case 'far':
      return { date: 'Over 2 yrs', rel: 'at this pace' }
    case 'reached':
      return { date: 'Reached', rel: '' }
    default:
      return { date: '—', rel: '' }
  }
}

function ForecastRow({ weight, whole, label, date, rel }: { weight: number | null; whole?: boolean; label: string; date: string; rel: string }) {
  const w = useTween(weight)
  return (
    <div className="proj-row">
      <div>
        <div className="mono proj-w">
          {w == null ? '—' : whole ? Math.round(w) : fmtLb(w)}
          <span className="muted unit"> lb</span>
        </div>
        <div className="muted small">{label}</div>
      </div>
      <div className="right">
        <div className="proj-date">{date}</div>
        <div className="muted small">{rel}</div>
      </div>
    </div>
  )
}

function ProjectionsCard({
  pts,
  today,
  goal,
  targetRate,
  onGoal,
  onRate,
}: {
  pts: TrendPoint[]
  today: number
  goal: WeightGoal | undefined
  targetRate: number | undefined
  onGoal: () => void
  onRate: () => void
}) {
  const [sel, setSel] = useState<RateId>('overall')
  const [showAll, setShowAll] = useState(false)
  const all = rates(pts, today, goal, targetRate)
  const slope = all[sel]
  const trend = pts.at(-1)?.trend
  const dir = goal ? goalDir(goal, trend) : 'down'
  const goalW = goal ? Math.round(goal.weight) : null
  const steps = goalW != null && trend != null ? milestones(trend, goalW, dir) : []
  const idx = RATE_TABS.findIndex((t) => t.id === sel)

  const pick = (id: RateId) => {
    if (id === 'target' && (sel === 'target' || targetRate == null)) onRate()
    setSel(id)
  }

  const fc = (days: number) => (slope == null ? null : forecast(pts, slope, days))
  const goalEta = goalW != null ? etaTo(pts, goalW, dir, slope) : null
  const next = steps[0]
  const nextEta = next != null ? etaText(etaTo(pts, next, dir, slope), today) : null
  const prog = goalW != null ? goalProgress(pts, goalW, dir) : null
  const reached = goalEta?.kind === 'reached'

  let line: string
  if (slope != null) line = `At your ${RATE_TABS[idx].name} pace of`
  else if (sel === 'target') line = 'Set a target pace to see where it takes you.'
  else if (pts.length < 2) line = 'Log a few weigh-ins to see a pace.'
  else line = sel === 'overall' ? 'An overall pace needs a week of weigh-ins.' : 'Not enough recent weigh-ins for a current pace.'

  return (
    <section className="card proj-card">
      <h3>Projections</h3>
      <div className="rate-pill" role="group" aria-label="Pace">
        <div className="rate-ind" style={{ transform: `translateX(${idx * 100}%)` }} />
        {RATE_TABS.map((t) => {
          const v = all[t.id]
          const on = t.id === sel
          const tone = on ? (goal ? toneFor(v, goal, pts) : 'text') : ''
          return (
            <button key={t.id} className={on ? 'on' : ''} aria-pressed={on} onClick={() => pick(t.id)}>
              <span className="rate-lbl">
                {t.label}
                {t.id === 'target' && <Icon name="pencil" size={11} width={2.4} />}
              </span>
              <span className={`mono rate-num ${tone}`}>
                {v == null ? (
                  t.id === 'target' ? 'Set' : '—'
                ) : (
                  <>
                    {v !== 0 && <span className="weight-arrow">{v < 0 ? '▼' : '▲'}</span>}
                    {Math.abs(v * 7).toFixed(2)}
                  </>
                )}
              </span>
              <span className="rate-unit">lb / week</span>
            </button>
          )
        })}
      </div>

      <p className="proj-line">
        {line}
        {slope != null && (
          <>
            {' '}
            <span className="mono text">{Math.abs(slope * 7).toFixed(2)}</span> lb / week:
          </>
        )}
      </p>

      {slope != null && trend != null && (
        <>
          <ForecastRow weight={fc(7)} label="7-day forecast" date={fmtFuture(today + 7, today)} rel="in 7 days" />
          <ForecastRow weight={fc(30)} label="30-day forecast" date={fmtFuture(today + 30, today)} rel="in 30 days" />
          {next != null && nextEta && <ForecastRow weight={next} whole label="Next milestone" date={nextEta.date} rel={nextEta.rel} />}
        </>
      )}

      {goalW == null || !prog ? (
        <button className="goal-block goal-set" onClick={onGoal}>
          <Icon name="flag" size={16} />
          <span className="grow">Set a goal</span>
          <Icon name="chevron" size={18} />
        </button>
      ) : (
        <button className="goal-block" onClick={onGoal} aria-label="Edit goal">
          <div className="goal-top">
            <div>
              <div className="goal-kicker">
                <Icon name="flag" size={14} width={2.2} /> Goal
              </div>
              <div className="mono goal-w">
                {goalW}
                <span className="muted unit"> lb</span>
              </div>
            </div>
            <div className="right">
              {(() => {
                const t = goalEta ? etaText(goalEta, today) : { date: '—', rel: '' }
                return (
                  <>
                    <div className={`proj-date ${reached ? 'up' : t.date === '—' || goalEta?.kind === 'far' ? 'muted' : ''}`}>{t.date}</div>
                    <div className="muted small">{t.rel}</div>
                  </>
                )
              })()}
            </div>
          </div>
          <div className="goal-bar">
            <div style={{ width: `${reached ? 100 : prog.pct}%` }} />
          </div>
          <div className="goal-foot muted">
            <span>
              <span className="mono text">{fmtLb(prog.done)}</span> {dir === 'down' ? 'lost' : 'gained'} · {Math.round(reached ? 100 : prog.pct)}%
            </span>
            <span>
              <span className="mono text">{fmtLb(reached ? 0 : prog.toGo)}</span> to go ›
            </span>
          </div>
        </button>
      )}

      {goalW != null && steps.length > 0 && (goalEta?.kind === 'date' || goalEta?.kind === 'far') && (
        <>
          <button className="ms-toggle" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Hide milestones' : 'Show all milestones'}
          </button>
          {showAll && (
            <div className="ms-list">
              {[...steps, goalW].map((w) => {
                const t = etaText(etaTo(pts, w, dir, slope), today)
                return (
                  <div key={w} className="ms-row">
                    <span className="mono">{w}</span>
                    <span>
                      {t.date}
                      {t.rel && <span className="muted"> · {t.rel}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function TargetRateSheet({
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

// ---------- log sheet ----------

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
