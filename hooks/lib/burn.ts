// Burn rate, after ccusage: from how fast a quota window has filled so far,
// when it would reach 100% at this pace.

export type Sample = { at: number; pct: number }

/** Minutes until 100% at the pace of the samples, or undefined while there is no clear pace yet. */
export function minutesToFull(samples: readonly Sample[]): number | undefined {
  if (samples.length < 2) return undefined
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last) return undefined
  const minutes = (last.at - first.at) / 60_000
  const rise = last.pct - first.pct
  if (minutes < 2 || rise <= 0) return undefined
  return Math.max(0, Math.round(((100 - last.pct) / rise) * minutes))
}

export function humanMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}
