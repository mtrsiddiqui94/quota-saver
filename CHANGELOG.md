# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
