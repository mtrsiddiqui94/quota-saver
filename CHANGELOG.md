# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.8.1] - 2026-10-21

### Fixed
- 0.8.0 shipped a duplicated block in the local setup code (it failed
  type-checking). Removed.

### Added
- `scripts/check.sh`: validate, test and type-check, stopping at the first
  failure.

## [0.8.0] - 2026-10-21

### Added
- `/activity on | off | text`: watch what the plugin does on each prompt in a
  terminal window that opens by itself (macOS Terminal, Windows PowerShell,
  common Linux terminals), plus a pane where the surface draws one. Off by
  default; nothing is recorded unless it is on. Shows shortcuts, cache hits,
  local-model answers, blocked reads, shortened output, the task guide and
  each turn's real token usage.
- Model fallbacks: if the chosen model cannot be downloaded, the setup tries
  `llama3.2:3b`, then `gemma3:1b`.

### Changed
- macOS installs the official prebuilt Ollama app first (Homebrew compiles
  from source on Intel Macs and can take an hour); Homebrew is the fallback.
  The app is opened to run the server, so it keeps running after a session.
- Default local model is `qwen2.5:1.5b` (about 1 GB, fast on a CPU).

## [0.7.0] - 2026-10-21

### Changed
- Every question, message, command description and setting description is
  now in English. Prompts in Roman Urdu are still understood, and command
  names stay as they were.
- The install guide covers turning off, disabling and uninstalling, and
  removing Ollama.

## [0.6.0] - 2026-10-21

### Added
- Local setup progress shows in the conversation itself, one line per step
  (each Homebrew step, server start, model download every 10%), so it is
  visible on every surface, VS Code included.
- `/local` while the setup runs says what it is doing and for how long.

### Changed
- Homebrew runs without its auto-update during the install, which is faster.

## [0.5.0] - 2026-10-21

### Changed
- Renamed from `kifayat` to `quota-saver`: the main command is now
  `/quota-saver`, the agent `quota-saver:explorer`. Stats and settings start
  fresh under the new name.

## [0.4.0] - 2026-10-21

### Added
- Zero-touch local model: `/local on` installs Ollama (Homebrew / winget /
  install script, each with an official-download fallback), starts the server,
  downloads the model with progress on the status line, and switches local
  mode on. It asks once before installing anything.
- Install-time choice `setupLocalModel` (`yes` / `ask` / `no`) acted on in the
  first session.
- The Ollama server is started with each session while local mode is on.

## [0.3.0] - 2026-10-21

### Added
- End-to-end tests that load the plugin in the engine and drive every feature
  (prompt router, local model, read guard, output diet, answer cache,
  rules, handoff, commands, switches).
- CI workflow that validates the manifest and runs the test suite.
- English README; the Roman Urdu guide moved to `docs/`.

### Changed
- Source split into `hooks/core`, `hooks/features` and `hooks/lib`.

### Fixed
- Savings counters are awaited, so a write is never lost after a hook returns.
- A failing `/` command now answers with a message instead of failing silently.

## [0.2.0] - 2026-10-21

### Added
- Local model mode through Ollama (`/local on | auto | off | model`).
- Global switch `/kifayat on | off`, remembered across sessions.

## [0.1.0] - 2026-10-21

### Added
- Output diet, read guard, auto task detection, lean rules, context and quota
  meter, personal dictionary (`/yaad`, `/bhool`), local answer cache, smart
  handoff (`/naya-kaam`, `/wapas`), cheap explorer agent, Roman Urdu commands.
