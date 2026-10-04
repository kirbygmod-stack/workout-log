import { useLiveQuery } from 'dexie-react-hooks'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { db, type Exercise, type SetEntry, type Workout } from '../db'
import { fmtDate, fmtNum, normName } from '../format'
import { fmtLbs } from '../stats'
import {
  BIG_FIVE,
  RANGES,
  change,
  fmtBestSet,
  fmtDiff,
  fmtPct,
  fmtSpan,
  rangeStart,
  scalePoints,
  sessionPoints,
  smoothPath,
  volumeBetween,
  weekStart,
  weeklyVolume,
  type Point,
  type RangeId,
} from '../progress'

interface Lift {
  key: string
  label: string
  exercise?: Exercise
  points: Point[]
}

export function Progress() {
  const [now] = useState(() => Date.now())
  const [range, setRange] = useState<RangeId>('2M')
  const [selected, setSelected] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const [exercises, workouts, sets] = await Promise.all([db.exercises.toArray(), db.workouts.toArray(), db.sets.toArray()])
    return { exercises, workouts: new Map(workouts.map((w) => [w.id!, w] as [number, Workout])), sets }
  }, [])

  const view = useMemo(() => {
    if (!data) return null
    const { exercises, workouts, sets } = data
    const from = rangeStart(range, now)
    const setsByExercise = new Map<number, SetEntry[]>()
    for (const s of sets) {
      if (s.completedAt < from) continue
      const list = setsByExercise.get(s.exerciseId)
      if (list) list.push(s)
      else setsByExercise.set(s.exerciseId, [s])
    }
    const pointsFor = (ex: Exercise) => sessionPoints(setsByExercise.get(ex.id!) ?? [], workouts)

    const active = exercises.filter((e) => !e.archived)
    const big: Lift[] = BIG_FIVE.map(({ label, names }) => {
      const exercise =
        active.find((e) => e.kind === 'weight' && names.includes(normName(e.name))) ??
        exercises.find((e) => e.kind === 'weight' && names.includes(normName(e.name)))
      return { key: `big:${label}`, label, exercise, points: exercise ? pointsFor(exercise) : [] }
    })

    const kinds = new Map(exercises.map((e) => [e.id!, e.kind]))
    const weeks = weeklyVolume(sets, (id) => kinds.get(id), now)
    const lastWeekSoFar = volumeBetween(sets, (id) => kinds.get(id), weekStart(now) - 7 * 86400000, now - 7 * 86400000)
    return { big, weeks, lastWeekSoFar }
  }, [data, range, now])

  if (!view) return null
  const lift = view.big.find((l) => l.key === selected) ?? view.big.find((l) => l.points.length > 0) ?? view.big[0]

  const pick = (key: string) => {
    setSelected(key)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="progress">
      <div className="date-line">{fmtDate(now)}</div>
      <h1>Progress</h1>

      <ChartCard lift={lift} />

      <div className="range" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r} className={r === range ? 'on' : ''} aria-pressed={r === range} onClick={() => setRange(r)}>
            {r}
          </button>
        ))}
      </div>

      <VolumeCard weeks={view.weeks} lastWeekSoFar={view.lastWeekSoFar} />

      <div className="lift-list">
        {view.big.map((l) => (
          <LiftRow key={l.key} lift={l} on={l.key === lift.key} onPick={() => pick(l.key)} />
        ))}
      </div>

    </div>
  )
}

// ---------- chart card ----------

const CHART_H = 100

function ChartCard({ lift }: { lift: Lift }) {
  const [w, ref] = useWidth<HTMLDivElement>()
  const [scrub, setScrub] = useState<number | null>(null)
  const { points } = lift
  const pts = useMemo(() => scalePoints(points, w, CHART_H, 8, 12), [points, w])
  const c = change(points)
  const enough = points.length >= 2
  const shown = scrub != null && points[scrub] ? points[scrub] : points.at(-1)
  const tone = c && !c.up ? 'down' : 'up'

  const line = enough ? smoothPath(pts) : ''
  const area = enough ? `${line} L${pts.at(-1)!.x},${CHART_H} L${pts[0].x},${CHART_H} Z` : ''
  const mark = scrub != null && pts[scrub] ? pts[scrub] : pts.at(-1)

  const onMove = (e: React.PointerEvent) => {
    if (!enough) return
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    let best = 0
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].x - x) < Math.abs(pts[best].x - x)) best = i
    setScrub(best)
  }

  const labels = enough ? [points[0].t, points[0].t + (points.at(-1)!.t - points[0].t) / 2, points.at(-1)!.t] : []

  return (
    <section className="card chart-card" data-tone={tone}>
      <div className="row between chart-head">
        <div className="grow">
          <h3>{lift.exercise?.name ?? lift.label}</h3>
          <div className="muted small">estimated 1-rep max</div>
        </div>
        <div className="chart-value">
          {shown ? (
            <>
              <div className="mono big-num">
                {fmtLbs(shown.value)}
                <span className="muted unit"> lb</span>
              </div>
              <div className={`mono small ${scrub != null ? 'muted' : tone}`}>
                {scrub != null
                  ? `${fmtBestSet(shown.best)} · ${fmtDate(shown.t, { month: 'short', day: 'numeric' })}`
                  : c
                    ? `${fmtDiff(c)} · ${fmtSpan(points)}`
                    : 'first session'}
              </div>
            </>
          ) : (
            <div className="mono big-num muted">—</div>
          )}
        </div>
      </div>

      <div
        ref={ref}
        className="chart"
        style={{ height: CHART_H }}
        onPointerDown={onMove}
        onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons ? onMove(e) : undefined)}
        onPointerUp={() => setScrub(null)}
        onPointerLeave={() => setScrub(null)}
        onPointerCancel={() => setScrub(null)}
      >
        {enough && w > 0 ? (
          <svg width={w} height={CHART_H} role="img" aria-label={chartLabel(lift)}>
            <defs>
              <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" x2={w} y1={CHART_H / 3} y2={CHART_H / 3} className="grid" />
            <line x1="0" x2={w} y1={(CHART_H * 2) / 3} y2={(CHART_H * 2) / 3} className="grid" />
            <path d={area} fill="url(#chart-fill)" />
            <path d={line} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {scrub != null && mark && <line x1={mark.x} x2={mark.x} y1="0" y2={CHART_H} className="scrub" />}
            {mark && <circle cx={mark.x} cy={mark.y} r="6" fill="var(--surface)" stroke="currentColor" strokeWidth="3" />}
          </svg>
        ) : (
          <div className="chart-empty muted small">
            {points.length === 0
              ? lift.exercise
                ? `No ${lift.exercise.name} sessions in this range.`
                : `${lift.label} isn't in your exercise library.`
              : 'Log one more session to see a trend.'}
          </div>
        )}
      </div>

      <div className="row between mono chart-dates">
        {labels.map((t, i) => (
          <span key={i}>{fmtDate(t, { month: 'short', day: 'numeric' })}</span>
        ))}
      </div>
    </section>
  )
}

function chartLabel(lift: Lift) {
  const p = lift.points
  const f = (v: number) => `${Math.round(v)} pounds`
  return `${lift.exercise?.name ?? lift.label}: ${f(p[0].value)} to ${f(p.at(-1)!.value)} over ${p.length} sessions`
}

// ---------- weekly volume ----------

function VolumeCard({ weeks, lastWeekSoFar }: { weeks: { start: number; volume: number }[]; lastWeekSoFar: number }) {
  const cur = weeks.at(-1)!.volume
  // Same point in the week (e.g. Mon–Sat vs last Mon–Sat), so a week in progress isn't compared to a full one.
  const prev = lastWeekSoFar
  const pct = prev > 0 ? ((cur - prev) / prev) * 100 : null
  const max = Math.max(...weeks.map((w) => w.volume), 1)
  const BW = 10
  const GAP = 4
  const H = 40
  return (
    <section className="card volume-card row between">
      <div>
        <div className="kicker">Weekly volume</div>
        <div className="mono vol-num">
          {fmtLbs(cur)}
          <span className="muted unit"> lb</span>
        </div>
        <div className={`mono small ${pct == null ? 'muted' : pct >= 0 ? 'up' : 'down'}`}>
          {pct == null ? 'this week' : `${pct >= 0 ? '▲' : '▼'} ${fmtNum(Math.abs(Math.round(pct * 10) / 10))}% vs last wk`}
        </div>
      </div>
      <svg
        width={weeks.length * (BW + GAP) - GAP}
        height={H}
        role="img"
        aria-label={`Weekly volume, last ${weeks.length} weeks: ${weeks.map((w) => fmtLbs(w.volume)).join(', ')} pounds`}
      >
        {weeks.map((wk, i) => {
          const h = wk.volume > 0 ? Math.max(3, (wk.volume / max) * (H - 4)) : 2
          return (
            <rect
              key={wk.start}
              x={i * (BW + GAP)}
              y={H - h}
              width={BW}
              height={h}
              rx="2"
              className={i === weeks.length - 1 ? 'bar now' : 'bar'}
            />
          )
        })}
      </svg>
    </section>
  )
}

// ---------- list rows ----------

function LiftRow({ lift, on, onPick }: { lift: Lift; on: boolean; onPick: () => void }) {
  const { points } = lift
  const last = points.at(-1)
  const c = change(points)
  const tone = c && !c.up ? 'down' : 'up'
  return (
    <button className={`lift-row ${on ? 'on' : ''}`} onClick={onPick} aria-pressed={on}>
      <div className="grow">
        <div className="lift-name">{lift.label}</div>
        <div className="mono small muted">{last ? fmtBestSet(last.best) : lift.exercise ? 'no sessions' : 'not in library'}</div>
      </div>
      <Sparkline points={points} tone={tone} />
      <div className="lift-nums">
        <div className="mono lift-val">{last ? fmtLbs(last.value) : '—'}</div>
        <div className={`mono lift-chg ${c ? tone : 'muted'}`}>
          {c ? fmtPct(c.pct) : '—'}
        </div>
      </div>
    </button>
  )
}

function Sparkline({ points, tone }: { points: Point[]; tone: string }) {
  const W = 64
  const H = 22
  if (points.length < 2) return <svg width={W} height={H} aria-hidden="true" />
  const pts = scalePoints(points, W, H, 2, 3)
  return (
    <svg width={W} height={H} aria-hidden="true" className={`spark ${tone}`}>
      <polyline
        points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
