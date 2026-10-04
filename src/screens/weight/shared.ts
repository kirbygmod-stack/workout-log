import {
  type WeightGoal,
} from '../../db'
import {
  fmtFuture,
  goalDir,
  relDays,
  type Eta,
  type TrendPoint,
} from '../../weight'

/** Text color for a change: mint toward the goal, red away from it, grey at 0 or with no goal. */
export function toneFor(diff: number | null, goal: WeightGoal | undefined, pts: TrendPoint[]) {
  if (diff == null || diff === 0 || !goal) return 'muted'
  const dir = goalDir(goal, pts.at(-1)?.trend)
  return (dir === 'down' ? diff < 0 : diff > 0) ? 'up' : 'down'
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function etaText(e: Eta, today: number) {
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
