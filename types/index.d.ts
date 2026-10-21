// The plugin's $.state contract: what the activity pane draws from.

export type ActivityKind = 'prompt' | 'saved' | 'blocked' | 'local' | 'claude' | 'turn' | 'setup' | 'info' | 'error'

export type ActivityEntry = { at: number; kind: ActivityKind; text: string }

declare module 'claude-code' {
  interface PluginState {
    'quota-saver': { activity: ActivityEntry[] }
  }
}
