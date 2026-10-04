import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  type WeightGoal,
} from '../../db'
import {
  BUCKET_LABEL,
  MIN_SPAN,
  PRESETS,
  bucketKindFor,
  dotLabel,
  dots as makeDots,
  fmtDay,
  fmtLb,
  matchPreset,
  maxSpan,
  minV0,
  lineStep,
  linePoints,
  monotone,
  presetSpan,
  trendSlope,
  windowChange,
  xTicks,
  yScale,
  type Dot,
  type PresetId,
  type TrendPoint,
} from '../../weight'
import { toneFor } from './shared'

const PLOT_H = 300
const TOP = 22
const BOTTOM = 20
const AXIS_W = 34
const INSET = 6
const TAP_SLOP = 5

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

export function WeightChart({ pts, today, goal }: { pts: TrendPoint[]; today: number; goal: WeightGoal | undefined }) {
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
