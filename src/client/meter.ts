/**
 * Browser-local activity meter for one session's pulse bar. Pure and
 * clock-injected (callers pass `performance.now()` readings), so the
 * bump/decay/EMA behavior is unit-testable without DOM or timers.
 *
 * Channels:
 * - `output` — assistant text characters streamed in this session;
 * - `thinking` — assistant reasoning characters streamed in this session;
 * - `tools` — tool calls starting or settling;
 * - `typing` — draft characters the user typed.
 *
 * Each channel keeps a decaying `level` (0..1, the equalizer energy) and the
 * text channels additionally keep a smoothed characters-per-second `rate`.
 * @module dsh-pulse/client/meter
 */

/** The four equalizer channels. */
export type PulseChannel = 'output' | 'thinking' | 'tools' | 'typing'

/** Channels carrying a characters-per-second reading. */
export type TextChannel = 'output' | 'thinking' | 'typing'

/**
 * How many characters of one burst move a channel's level from 0 to full.
 * Typing deliberately uses a much smaller constant than the stream channels:
 * keystrokes arrive one character at a time (a 8 chars/s typing rate would
 * otherwise sustain only ~0.1 level against the shared 28-char constant),
 * so the input channel gets its own burst tuning to stay visibly alive.
 */
export const BURST_CHARS: Record<TextChannel, number> = {
  output: 28,
  thinking: 28,
  typing: 4,
}

/** Per-second exponential decay applied to every bumped level. */
export const LEVEL_DECAY_PER_SECOND = 2.6

/** EMA smoothing factor applied to a rate reading on each observation. */
export const RATE_ALPHA = 0.4

/** A level below this is indistinguishable from idle and snaps to zero. */
export const LEVEL_FLOOR = 0.01

const CHANNELS: readonly PulseChannel[] = ['output', 'thinking', 'tools', 'typing']

const NEVER = -1

/** One channel's current reading. */
export interface ChannelReading {
  /** 0..1 energy after decay, used to drive the equalizer bars. */
  level: number
  /** Smoothed characters per second; 0 for the `tools` channel. */
  charsPerSecond: number
}

/** Snapshot of the whole meter. */
export interface MeterReading {
  channels: Record<PulseChannel, ChannelReading>
  /** Milliseconds since the last observed activity; Infinity before any. */
  idleFor: number
}

/** Build a zeroed reading used before any feed. */
export function emptyReading(): MeterReading {
  return {
    channels: {
      output: { level: 0, charsPerSecond: 0 },
      thinking: { level: 0, charsPerSecond: 0 },
      tools: { level: 0, charsPerSecond: 0 },
      typing: { level: 0, charsPerSecond: 0 },
    },
    idleFor: Infinity,
  }
}

/**
 * One session's activity meter. Feed deltas from snapshot observations;
 * call {@link sample} once per animation frame with the frame time.
 */
export class ActivityMeter {
  private readonly levels: Record<PulseChannel, number> = {
    output: 0, thinking: 0, tools: 0, typing: 0,
  }
  private readonly rates: Record<TextChannel, number> = {
    output: 0, thinking: 0, typing: 0,
  }
  private lastActivityAt = NEVER
  private lastSampleAt = NEVER

  /**
   * Feed a character delta for one text channel.
   * @param channel - the text channel the characters belong to.
   * @param deltaChars - characters gained since the last observation (≤0 ignored).
   * @param now - current `performance.now()` reading in ms.
   */
  feedChars(channel: TextChannel, deltaChars: number, now: number): void {
    if (deltaChars <= 0) return
    const dtMs = this.lastSampleAt === NEVER ? 1_000 : Math.max(1, now - this.lastSampleAt)
    const instant = (deltaChars / dtMs) * 1_000
    const rate = this.rates[channel]
    this.rates[channel] = rate + RATE_ALPHA * (instant - rate)
    this.bump(channel, deltaChars / BURST_CHARS[channel], now)
  }

  /**
   * Feed one tool-call transition (a call started or settled).
   * @param now - current `performance.now()` reading in ms.
   */
  feedTools(now: number): void {
    this.bump('tools', 0.55, now)
  }

  /**
   * Record activity without moving any channel (e.g. a pending interaction
   * appeared) so the stuck detector stays satisfied.
   * @param now - current `performance.now()` reading in ms.
   */
  noteActivity(now: number): void {
    if (this.lastActivityAt === NEVER || now > this.lastActivityAt) {
      this.lastActivityAt = now
    }
  }

  /**
   * Decay every level by the elapsed time and stamp the sample clock used as
   * the next rate denominator. Call once per animation frame.
   * @param dtSeconds - elapsed seconds since the previous frame.
   * @param now - current `performance.now()` reading in ms.
   */
  sample(dtSeconds: number, now: number): void {
    this.lastSampleAt = now
    if (dtSeconds <= 0) return
    const decay = Math.exp(-LEVEL_DECAY_PER_SECOND * dtSeconds)
    for (const channel of CHANNELS) {
      const next = this.levels[channel] * decay
      this.levels[channel] = next < LEVEL_FLOOR ? 0 : next
    }
  }

  /** Snapshot the current readings. */
  reading(now: number): MeterReading {
    const channels = {} as Record<PulseChannel, ChannelReading>
    for (const channel of CHANNELS) {
      channels[channel] = {
        level: this.levels[channel],
        charsPerSecond: channel === 'tools' ? 0 : this.rates[channel],
      }
    }
    return { channels, idleFor: this.idleFor(now) }
  }

  /** Bump one channel's level and mark activity. */
  private bump(channel: PulseChannel, amount: number, now: number): void {
    const next = this.levels[channel] + Math.max(0, amount)
    this.levels[channel] = next >= 1 ? 1 : next
    this.lastActivityAt = now
  }

  /** Milliseconds since the last observed activity; Infinity before any. */
  private idleFor(now: number): number {
    return this.lastActivityAt === NEVER ? Infinity : Math.max(0, now - this.lastActivityAt)
  }
}
