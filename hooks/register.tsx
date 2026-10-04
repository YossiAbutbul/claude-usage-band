import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Window } from '../types'

const windows = atom({ plugin: 'usage-band', key: 'windows' } as const, [])
const warned = atom({ plugin: 'usage-band', key: 'warned' } as const, [])
const isCollapsed = atom({ plugin: 'usage-band', key: 'isCollapsed' } as const, false)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)

const COMMAND = 'usage-band'
const SHOWN = [
  { kind: 'five_hour', label: '5-hour', short: '5h' },
  { kind: 'seven_day', label: 'Weekly', short: '7d' },
]
const LABEL_WIDTH = 7
const BAR_CELLS = 24
const MINI_CELLS = 12
const COLLAPSED_KEY = 'isCollapsed'
const WARN_AT = 90
const MINUTE = 60_000
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Left-aligned eighth blocks: a bar fills in 1/8-cell steps instead of whole cells.
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

const level = (pct: number) =>
  pct > 80
    ? { color: '#f85149', badge: '▲ high' }
    : pct >= 50
      ? { color: '#d29922', badge: '◆ moderate' }
      : { color: '#3fb950', badge: '● healthy' }

// Desktop draws real pixels: a rounded pill on a translucent track reads well on light and dark.
const PILL_TRACK = 'rgba(128,128,128,0.28)'
const CHEVRON_SIZE = 12
const chevron = (dir: 'up' | 'down') => {
  const points = dir === 'up' ? '3,7.5 6,4.5 9,7.5' : '3,4.5 6,7.5 9,4.5'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">` +
    `<polyline points="${points}" fill="none" stroke="#8e8d89" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  )
}
const pill = (pct: number, color: string, width: number, height: number) => {
  const r = height / 2
  const fill = pct <= 0 ? 0 : Math.max(height, Math.round((Math.min(100, pct) / 100) * width))

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="${PILL_TRACK}"/>` +
    (fill > 0 ? `<rect width="${fill}" height="${height}" rx="${r}" fill="${color}"/>` : '') +
    `</svg>`
  )
}

const meter = (pct: number, cells: number) => {
  const eighths = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells * 8)
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8]
  const filled = '█'.repeat(full) + part
  const track = '─'.repeat(cells - full - (part ? 1 : 0))

  return { filled, track }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

const countdown = (ms: number, compact = false) => {
  if (ms <= 0) return 'now'
  const mins = Math.ceil(ms / MINUTE)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  const sep = compact ? '' : ' '
  if (d > 0) return `${d}d${sep}${h}h`
  if (h > 0) return `${h}h${sep}${pad2(m)}m`

  return `${m}m`
}

// 5-hour window resets within the day: the clock is enough. Weekly: weekday + clock.
const resetParts = (kind: string, at: number, resetsAt?: string) => {
  if (!resetsAt) return null
  const d = new Date(resetsAt)
  if (isNaN(d.getTime())) return null
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const ms = d.getTime() - at

  return {
    left: countdown(ms),
    leftCompact: countdown(ms, true),
    when: kind === 'five_hour' ? clock : `${DAYS[d.getDay()]} ${clock}`,
  }
}

const store = async ($: Engine, rateLimits: Window[]) => {
  const latest = rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
  await update($, windows, () => latest)

  const seen = await read($, warned)
  const fresh = latest.filter(
    w => SHOWN.some(s => s.kind === w.kind) && w.percentUsed >= WARN_AT && !seen.includes(`${w.kind}@${w.resetsAt ?? ''}`),
  )
  if (fresh.length === 0) return

  const at = await $.clock.now()
  for (const w of fresh) {
    const label = SHOWN.find(s => s.kind === w.kind)?.label ?? w.kind
    const reset = resetParts(w.kind, at, w.resetsAt)
    $.ui.toast(`⚠ ${label} usage at ${Math.round(w.percentUsed)}%${reset ? ` · resets in ${reset.left}` : ''}`)
  }
  await update($, warned, prev => [...prev, ...fresh.map(w => `${w.kind}@${w.resetsAt ?? ''}`)].slice(-20))
}

// Session state drives the redraw; $.store carries the choice into the next session.
const setCollapsed = async ($: Engine, value: boolean) => {
  await update($, isCollapsed, () => value)
  await $.store.set(COLLAPSED_KEY, value)
}

// Thin line meter for the collapsed row: heavy rule for the fill, a half-cell
// cap for odd halves, light rule for the track. One text row, no block glyphs.
const thinMeter = (pct: number, cells: number) => {
  const halves = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells * 2)
  const full = Math.floor(halves / 2)
  const cap = halves % 2 ? '╸' : ''
  const filled = '━'.repeat(full) + cap
  const track = '─'.repeat(cells - full - (cap ? 1 : 0))

  return { filled, track }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await $.command.register({ name: COMMAND, description: 'Collapse or expand the plan usage band' })

    const saved = await $.store.get(COLLAPSED_KEY)
    if (typeof saved === 'boolean') await update($, isCollapsed, () => saved)

    const usage = await $.session.usage()
    if (usage.rateLimits.length > 0) await store($, usage.rateLimits)

    const at = await $.clock.now()
    await update($, now, () => at)
    $.clock.every(MINUTE, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })

    return result
  })

  on('command.run', { command: COMMAND }, async $ => {
    const wasCollapsed = await read($, isCollapsed)
    await setCollapsed($, !wasCollapsed)

    return { text: wasCollapsed ? 'Usage band expanded.' : 'Usage band collapsed.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await store($, e.rateLimits)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const all = await read($, windows)
    const collapsed = await read($, isCollapsed)
    const at = (await read($, now)) || (await $.clock.now())
    const rows = SHOWN.map(s => ({ ...s, w: all.find(w => w.kind === s.kind) }))
    const peak = Math.max(0, ...rows.map(r => r.w?.percentUsed ?? 0))
    const status = all.length === 0 ? null : level(peak)
    const toggle = () => setCollapsed($, !collapsed)

    // Desktop: SVG pills instead of box-drawing glyphs, which gap in a proportional font.
    if (e.surface === 'desktop') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const pillW = collapsed ? 84 : 220
      const pillH = collapsed ? 5 : 8

      // A dim word with a drawn chevron after it: only a text Button takes presses, so the word is the target.
      const toggleControl = (
        <Box key="toggle-wrap" flexDirection="row" alignItems="center" gap={1}>
          <Button key="toggle" label={collapsed ? 'expand' : 'collapse'} plain dimColor onPress={toggle} />
          <Svg
            source={chevron(collapsed ? 'up' : 'down')}
            alt={collapsed ? 'Expand' : 'Collapse'}
            width={CHEVRON_SIZE}
            height={CHEVRON_SIZE}
          />
        </Box>
      )

      const windowRow = ({ kind, short, label, w }: (typeof rows)[number]) => {
        const pct = w?.percentUsed ?? 0
        const color = w ? level(pct).color : PILL_TRACK
        const reset = w ? resetParts(kind, at, w.resetsAt) : null

        return (
          <Box key={kind} flexDirection="row" alignItems="center" gap={1}>
            <Box width={collapsed ? 3 : 8}>
              <Text dimColor>{collapsed ? short : label}</Text>
            </Box>
            <Svg source={pill(pct, color, pillW, pillH)} alt={`${label} ${Math.round(pct)}% used`} width={pillW} height={pillH} />
            <Box width={5}>
              {w ? <Text bold color={color}>{`${Math.round(pct)}%`}</Text> : <Text dimColor>—</Text>}
            </Box>
            {reset && (
              <Text dimColor>{collapsed ? `↻ ${reset.leftCompact}` : `↻ ${reset.left} · ${reset.when}`}</Text>
            )}
          </Box>
        )
      }

      if (collapsed) {
        return (
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" paddingX={1}>
            <Box flexDirection="row" alignItems="center" gap={3}>
              <Text color={status?.color ?? 'gray'}>✦</Text>
              {all.length === 0 ? <Text dimColor>Plan usage · waiting for first response…</Text> : rows.map(windowRow)}
            </Box>
            {toggleControl}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" paddingX={1} gap={0}>
          <Box flexDirection="row" alignItems="center" justifyContent="space-between">
            <Box flexDirection="row" alignItems="center" gap={2}>
              <Text bold>✦ Plan usage</Text>
              {status ? <Text color={status.color}>{status.badge}</Text> : <Text dimColor>waiting for first response…</Text>}
            </Box>
            {toggleControl}
          </Box>
          {rows.map(windowRow)}
        </Box>
      )
    }

    const { Box, Text, Button } = $.ui.resolve(e)

    // One thin line: ✦ 5h ━━━━━━╸───── 53% ↻2h14m  ·  7d ━━╸───────── 22% ↻3d4h      ⌃
    if (collapsed) {
      return (
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={status?.color ?? 'gray'}>✦</Text>
            {all.length === 0 ? (
              <Text dimColor>plan usage · waiting for first response…</Text>
            ) : (
              rows.map(({ kind, short, w }, i) => {
                const sep = i > 0 ? '  ·  ' : ''
                if (!w) return <Text key={kind} dimColor>{`${sep}${short} ${'─'.repeat(MINI_CELLS)} —`}</Text>
                const { color } = level(w.percentUsed)
                const { filled, track } = thinMeter(w.percentUsed, MINI_CELLS)
                const reset = resetParts(kind, at, w.resetsAt)

                return (
                  <Text key={kind}>
                    {sep && <Text dimColor>{sep}</Text>}
                    <Text dimColor>{`${short} `}</Text>
                    <Text color={color}>{filled}</Text>
                    <Text dimColor>{track}</Text>
                    <Text bold color={color}>{` ${Math.round(w.percentUsed)}%`.padEnd(5)}</Text>
                    {reset && <Text dimColor>{`↻ ${reset.leftCompact}`}</Text>}
                  </Text>
                )
              })
            )}
          </Box>
          <Button key="toggle" label="⌃" plain dimColor hotkey="u" onPress={toggle} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={2}>
            <Text bold>✦ Plan usage</Text>
            {status ? <Text color={status.color}>{status.badge}</Text> : <Text dimColor>waiting for first response…</Text>}
          </Box>
          <Button key="toggle" label="⌄" plain dimColor hotkey="u" onPress={toggle} />
        </Box>

        {rows.map(({ kind, label, w }) => {
          if (!w) {
            return (
              <Box key={kind} flexDirection="row" gap={1}>
                <Text dimColor>{label.padEnd(LABEL_WIDTH)}</Text>
                <Text dimColor>{'─'.repeat(BAR_CELLS)}</Text>
                <Text dimColor>  —</Text>
              </Box>
            )
          }

          const { color } = level(w.percentUsed)
          const { filled, track } = meter(w.percentUsed, BAR_CELLS)
          const reset = resetParts(kind, at, w.resetsAt)

          return (
            <Box key={kind} flexDirection="row" gap={1}>
              <Text dimColor>{label.padEnd(LABEL_WIDTH)}</Text>
              <Text>
                <Text color={color}>{filled}</Text>
                <Text dimColor>{track}</Text>
              </Text>
              <Text bold color={color}>{`${Math.round(w.percentUsed)}%`.padStart(4)}</Text>
              {reset && (
                <Text dimColor>
                  {'  ↻ '}
                  <Text>{reset.left}</Text>
                  {` · ${reset.when}`}
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
