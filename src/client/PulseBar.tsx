/**
 * The pulse status bar: one `conversation.input.dock` entry rendering an
 * audio-visualizer-style equalizer that pulses with the current session's
 * activity (output/thinking/tool/typing channels) plus a compact chip row for
 * network state, speeds, pending interactions, and stuck detection.
 *
 * The canvas loop runs on a requestAnimationFrame owned by the component's
 * mount effect; snapshot/input deltas are fed to the meter from effects
 * keyed on the owner-provided `session`/`input` props (the dock dispatcher
 * re-renders entries on either store's change). All listeners, the rAF loop,
 * and the ResizeObserver dispose with the component.
 * @module dsh-pulse/client
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ConversationSnapshot, PendingInteraction,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { PulseKey } from './locales.ts'
import { ActivityMeter } from './meter.ts'
import { drawPulse, driftPeaks, freshPeaks } from './draw.ts'
import type { CanvasSize, DrawState, NetworkState, Peaks } from './draw.ts'
import css from './PulseBar.module.css'

/** Full props of the pulse entry: dock owner share + injected connection + locale. */
export type PulseProps =
  PropsRuntime<'conversation.input.dock'>
  & InjectFace<PulseInjected>
  & PropsLocale<'pulse'>

/** Injected business face: the observable Host-description source for network state. */
export interface PulseInjected {
  connection: HostDescriptionSource
}

/** Tunable thresholds (client-side; the client fiber receives no patch config today). */
export const STUCK_AFTER_MS = 8_000
/** Rate (chars/s) below which a text chip hides. */
export const RATE_CHIP_FLOOR = 1
/** Typing rate (chars/s) at/above which the typing chip shows. */
export const TYPING_CHIP_FLOOR = 2

/** Chips re-render cadence and stuck-check cadence. */
export const SUMMARY_INTERVAL_MS = 250

/** Vertical size factor: users may shrink or grow the whole strip. Bounded so
 *  the bar stays usable (and the chips never overwhelm the composer). */
export const SCALE_MIN = 0.6
export const SCALE_MAX = 1.6
/** Scale change per pointer-pixel of vertical drag. */
export const SCALE_PER_PX = 0.008

/** localStorage key for the per-user size preference. */
const SCALE_STORAGE_KEY = 'dsh-pulse:scale'

/** Clamp a raw scale into the supported range. */
function clampScale(value: number): number {
  if (value < SCALE_MIN) return SCALE_MIN
  if (value > SCALE_MAX) return SCALE_MAX
  return value
}

/** Load the persisted size preference (default 1). */
function loadScale(): number {
  if (typeof localStorage === 'undefined') return 1
  const raw = Number(localStorage.getItem(SCALE_STORAGE_KEY))
  return Number.isFinite(raw) && raw > 0 ? clampScale(raw) : 1
}

/** One tick's chip/aria summary. */
export interface PulseSummary {
  readonly outputRate: number
  readonly thinkingRate: number
  readonly typingRate: number
  readonly tools: number
  readonly pendingKind: PendingInteraction['kind'] | null
  readonly running: boolean
  readonly stuck: boolean
  readonly network: NetworkState
}

const EMPTY_SUMMARY: PulseSummary = {
  outputRate: 0,
  thinkingRate: 0,
  typingRate: 0,
  tools: 0,
  pendingKind: null,
  running: false,
  stuck: false,
  network: 'connecting',
}

/** Sum the streamed text/reasoning characters of the in-progress partial. */
function partialLengths(session: ConversationSnapshot): { text: number; reasoning: number } {
  const partial = session.partial
  if (partial === null) return { text: 0, reasoning: 0 }
  let text = 0
  let reasoning = 0
  for (const block of partial.blocks) {
    if (block.kind === 'text') text += block.text.length
    else if (block.kind === 'reasoning') reasoning += block.text.length
  }
  return { text, reasoning }
}

/** First pending kind, or null. */
function firstPendingKind(pending: readonly PendingInteraction[]): PendingInteraction['kind'] | null {
  return pending.length === 0 ? null : pending[0].kind
}

export const PulseBar = memo(function PulseBar({ session, input, connection, t }: PulseProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const meterRef = useRef<ActivityMeter | null>(null)
  if (meterRef.current === null) meterRef.current = new ActivityMeter()

  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0, dpr: 1 })
  const peaksRef = useRef<Peaks>(freshPeaks())
  const hueRef = useRef<number>(214)
  const lastLensRef = useRef({ text: 0, reasoning: 0 })
  const lastInputLenRef = useRef(input.draft.length)
  const lastCallsRef = useRef(session.runningCalls.length)
  const lastPendingRef = useRef(session.pending.length)
  const runningRef = useRef(session.running)
  const pendingRef = useRef(session.pending)
  const toolsRef = useRef(session.runningCalls.length)
  const stuckRef = useRef(false)
  const networkRef = useRef<NetworkState>('connecting')
  const reducedRef = useRef(false)
  const darkRef = useRef(false)

  const [network, setNetwork] = useState<NetworkState>('connecting')
  const [summary, setSummary] = useState<PulseSummary>(EMPTY_SUMMARY)
  const [scale, setScale] = useState<number>(loadScale)
  const dragRef = useRef<{ y: number; scale: number } | null>(null)

  // Persist the per-user size preference on every change (drag or keyboard).
  useEffect(() => {
    try { localStorage.setItem('dsh-pulse:scale', String(scale)) } catch { /* ignore */ }
  }, [scale])

  // Feed the meter from snapshot deltas. The dock dispatcher re-renders this
  // entry on every session-store publish (partial chunks land at animation
  // frame cadence), so each run is one observation.
  useEffect(() => {
    const meter = meterRef.current
    if (meter === null) return
    const now = performance.now()
    const lens = partialLengths(session)
    const last = lastLensRef.current
    meter.feedChars('output', lens.text - last.text, now)
    meter.feedChars('thinking', lens.reasoning - last.reasoning, now)
    lastLensRef.current = lens
    const calls = session.runningCalls.length
    if (calls !== lastCallsRef.current) {
      meter.feedTools(now)
      lastCallsRef.current = calls
    }
    const pending = session.pending.length
    if (pending !== lastPendingRef.current) {
      meter.noteActivity(now)
      lastPendingRef.current = pending
    }
    runningRef.current = session.running
    pendingRef.current = session.pending
    toolsRef.current = session.runningCalls.length
  }, [session])

  // Feed the typing channel from draft-length deltas between input publishes.
  useEffect(() => {
    const meter = meterRef.current
    if (meter === null) return
    const len = input.draft.length
    meter.feedChars('typing', len - lastInputLenRef.current, performance.now())
    lastInputLenRef.current = len
  }, [input])

  // Network state through the injected Host-description source.
  useEffect(() => {
    let hadConnection = connection.getSnapshot() !== undefined
    const update = (): void => {
      const connected = connection.getSnapshot() !== undefined
      const next: NetworkState = connected ? 'connected' : hadConnection ? 'reconnecting' : 'connecting'
      hadConnection = connected
      networkRef.current = next
      setNetwork(prev => (prev === next ? prev : next))
    }
    update()
    return connection.subscribe(update)
  }, [connection])

  // The animation loop, stuck check, canvas sizing, and theme tracking —
  // everything owned by mount and disposed on unmount.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (wrap === null || canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    const size = sizeRef.current
    const fit = (): void => {
      const dpr = window.devicePixelRatio || 1
      const width = Math.max(0, canvas.clientWidth)
      const height = Math.max(0, canvas.clientHeight)
      const nextW = Math.round(width * dpr)
      const nextH = Math.round(height * dpr)
      if (canvas.width !== nextW) canvas.width = nextW
      if (canvas.height !== nextH) canvas.height = nextH
      size.width = width
      size.height = height
      size.dpr = dpr
      // Every width/height assignment resets the context transform; drawing
      // coordinates stay in CSS pixels while the backing store is dpr-scaled,
      // otherwise the bars would only cover the left fraction on HiDPI.
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const applyReduced = (): void => { reducedRef.current = media.matches }
    applyReduced()
    media.addEventListener('change', applyReduced)

    const applyDark = (): void => {
      darkRef.current = document.body.hasAttribute('data-ds-dark-theme')
    }
    applyDark()
    const themeObserver = new MutationObserver(applyDark)
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })

    let raf = 0
    let last = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
      last = now
      const meter = meterRef.current
      if (meter !== null) {
        meter.sample(dt, now)
        const reading = meter.reading(now)
        driftPeaks(peaksRef.current, now, dt)
        const state: DrawState = {
          running: runningRef.current,
          stuck: stuckRef.current,
          pendingCount: pendingRef.current.length,
          network: networkRef.current,
          darkTheme: darkRef.current,
          reducedMotion: reducedRef.current,
        }
        drawPulse(context, sizeRef.current, reading, peaksRef.current, state, now, hueRef)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const observer = new ResizeObserver(fit)
    observer.observe(wrap)

    const tick = (): void => {
      const meter = meterRef.current
      if (meter === null) return
      const now = performance.now()
      const reading = meter.reading(now)
      const running = runningRef.current
      const pending = pendingRef.current
      const tools = toolsRef.current
      const stuck = running && pending.length === 0 && tools === 0 && reading.idleFor > STUCK_AFTER_MS
      stuckRef.current = stuck
      const out = reading.channels.output
      const think = reading.channels.thinking
      const type = reading.channels.typing
      setSummary({
        // Chips gate on the decayed level too: a rate is only meaningful
        // while the channel is actually feeding (levels die ~2s after the
        // last observation), so a stale reading never lingers on screen.
        outputRate: out.level > 0 ? out.charsPerSecond : 0,
        thinkingRate: think.level > 0 ? think.charsPerSecond : 0,
        typingRate: type.level > 0 ? type.charsPerSecond : 0,
        tools,
        pendingKind: firstPendingKind(pending),
        running,
        stuck,
        network: networkRef.current,
      })
    }
    tick()
    const interval = window.setInterval(tick, SUMMARY_INTERVAL_MS)

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(interval)
      observer.disconnect()
      themeObserver.disconnect()
      media.removeEventListener('change', applyReduced)
    }
  }, [])

  const { outputRate, thinkingRate, typingRate, tools, pendingKind, running, stuck } = summary
  const pendingLabel: PulseKey | null = pendingKind === null ? null
    : pendingKind === 'approval' ? 'chip.pendingApproval' : 'chip.pendingOther'
  const networkKey: PulseKey = network === 'connected' ? 'network.connected'
    : network === 'reconnecting' ? 'network.reconnecting' : 'network.connecting'
  const ariaKey: PulseKey = stuck ? 'aria.stuck' : running ? 'aria.running' : 'aria.idle'
  const ariaLabel = useMemo(
    () => t(ariaKey, { network: t(networkKey) }),
    [t, ariaKey, networkKey],
  )

  // The activity chips (agent I/O, typing, pending, stuck). While any of them
  // is visible the "network OK" chip adds noise, so it yields the strip —
  // warnings (connecting/reconnecting) always stay.
  const showOutput = running && outputRate >= RATE_CHIP_FLOOR
  const showThinking = running && thinkingRate >= RATE_CHIP_FLOOR
  const showTools = running && tools > 0
  const showPending = pendingLabel !== null
  const showStuck = stuck
  const showTyping = typingRate >= TYPING_CHIP_FLOOR
  const showNetwork = network !== 'connected'
    || !(showOutput || showThinking || showTools || showPending || showStuck || showTyping)

  return (
    <div
      ref={wrapRef}
      className={css.wrap}
      role="group"
      aria-label={ariaLabel}
      data-dsh-pulse
      style={{ '--pulse-scale': String(scale) } as CSSProperties}
    >
      <canvas ref={canvasRef} className={css.canvas} aria-hidden="true" />
      <div className={css.chips}>
        {showNetwork && (
          <span className={css.chip} title={t(networkKey)}>
            <span className={`${css.dot} ${network === 'connected' ? css.dotNetwork : network === 'reconnecting' ? css.dotNetworkBad : css.dotNetworkWarn}`} />
            {t(networkKey)}
          </span>
        )}
        {showOutput && (
          <span className={`${css.chip} ${css.chipHideNarrow}`}>
            <span className={`${css.dot} ${css.dotOutput}`} />
            {t('chip.output', { rate: Math.round(outputRate) })}
          </span>
        )}
        {showThinking && (
          <span className={`${css.chip} ${css.chipHideNarrow}`}>
            <span className={`${css.dot} ${css.dotThinking}`} />
            {t('chip.thinking', { rate: Math.round(thinkingRate) })}
          </span>
        )}
        {showTools && (
          <span className={`${css.chip} ${css.chipHideNarrow}`}>
            <span className={`${css.dot} ${css.dotTools}`} />
            {t('chip.tools', { count: tools })}
          </span>
        )}
        {showPending && (
          <span className={css.chip}>
            <span className={`${css.dot} ${css.dotTools}`} />
            {t(pendingLabel)}
          </span>
        )}
        {showStuck && (
          <span className={`${css.chip} ${css.chipStuck}`}>
            <span className={`${css.dot} ${css.dotStuck}`} />
            {t('chip.stuck')}
          </span>
        )}
        {showTyping && (
          <span className={css.chip}>
            <span className={`${css.dot} ${css.dotTyping}`} />
            {t('chip.typing', { rate: Math.round(typingRate) })}
          </span>
        )}
      </div>
      {/* Corner resize: an absolute, hover-revealed drag zone at the top-right
          — no layout footprint; drag up/down (or arrow keys) to scale. */}
      <div
        className={css.resize}
        role="slider"
        aria-label={t('size.drag')}
        aria-valuemin={SCALE_MIN * 100}
        aria-valuemax={SCALE_MAX * 100}
        aria-valuenow={Math.round(scale * 100)}
        tabIndex={0}
        title={t('size.drag')}
        onPointerDown={(e) => {
          dragRef.current = { y: e.clientY, scale }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = dragRef.current
          if (d === null) return
          // Dragging up (negative dy) grows the strip, like pulling a
          // top-right corner handle upward.
          setScale(clampScale(d.scale - (e.clientY - d.y) * SCALE_PER_PX))
        }}
        onPointerUp={() => { dragRef.current = null }}
        onPointerCancel={() => { dragRef.current = null }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setScale(s => clampScale(s + 0.05)) }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setScale(s => clampScale(s - 0.05)) }
        }}
      >
        <span className={css.handleDot} />
        <span className={css.handleDot} />
        <span className={css.handleDot} />
      </div>
    </div>
  )
})
