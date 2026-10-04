import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Window } from '../types'

const windows = atom({ plugin: 'usage-band', key: 'windows' } as const, [])
const warned = atom({ plugin: 'usage-band', key: 'warned' } as const, [])
const isCollapsed = atom({ plugin: 'usage-band', key: 'isCollapsed' } as const, false)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)
const cost = atom({ plugin: 'usage-band', key: 'cost' } as const, null)

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
// A 1px hairline stretched to the slot's width: separates the band from the app's bar below it.
// An outlined "i", drawn as a plain image. The reset detail beside it is revealed by the
// surface's own hover (no sandboxed frame, so no opaque box behind the icon).
// The collapse toggle's chevron: a rounded 1.75px stroke, the same gray as the info icon.
const CHEVRON_SIZE = 16
const chevron = (dir: 'up' | 'down') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
  `<path d="${dir === 'up' ? 'M4.5 10 8 6.5l3.5 3.5' : 'M4.5 6.5 8 10l3.5-3.5'}" fill="none" stroke="#8e8d89" ` +
  `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const INFO_SIZE = 14
// Tooltip widths in cells: the expanded table (padding, dot, label 7, time 8, clock up to 9,
// gaps) and the collapsed one-line form; and the 14px info icon's width in cells.
const TIP_TABLE_WIDTH = 30
const TIP_ROW_WIDTH = 46
const INFO_CELLS = 2
const INFO_ICON =
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">` +
  `<g stroke="#8e8d89" fill="none" stroke-width="1.2" stroke-linecap="round">` +
  `<circle cx="7" cy="7" r="5.6"/><line x1="7" y1="6.3" x2="7" y2="9.8"/></g>` +
  `<circle cx="7" cy="4.3" r="0.8" fill="#8e8d89"/>` +
  `</svg>`

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

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// The session's running cost, as /cost totals it, to the cent.
const formatUsd = (usd: number) => (usd >= 0.01 || usd === 0 ? `$${usd.toFixed(2)}` : '<$0.01')

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
    const startUsd = usage.cost?.usd
    if (startUsd !== undefined) await update($, cost, () => startUsd)

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
    const usd = e.cost?.usd
    if (usd !== undefined && e.changed.includes('cost')) await update($, cost, () => usd)

    return next(e)
  })

  // The band shares this slot with what the app draws above the prompt (the desktop's git
  // changes bar among it), so it draws on top of the app's own drawing rather than replacing it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const below = await next(e)
    const band = await (async () => {
    const all = await read($, windows)
    const collapsed = await read($, isCollapsed)
    const at = (await read($, now)) || (await $.clock.now())
    const rows = SHOWN.map(s => ({ ...s, w: all.find(w => w.kind === s.kind) }))
    const peak = Math.max(0, ...rows.map(r => r.w?.percentUsed ?? 0))
    const status = all.length === 0 ? null : level(peak)
    const toggle = () => setCollapsed($, !collapsed)
    const spent = await read($, cost)
    const costText = spent === null ? null : formatUsd(spent)
    // Responsive: the band's width in cells (the terminal's width, or the transcript column's
    // on desktop) drives every size below, so it never wraps or crowds on a narrow window.
    const cols = e.props.bodyColumns || 100

    // Desktop: SVG pills instead of box-drawing glyphs, which gap in a proportional font.
    if (e.surface === 'desktop') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      // Collapsed: full bars from 90 cells, short bars from 64, percentages alone below that.
      // Expanded: bars shrink with the band, from 220px down to 72px.
      const pillW = collapsed ? (cols >= 90 ? 84 : cols >= 64 ? 48 : 0) : clamp(Math.round((cols - 30) * 7), 72, 220)
      const pillH = collapsed ? 5 : 8


      // One ⓘ for the whole band, its tooltip a small table of every window's reset. One hover
      // scope, so two tooltips can never be open at once. Absolute, so revealing it moves
      // nothing; the desktop draws it as a popover card. Text colors are the theme's own, apart
      // from each window's level dot.
      const resets = rows.flatMap(({ kind, label, w }) => {
        const reset = w ? resetParts(kind, at, w.resetsAt) : null

        return reset && w ? [{ kind, label, color: level(w.percentUsed).color, ...reset }] : []
      })
      // The desktop draws a hover-revealed Box as a popover opening rightward from its parent's
      // left edge, ignoring its own offsets, so one nested straight in the ⓘ runs off the band's
      // right edge under the panel beside the transcript. Hover groups across separate Boxes do
      // not reveal on the desktop, so the tooltip must stay inside the ⓘ's keyed Box. It sits in
      // an always-present, invisible absolute anchor that the ⓘ holds, placed (plain absolute
      // offsets are honored) one tooltip-width to the icon's left: the popover opens from the
      // anchor's left edge and ends at the ⓘ, toward the band's center. Absolute, so no layout.
      const tipWidth = collapsed ? TIP_ROW_WIDTH : TIP_TABLE_WIDTH
      const tip = collapsed ? (
        <Box position="absolute" top={0} left={0} width={tipWidth} flexDirection="row" alignItems="center" gap={1} paddingX={1} display="none" hover={{ display: 'flex' }}>
          <Text dimColor>Resets in</Text>
          {resets.map((r, i) => (
            <Box key={`tip-${r.kind}`} flexDirection="row" alignItems="center" gap={1}>
              {i > 0 && <Text dimColor>·</Text>}
              <Text color={r.color}>●</Text>
              <Text dimColor>{r.label}</Text>
              <Text bold>{r.leftCompact}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box position="absolute" top={0} left={0} width={tipWidth} flexDirection="column" paddingX={1} display="none" hover={{ display: 'flex' }}>
          <Text dimColor>Resets in</Text>
          {resets.map(r => (
            <Box key={`tip-${r.kind}`} flexDirection="row" alignItems="center" gap={1}>
              <Text color={r.color}>●</Text>
              <Box width={7}>
                <Text dimColor>{r.label}</Text>
              </Box>
              <Box width={8}>
                <Text bold>{r.left}</Text>
              </Box>
              <Text dimColor>{r.when}</Text>
            </Box>
          ))}
        </Box>
      )
      const resetInfo = resets.length > 0 && (
        <Box key="reset-info" alignItems="center">
          <Svg
            source={INFO_ICON}
            alt={resets.map(r => `${r.label} resets in ${r.left}, ${r.when}`).join('; ')}
            width={INFO_SIZE}
            height={INFO_SIZE}
          />
          <Box position="absolute" top={0} left={-(tipWidth - INFO_CELLS)} width={tipWidth}>
            {tip}
          </Box>
        </Box>
      )

      // Chevron alone: a Button's label is text only, so it is drawn as an image.

      const toggleControl = (
        <Box flexDirection="row" alignItems="center" gap={2}>
          {resetInfo}
          {/* A Button's label is text only. The chevron image sets the control's size; a blank
              Button (a braille blank keeps its width) sits on top in an absolute Box spanning the
              chevron, centered, so it takes the click and its hover highlight frames the icon.
              The Button must be on top: an image over it swallows the click. Two blanks and the
              wrapper's side padding give the highlight room on either side of the chevron. */}
          <Box key="toggle-wrap" alignItems="center" justifyContent="center" paddingX={1}>
            <Svg source={chevron(collapsed ? 'up' : 'down')} alt={collapsed ? 'Expand' : 'Collapse'} width={CHEVRON_SIZE} height={CHEVRON_SIZE} />
            <Box position="absolute" top={0} bottom={0} left={0} right={0} alignItems="center" justifyContent="center">
              <Button key="toggle" label={'⠀⠀'} plain onPress={toggle} />
            </Box>
          </Box>
        </Box>
      )

      const windowRow = ({ kind, short, label, w }: (typeof rows)[number]) => {
        const pct = w?.percentUsed ?? 0
        const color = w ? level(pct).color : PILL_TRACK

        return (
          <Box key={kind} flexDirection="row" alignItems="center" gap={1}>
            <Box width={collapsed ? 3 : 8}>
              <Text dimColor>{collapsed ? short : label}</Text>
            </Box>
            {pillW > 0 && (
              <Svg source={pill(pct, color, pillW, pillH)} alt={`${label} ${Math.round(pct)}% used`} width={pillW} height={pillH} />
            )}
            <Box width={5}>
              {w ? <Text bold color={color}>{`${Math.round(pct)}%`}</Text> : <Text dimColor>—</Text>}
            </Box>
          </Box>
        )
      }

      if (collapsed) {
        return (
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" paddingX={1}>
            <Box flexDirection="row" alignItems="center" gap={cols >= 64 ? 3 : 2}>
              <Text color={status?.color ?? 'gray'}>✦</Text>
              {all.length === 0 ? <Text dimColor>Plan usage · waiting for first response…</Text> : rows.map(windowRow)}
              {costText && (
                <Box key="cost" flexDirection="row" alignItems="center" gap={1}>
                  <Text dimColor>session ≈</Text>
                  <Text bold>{costText}</Text>
                </Box>
              )}
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
          {costText && (
            <Box key="cost" flexDirection="row" alignItems="center" gap={1}>
              <Box width={8}>
                <Text dimColor>Session</Text>
              </Box>
              <Text bold>{costText}</Text>
              <Text dimColor>at API prices, covered by your plan</Text>
            </Box>
          )}
        </Box>
      )
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    // Terminal: bars give up cells first, then the collapsed line drops its bars and countdowns.
    const barCells = clamp(cols - 44, 8, BAR_CELLS)
    const miniCells = cols >= 96 ? MINI_CELLS : cols >= 72 ? 6 : 0
    const showCountdown = cols >= 60

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
                if (!w) return <Text key={kind} dimColor>{`${sep}${short} ${'─'.repeat(miniCells)} —`}</Text>
                const { color } = level(w.percentUsed)
                const { filled, track } = thinMeter(w.percentUsed, miniCells)
                const reset = resetParts(kind, at, w.resetsAt)

                return (
                  <Text key={kind}>
                    {sep && <Text dimColor>{sep}</Text>}
                    <Text dimColor>{`${short} `}</Text>
                    <Text color={color}>{filled}</Text>
                    <Text dimColor>{track}</Text>
                    <Text bold color={color}>{` ${Math.round(w.percentUsed)}%`.padEnd(5)}</Text>
                    {reset && showCountdown && <Text dimColor>{`↻ ${reset.leftCompact}`}</Text>}
                  </Text>
                )
              })
            )}
            {costText && <Text dimColor>{'  ·  ≈ '}<Text bold>{costText}</Text></Text>}
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
                <Text dimColor>{'─'.repeat(barCells)}</Text>
                <Text dimColor>  —</Text>
              </Box>
            )
          }

          const { color } = level(w.percentUsed)
          const { filled, track } = meter(w.percentUsed, barCells)
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
                  {showCountdown ? ` · ${reset.when}` : ''}
                </Text>
              )}
            </Box>
          )
        })}
        {costText && (
          <Box key="cost" flexDirection="row" gap={1}>
            <Text dimColor>{'Session'.padEnd(LABEL_WIDTH)}</Text>
            <Text bold>{costText}</Text>
            <Text dimColor>at API prices, covered by your plan</Text>
          </Box>
        )}
      </Box>
    )
    })()
    const { Box } = $.ui.resolve(e)

    return below ? (
      <Box flexDirection="column">
        {band}
        {below}
      </Box>
    ) : (
      band
    )
  })
}
