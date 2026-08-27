# dsh-pulse · Session activity status bar

![license](https://img.shields.io/badge/license-MIT-8b5cf6)
![npmmirror](https://img.shields.io/npm/v/dsh-pulse?registry=https://registry.npmmirror.com&label=npmmirror)
![stars](https://img.shields.io/github/stars/Joey-Tong/dsh-pulse)
![issues](https://img.shields.io/github/issues/Joey-Tong/dsh-pulse)
![slot](https://img.shields.io/badge/slot-conversation.input.dock-8b5cf6)

**dsh-pulse** is a session activity status bar for the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI.
A music-player-style equalizer strip sits above the composer card and pulses
with what the current session is doing right now — streaming output,
reasoning, tool calls, your typing — plus compact status chips for network
state, pending interactions, and stuck responses.

The chip cluster stacks vertically (at most two rows; extra chips wrap into a
new column) so it barely eats the equalizer's width, and the "network OK" chip
yields while activity chips are visible (connection warnings always stay).

## What it shows

| Channel | Source | Look |
| --- | --- | --- |
| Output speed | streamed `partial` text characters | cyan bars + `Output N chars/s` chip |
| Thinking speed | streamed `reasoning` characters | violet bars + `Thinking N chars/s` chip |
| Tools | `runningCalls` transitions | amber bars + `Tools ×N` chip |
| User input | draft-length deltas | green bars + `Typing N chars/s` chip |
| Network | Host-description observable | chip: `Network OK` / `Connecting` / `Reconnecting` (strip turns steel gray) |
| Waiting | pending interactions | amber hue + `Awaiting approval` / `Awaiting input` chip |
| Stuck | running with no activity for 8s | red hue + pulsing `Response stalled` chip |

The bar is a translucent glass strip (backdrop blur, theme-aware surface) and
honors `prefers-reduced-motion` (idle breathing stops; only real activity
moves). All animation runs on a `requestAnimationFrame` loop owned by the
mounted component; listeners, loops, and observers dispose with it.

Copy follows the harness locale system (`ctx.locale`), so all labels switch
language with the GUI language setting (zh/en dictionaries ship).

## Requirements

- DeepSeek Harness web GUI (client plugin, browser half only)
- The harness `web` profile (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`)

## Install

From any directory (the profile is created if needed):

```sh
# from GitHub (recommended; the repo ships a built lib/, so no build step)
dsh plugin --profile web add github:Joey-Tong/dsh-pulse
# or a local checkout, for developing the plugin itself
dsh plugin --profile web add link:/path/to/dsh-pulse
# or any published path/tarball/git repo
```

Restart the GUI (`dsh web`) so the new bundle layer activates. The status bar
appears above the composer card in every session.

> **This repo is install-ready.** Others can run the `github:Joey-Tong/dsh-pulse`
> command directly — GitHub distribution fetches the source, and because
> `lib/` (the built bundle) is committed and the `exports` point at it, no
> build step, `prepare` script, or pnpm `allowBuilds` gate is needed at
> install time.

## What the repo needs vs. what it ships

Install-critical files are only `package.json` (plugin manifest +
`dsh.bundle`/`dsh.client`), `cordis.patch.yml` (the patch layer), and `lib/`
(the built bundle the `exports` point at). Everything else — `src/`, `tests/`,
the `tsconfig*.json`/`tsdown.config.ts` build config, `scripts/`, the CI
workflow — exists for open source transparency, contributions, and CI, and is
not loaded at install time.

## Development

```sh
pnpm install        # dev tooling only (typescript/tsdown/vitest/lightningcss)
pnpm watch          # rebuild lib/client.js on change (client HMR / page refresh)
pnpm typecheck      # host + client + test programs
pnpm build          # tsc (lib/*.js + lib/types) + tsdown (lib/client.js)
pnpm test           # unit tests for the meter/palette/geometry pure logic
pnpm verify         # typecheck + build + test
```

Type-only imports resolve against a DeepSeek Harness checkout at
`../deepseek-harness` (tsconfig `paths`); values never do — the browser
module table answers every runtime import (`react`, `@deepseek-ai/cordis`,
slots, runtime, …), enforced at build time by the bundled purity gate.
Because type resolution points at a local harness checkout, `pnpm typecheck`
and `pnpm build` need one present; `pnpm test` (the pure logic) runs anywhere
and is what the fast CI job runs.

### Layout

```
cordis.patch.yml          bundle layer: insert the dsh-pulse entry
src/index.ts              host half (empty apply; browser half is the plugin)
src/client/index.ts       client entry: inject, dictionaries, dock registration
src/client/PulseBar.tsx   the dock component: meter feeding, rAF loop, chips
src/client/meter.ts       pure per-session activity meter (bump/decay/EMA)
src/client/draw.ts        equalizer geometry + canvas painting (pure tests)
src/client/palette.ts     hue blending for mode shifts
src/client/locales.ts     zh/en dictionaries (namespace `pulse`)
scripts/tsdown.client.ts  vendored harness client-bundle builder (MIT)
```

## Notes

- The seat is `conversation.input.dock` (its own full-width row above the
  composer card), declared by `@deepseek-ai/dsh-client-ui-conversation`;
  the shipped stats line keeps its own `composer.dock` seat untouched.
- Stuck threshold (8s) and chip floors are constants in `PulseBar.tsx`; the
  client fiber currently receives no patch config in this preview, so there
  is no config surface yet.
- Network state comes from `ctx.connection.hostDescription` (undefined while
  (re)connecting), not from per-frame frames.
- License MIT. The client-bundle builder in `scripts/tsdown.client.ts` is
  adapted from the official DeepSeek Harness build helper (MIT, © DeepSeek).

## Contributing

PRs welcome. Keep `lib/` fresh (`pnpm build`) before pushing so Git installs
stay zero-build. Run `pnpm verify` with a harness checkout at
`../deepseek-harness`; `pnpm test` runs standalone.
