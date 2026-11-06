# Discord Quest Completer

A Windows desktop app that completes Discord quests by running tiny dummy game
executables under the real games' names — so Discord sees you "playing" for the
~15 minutes a quest requires, without owning or launching the actual games.

Built with **Tauri v2 + Rust + Vue 3**. Inspired by
[markterence/discord-quest-completer](https://github.com/markterence/discord-quest-completer),
improved with a live catalog, search, favorites, a quest timer with OS
notification, auto-close, and automatic cleanup.

## Features

- **Live catalog** — the detectable-games list is fetched from Discord's API at
  runtime, with a cached copy and a bundled snapshot as offline fallbacks. The
  UI always tells you which source you're seeing.
- **Search** — fuzzy search over game names, aliases, and executable names.
- **Favorites** — pinned above the list, persisted across restarts.
- **Quest timer** — Play starts a visible **15:10** countdown (15 minutes plus a
  10-second margin, because Discord detects the running game a few seconds
  late). At 00:00 you get an OS notification and the dummy process closes
  itself.
- **Scoped cleanup** — stale `games/` folders are removed on startup and on
  demand; a folder whose dummy is still running is never touched.
- **Safe process handling** — only the exact process the app spawned is
  stopped (tracked by PID), never every process sharing the image name.

## Requirements (Windows only)

- [Rust](https://rustup.rs/) (stable, with the MSVC toolchain)
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  (MSVC linker — required by Tauri)
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) —
  preinstalled on Windows 10/11 in most cases
- [pnpm](https://pnpm.io/) (`corepack enable pnpm` or `npm i -g pnpm`)

## Install

```powershell
pnpm install
```

pnpm 10+ blocks dependency postinstall scripts until approved. On first install
you'll be prompted for `esbuild` — approve it (or run
`pnpm approve-builds esbuild`). The approval is already recorded in
`pnpm-workspace.yaml` for this repo.

## Development

```powershell
pnpm tauri dev
```

This builds the dummy runner in debug mode, starts Vite on `localhost:1420`,
compiles the Rust backend, and opens the app window. Rust sources are watched —
edits reload automatically.

## Release build

```powershell
pnpm dist:win
```

One command, end to end:

1. `pnpm build:runner:win` — compiles the dummy runner (`src-runner`) in release mode
2. `pnpm copy:runner:win` — copies it into `src-tauri/resources/` so it gets bundled
3. `pnpm tauri build` — builds the frontend (`pnpm build`) and bundles the app

Artifacts land in `src-tauri/target/release/bundle/` (NSIS installer + MSI).

## Usage

1. **Search** (or browse / check **Favorites**) for a game that has an active
   Discord quest.
2. Press **Play** — the app creates a folder under its data directory containing
   a dummy executable renamed to the game's real executable name, starts it, and
   the countdown begins.
3. Keep Discord open. After **15:10** you get a Windows notification and the
   dummy closes itself — the quest should be credited.
4. **Stop** ends the session early (the timer resets with it).
5. **Clean up folders** (header) removes leftover `games/` folders whose dummy
   is no longer running. The same cleanup runs automatically at startup.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Runner not built: ... quest-runner.exe missing` | Run `pnpm runner:win` first (or use `pnpm dist:win`, which does it for you). |
| `pnpm install` fails on `esbuild` | Run `pnpm approve-builds esbuild` and retry. |
| `cargo: command not found` | Open a new terminal after installing Rust, or prefix with `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`. |
| Linker errors (`link.exe` not found) | Install MSVC Build Tools with the "Desktop development with C++" workload. |
| Quest not credited | Make sure Discord is running and had time to detect the game; the 10-second margin exists exactly for this. Re-test if Discord changes detection — the mechanism (executable name in the process list) follows the upstream approach. |

## How it works

Discord credits quests by seeing a *detectable* game's executable name in your
process list. The app exploits that with a minimal windowed Rust binary
(`src-runner`, ~110 KB) that:

- presents a real window (detection details are unverified upstream; a visible
  window mirrors the proven behavior),
- accepts a `--title` argument for the window title,
- is copied into `games/<app_id>/<executable>` and **renamed to the game's real
  executable name** before launch.

The backend (`src-tauri`) holds the `std::process::Child` handle for every dummy
it starts, so stopping targets only that instance — no `taskkill /IM`, no
collateral damage to unrelated processes with the same name.

## Development notes

- Tests: `pnpm test` (Vitest, frontend) · `cargo test --manifest-path src-tauri/Cargo.toml`
  (backend) · type-check: `pnpm check`
- `VITE_QUEST_DURATION_MS` overrides the quest duration (test/probe seam only;
  unset in normal use).

## License

Copyright (c) 2026 zubzerozD. All rights reserved.
See [LICENSE](LICENSE) for details.
