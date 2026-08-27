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
export type PulseChannel = 'output' | 'thinking' | 'tools' | 'typing';
/** Channels carrying a characters-per-second reading. */
export type TextChannel = 'output' | 'thinking' | 'typing';
/**
 * How many characters of one burst move a channel's level from 0 to full.
 * Typing deliberately uses a much smaller constant than the stream channels:
 * keystrokes arrive one character at a time (a 8 chars/s typing rate would
 * otherwise sustain only ~0.1 level against the shared 28-char constant),
 * so the input channel gets its own burst tuning to stay visibly alive.
 */
export declare const BURST_CHARS: Record<TextChannel, number>;
/** Per-second exponential decay applied to every bumped level. */
export declare const LEVEL_DECAY_PER_SECOND = 2.6;
/** EMA smoothing factor applied to a rate reading on each observation. */
export declare const RATE_ALPHA = 0.4;
/** A level below this is indistinguishable from idle and snaps to zero. */
export declare const LEVEL_FLOOR = 0.01;
/** One channel's current reading. */
export interface ChannelReading {
    /** 0..1 energy after decay, used to drive the equalizer bars. */
    level: number;
    /** Smoothed characters per second; 0 for the `tools` channel. */
    charsPerSecond: number;
}
/** Snapshot of the whole meter. */
export interface MeterReading {
    channels: Record<PulseChannel, ChannelReading>;
    /** Milliseconds since the last observed activity; Infinity before any. */
    idleFor: number;
}
/** Build a zeroed reading used before any feed. */
export declare function emptyReading(): MeterReading;
/**
 * One session's activity meter. Feed deltas from snapshot observations;
 * call {@link sample} once per animation frame with the frame time.
 */
export declare class ActivityMeter {
    private readonly levels;
    private readonly rates;
    private lastActivityAt;
    private lastSampleAt;
    /**
     * Feed a character delta for one text channel.
     * @param channel - the text channel the characters belong to.
     * @param deltaChars - characters gained since the last observation (≤0 ignored).
     * @param now - current `performance.now()` reading in ms.
     */
    feedChars(channel: TextChannel, deltaChars: number, now: number): void;
    /**
     * Feed one tool-call transition (a call started or settled).
     * @param now - current `performance.now()` reading in ms.
     */
    feedTools(now: number): void;
    /**
     * Record activity without moving any channel (e.g. a pending interaction
     * appeared) so the stuck detector stays satisfied.
     * @param now - current `performance.now()` reading in ms.
     */
    noteActivity(now: number): void;
    /**
     * Decay every level by the elapsed time and stamp the sample clock used as
     * the next rate denominator. Call once per animation frame.
     * @param dtSeconds - elapsed seconds since the previous frame.
     * @param now - current `performance.now()` reading in ms.
     */
    sample(dtSeconds: number, now: number): void;
    /** Snapshot the current readings. */
    reading(now: number): MeterReading;
    /** Bump one channel's level and mark activity. */
    private bump;
    /** Milliseconds since the last observed activity; Infinity before any. */
    private idleFor;
}
