import { useEffect, useRef, useState } from 'react'
import {
  type WeightGoal,
} from '../../db'
import {
  fmtLb,
  trendChange,
  type TrendPoint,
} from '../../weight'
import { toneFor, reducedMotion } from './shared'

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

export function TrendsCard({ pts, today, goal }: { pts: TrendPoint[]; today: number; goal: WeightGoal | undefined }) {
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
