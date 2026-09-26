let audioCtx: AudioContext | null = null

/** iOS only allows sound after a user tap; call this from a tap handler. */
export function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {
    /* no audio available */
  }
}

export function beep() {
  if (!audioCtx) return
  const t = audioCtx.currentTime
  for (const offset of [0, 0.25, 0.5]) {
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.frequency.value = 880
    g.gain.setValueAtTime(0.0001, t + offset)
    g.gain.exponentialRampToValueAtTime(0.3, t + offset + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18)
    o.connect(g).connect(audioCtx.destination)
    o.start(t + offset)
    o.stop(t + offset + 0.2)
  }
}

