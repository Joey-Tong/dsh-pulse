/** `pulse` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'network.connected': '网络正常',
  'network.connecting': '连接中',
  'network.reconnecting': '网络重连中',
  'chip.output': '输出 {rate} 字符/秒',
  'chip.thinking': '思考 {rate} 字符/秒',
  'chip.tools': '工具 ×{count}',
  'chip.typing': '输入 {rate} 字符/秒',
  'chip.pendingApproval': '等待确认',
  'chip.pendingOther': '等待回应',
  'chip.stuck': '响应停滞',
  'size.drag': '拖动调节大小',
  'aria.idle': '会话空闲，{network}',
  'aria.running': '会话运行中，{network}',
  'aria.stuck': '会话响应停滞，{network}',
} satisfies Record<string, string>

/** The pulse namespace key union. */
export type PulseKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The session activity pulse bar's copy. */
    pulse: PulseKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'network.connected': 'Network OK',
  'network.connecting': 'Connecting',
  'network.reconnecting': 'Reconnecting',
  'chip.output': 'Output {rate} chars/s',
  'chip.thinking': 'Thinking {rate} chars/s',
  'chip.tools': 'Tools ×{count}',
  'chip.typing': 'Typing {rate} chars/s',
  'chip.pendingApproval': 'Awaiting approval',
  'chip.pendingOther': 'Awaiting input',
  'chip.stuck': 'Response stalled',
  'size.drag': 'Drag to resize',
  'aria.idle': 'Session idle, {network}',
  'aria.running': 'Session running, {network}',
  'aria.stuck': 'Session response stalled, {network}',
} satisfies Record<PulseKey, string>
