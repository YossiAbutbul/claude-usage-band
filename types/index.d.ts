export type Window = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      windows: Window[]
      /** `${kind}@${resetsAt}` keys already toasted past 90%, so each window warns once per reset. */
      warned: string[]
      /** True while the band is folded to its one-line form; the chevron and `/usage-band` flip it. */
      isCollapsed: boolean
      /** Last minute tick, in ms, so the reset countdowns redraw. */
      now: number
      /** The session's running cost in US dollars, as /cost totals it; null before the first priced response. */
      cost: number | null
    }
  }
}
