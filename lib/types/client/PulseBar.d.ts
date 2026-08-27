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
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client';
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { NetworkState } from './draw.ts';
/** Full props of the pulse entry: dock owner share + injected connection + locale. */
export type PulseProps = PropsRuntime<'conversation.input.dock'> & InjectFace<PulseInjected> & PropsLocale<'pulse'>;
/** Injected business face: the observable Host-description source for network state. */
export interface PulseInjected {
    connection: HostDescriptionSource;
}
/** Tunable thresholds (client-side; the client fiber receives no patch config today). */
export declare const STUCK_AFTER_MS = 8000;
/** Rate (chars/s) below which a text chip hides. */
export declare const RATE_CHIP_FLOOR = 1;
/** Typing rate (chars/s) at/above which the typing chip shows. */
export declare const TYPING_CHIP_FLOOR = 2;
/** Chips re-render cadence and stuck-check cadence. */
export declare const SUMMARY_INTERVAL_MS = 250;
/** One tick's chip/aria summary. */
export interface PulseSummary {
    readonly outputRate: number;
    readonly thinkingRate: number;
    readonly typingRate: number;
    readonly tools: number;
    readonly pendingKind: PendingInteraction['kind'] | null;
    readonly running: boolean;
    readonly stuck: boolean;
    readonly network: NetworkState;
}
export declare const PulseBar: import("react").MemoExoticComponent<({ session, input, connection, t }: PulseProps) => import("react").JSX.Element>;
