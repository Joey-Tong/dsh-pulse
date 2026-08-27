/**
 * dsh-pulse browser half: the session activity status bar. One
 * `conversation.input.dock` entry per session renders the equalizer strip
 * above the composer card; all live state is fed from the dock's owner share
 * (session snapshot + input machine state), so the plugin owns no session
 * controllers and every listener/loop lives inside the mounted component.
 * @module dsh-pulse/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: the slot registry, the wire handle, and the copy. */
export declare const inject: string[];
/**
 * Client plugin body: the pulse dock entry.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
