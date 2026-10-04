# usage-band

A slim band above the Claude Code prompt that shows how much of your Claude plan you've used: the **5-hour** window and the **weekly** limit, each with a progress bar, a percentage and a countdown to its reset.

![usage-band in the Claude desktop app, collapsed and expanded](docs/preview.svg)

In the terminal it draws with text characters:

```
Expanded
╭──────────────────────────────────────────────────────────────╮
│ ✦ Plan usage  ◆ moderate                                   ⌄ │
│ 5-hour  ████████████▋───────────  53%  ↻ 2h 14m · 14:30      │
│ Weekly  █████▍──────────────────  22%  ↻ 3d 4h · Thu 09:00   │
╰──────────────────────────────────────────────────────────────╯

Collapsed
 ✦ 5h ━━━━━━╸───── 53% ↻ 2h14m  ·  7d ━━╸───────── 22% ↻ 3d4h        ⌃
```

## Features

- **Two windows:** the 5-hour limit and the weekly limit, side by side.
- **Color by level:** green under 50%, amber from 50–80%, red over 80%. The ✦ icon takes the color of the higher window.
- **Reset countdown:** shows how long until each window resets, plus the clock time, updated every minute.
- **Warning toast:** one notification when a window passes 90%, once per reset period.
- **Collapse to one line:** ⌄ / ⌃ switches between the card and a single thin line. Your choice is remembered across sessions.
- **Works in the terminal and the desktop app.**

## Requirements

- **Claude Code 2.1.286 or newer.** Earlier versions don't support plugin hook modules or the events this band uses. Check with `claude --version`.
- **A Claude Pro or Max subscription.** The 5-hour and weekly figures only exist on subscription plans. With an API key, the band shows "waiting for first response…".

## Installation

### 1. Clone the repo

macOS / Linux:

```bash
git clone https://github.com/YossiAbutbul/claude-usage-band.git ~/.claude/mods/usage-band
```

Windows (PowerShell):

```powershell
git clone https://github.com/YossiAbutbul/claude-usage-band.git "$env:USERPROFILE\.claude\mods\usage-band"
```

### 2. Load it in every session

Open `~/.claude/settings.json` (on Windows: `%USERPROFILE%\.claude\settings.json`) and add the folder under `env`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/usage-band"
  }
}
```

If you already have an `env` block, add the `CLAUDE_CODE_PLUGIN_DIRS` line to it. To load several plugin folders, separate them with `:` on macOS/Linux or `;` on Windows.

This works for the terminal and for the Claude desktop app.

### 3. Restart Claude Code

Start a new session. The band appears above the prompt and fills in after Claude's first reply.

### Try it once without installing

To load it for a single terminal session only:

```bash
claude --plugin-dir ~/.claude/mods/usage-band
```

## Usage

| Action | How |
| --- | --- |
| Collapse or expand | Click **⌄** / **⌃** on the band |
| Collapse or expand from the prompt | Type `/usage-band` |
| Keyboard (terminal) | Focus the band, then press `u` |

The numbers update after each reply from Claude, since that's when your plan usage is reported. The reset countdown updates every minute on its own.

## Customizing

All settings are constants at the top of [`hooks/register.tsx`](hooks/register.tsx):

| Constant | What it controls | Default |
| --- | --- | --- |
| `WARN_AT` | Percentage that triggers the warning toast | `90` |
| `BAR_CELLS` | Bar width in the expanded card (terminal) | `24` |
| `MINI_CELLS` | Bar width in the collapsed line (terminal) | `12` |
| `level()` | Color thresholds and colors | 50% / 80% |
| `pill()` sizes | Bar size in the desktop app | `84×5` collapsed, `220×8` expanded |

Claude Code reloads the plugin when you save the file.

## Updating

```bash
cd ~/.claude/mods/usage-band
git pull
```

## Uninstalling

1. Remove the `CLAUDE_CODE_PLUGIN_DIRS` line from `~/.claude/settings.json`.
2. Delete the `~/.claude/mods/usage-band` folder.

## Troubleshooting

- **The band doesn't appear.** Check `claude --version` is 2.1.286 or newer, and that the path in `CLAUDE_CODE_PLUGIN_DIRS` points to the folder that contains `.claude-plugin/`. Start a new session after editing settings.
- **It says "waiting for first response…".** Send any message; the figures arrive with Claude's reply. If it stays there, your account isn't on a subscription plan.
- **The band shows twice.** The plugin is loaded from two places, for example from `CLAUDE_CODE_PLUGIN_DIRS` and a `--plugin-dir` flag. Remove one.
- **Errors.** Run `claude --debug`; lines starting with `usage-band:` explain what failed.

## License

[MIT](LICENSE)
