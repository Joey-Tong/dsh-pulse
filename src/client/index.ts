/**
 * dsh-pulse browser half: the session activity status bar. One
 * `conversation.input.dock` entry per session renders the equalizer strip
 * above the composer card; all live state is fed from the dock's owner share
 * (session snapshot + input machine state), so the plugin owns no session
 * controllers and every listener/loop lives inside the mounted component.
 * @module dsh-pulse/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { PulseBar } from './PulseBar.tsx'
import type { PulseInjected } from './PulseBar.tsx'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'pulse'

/** Required services: the slot registry, the wire handle, and the copy. */
export const inject = ['slots', 'connection', 'locale']

/**
 * Client plugin body: the pulse dock entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-pulse: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle

  ctx.slots.inject('conversation.input.dock', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'pulse',
      // Dock-stack top (negative order, sorted first): the pulse bar is an
      // ambient status readout, so it leads the row above the functional
      // strips (todo order 0 → goal order 10 → queue order 20) instead of
      // splitting them apart.
      order: -10,
      locale: NS,
      inject: (): PulseInjected => ({
        // Stable service object; the component subscribes on mount.
        connection: connection.hostDescription,
      }),
    }, PulseBar)
    return dispose
  })
}
