/** `pulse` namespace dictionaries. */
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    'network.connected': string;
    'network.connecting': string;
    'network.reconnecting': string;
    'chip.output': string;
    'chip.thinking': string;
    'chip.tools': string;
    'chip.typing': string;
    'chip.pendingApproval': string;
    'chip.pendingOther': string;
    'chip.stuck': string;
    'size.drag': string;
    'aria.idle': string;
    'aria.running': string;
    'aria.stuck': string;
};
/** The pulse namespace key union. */
export type PulseKey = keyof typeof zh;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The session activity pulse bar's copy. */
        pulse: PulseKey;
    }
}
/** English dictionary, checked complete against the zh key set. */
export declare const en: {
    'network.connected': string;
    'network.connecting': string;
    'network.reconnecting': string;
    'chip.output': string;
    'chip.thinking': string;
    'chip.tools': string;
    'chip.typing': string;
    'chip.pendingApproval': string;
    'chip.pendingOther': string;
    'chip.stuck': string;
    'size.drag': string;
    'aria.idle': string;
    'aria.running': string;
    'aria.stuck': string;
};
