# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.17.2] - 2026-10-21

### Added
- `/activity clear` empties the activity log, in the pane and on disk.

## [0.17.1] - 2026-10-21

### Changed
- Each turn in `/activity` splits its tokens into full price (new input,
  cache writes, output) and cheap cache reads, so a large total made mostly
  of cache reads is not mistaken for a large cost.

## [0.17.0] - 2026-10-21

### Added
- Cache keeper (from Claude Code's prompt-caching docs): five minutes before
  the main conversation's cache expires (one hour on a subscription, five
  minutes on an API key; `CLAUDE_CODE_PROMPT_CACHE_TTL` and the related
  variables are honoured), a notice says what the next message would re-send
  at full price. A message sent after expiry is noted in `/activity`.
- Project memory (after claude-mem and Mem0, without their Claude calls):
  each project keeps its own note; with the local model on it is rewritten
  every 8 turns at no Claude cost; a new session mentions it; `/last-task`
  prefers this project's note.
- Turning the plugin or a reply style on or off says that the next message
  rebuilds the cache once.

### Changed
- Local team from what is installed, ranked by a benchmark on an Intel CPU:
  `gemma4:e2b` strong, `qwen3:1.7b` fast. Default first download:
  `qwen3:1.7b` (1.4 GB).

## [0.16.0] - 2026-10-21

### Added
- Similar-question cache (after GPTCache): with the local model on, a 46 MB
  local embedding model (`all-minilm`, fetched with the setup) matches a new
  question to an earlier one by meaning; at cosine 0.92 or more the saved
  answer is served, naming the earlier question. Setting `semanticCache`.
- App builds: React Native, Expo, Gradle, Xcode, CocoaPods and Vite output is
  recognised (task noise such as `UP-TO-DATE` lines and compile steps is
  dropped; errors stay), and their folders (`.expo`, `ios/Pods`, `.output`,
  `.vercel`, `.angular`, Metro caches, ...) are junk.

### Changed
- A long prompt (a spec, a pasted error) gets its task type from its first
  1,500 characters instead of none.

## [0.15.0] - 2026-10-21

More from third-party tools (credit: codebase-index-mcp, Serena, Aider's repo
map, ccusage, caveman).

### Added
- `mcp__quota-saver__outline`: a file's declarations or headings with line
  numbers, across common languages, so Claude reads a range instead of the
  whole file. Refused big reads point to it, and the lean rules mention it.
- Burn rate: each limit's time to full at the current pace, in `/quota-saver`
  and in the quota alarm.
- Reply styles: `/quota-saver style lite | full | off` (off by default).

## [0.14.0] - 2026-10-21

The best parts of other token savers, combined (credit: context-saver,
RTK, context-mode, claude-token-efficient, claude-code-llm-router).

### Added
- Command-aware output filters: passing tests (Jest, Vitest, pytest, cargo,
  go and others), progress bars, install chatter and repeated lines are
  dropped before the head/tail cut; error lines never are.
- The original of a shortened output is kept in an owner-only folder
  (`~/.quota-saver/raw`, 3 days) and named in the result, so Claude reads a
  line range instead of re-running the command.
- `QS_RAW=1 <command>` leaves that command's output whole.
- Quota mode: from 90% of a limit, with a local model on, general questions
  go to it by themselves.
- Lean rules: no openers or praise, stop when the task is done, read the
  saved original instead of re-running.
- Local model team: a Roman Urdu specialist, picked by `/local pick`.

### Changed
- An output is changed only when that saves at least 30%.

## [0.13.0] - 2026-10-21

### Added
- Model advisor: on Opus, a light task gets one suggestion per context
  (`/model haiku` for questions and explanations, `/model sonnet` for tests
  and reviews), with the cache cost of switching mid-conversation. Building
  and fixing are left alone. Setting `modelAdvisor`.

## [0.12.0] - 2026-10-21

### Added
- Local model team: a fast model for short questions and a strong one for the
  rest. Each local answer is judged (wrong script, loops, too short); an
  unusable one goes to the other model, and only then to Claude.
- `/local pick`: measures every installed model on this machine (speed,
  usable answers, right language) and sets the team.
- With local mode on, `/new-task` has the local model write the summary;
  Haiku is the fallback.

### Changed
- Reasoning models (Qwen3 and later) are asked to skip their thinking step;
  a model that refuses the option is asked again without it.
- Settings load on first use as well as at session start, so a reload never
  runs with defaults.
- The system prompt for local answers insists on Roman Urdu for Roman Urdu
  questions.

## [0.11.0] - 2026-10-21

### Changed
- Command names are English: `/shortcut` (was `/yaad`), `/forget` (`/bhool`),
  `/new-task` (`/naya-kaam`), `/last-task` (`/wapas`), `/fix` (`/theek`),
  `/explain` (`/samjhao`), `/run-tests` (`/test-chalao`), `/review-changes`
  (`/jaanch`), `/build` (`/banao`), `/brief` (`/chhota`). Roman Urdu prompts are
  still understood.

### Added
- Every command is also a file command, `quota-saver:<name>`, so it appears in
  the `/` menu of editors that list only file commands (VS Code). The plugin
  answers it itself: no model call. `quota-saver:status` is `/quota-saver`.

### Fixed
- `/quota-saver` printed two "All time" lines.

## [0.10.1] - 2026-10-21

### Fixed
- Editors add blocks around a prompt (VS Code's `<browser_instruction>`, for
  one). The plugin judged that whole text, so the task type, the answer cache,
  the local-model routing and shortcuts missed what the person typed. It now
  works on the typed words alone and still sends Claude the whole prompt.

### Changed
- `/activity` explains each step: the typed words with their language and
  size, the editor blocks around them, whether a saved answer existed, why the
  local model was or was not used, which hidden guide was added (with its size
  and what it asks), that the words went to Claude unchanged, the lean rules
  in the system prompt, and a turn's tokens split into new, cache-written and
  cache-read. A turn with nothing to cut says why.

## [0.10.0] - 2026-10-21

### Added
- Used vs without the plugin, per turn in `/activity` and per session and all
  time in `/quota-saver`: Claude's API-reported tokens set against an estimate
  that adds back what the plugin kept out of the context, once per request.
  Free answers (cache, local model) count as one request over the context.
  Unmeasurable savings are left out, so the estimate errs low.

## [0.9.1] - 2026-10-21

### Fixed
- A model nobody picked by hand is no longer pinned: settings saved by an
  older version kept its default (`qwen2.5:3b`), which started a 2 GB
  download although `qwen2.5:1.5b` was installed. `/local model` marks a
  choice as the person's own.
- `/local on` uses a good small model that is already installed before
  downloading another.

## [0.9.0] - 2026-10-21

### Added
- Junk guard: whole reads of dependency and build folders (`node_modules`,
  `dist`, `build`, `.next`, `target`, `__pycache__`, …), lock files and
  minified or generated files are refused once with the reason. Setting
  `guardJunk`.
- `/quota-saver audit`: the fixed cost of every request (loaded MCP tool
  schemas per server, memory files, skills, agents) with concrete cuts. It also
  runs once per context by itself and speaks up only when something is heavy.
  Measured locally, so the audit costs nothing.
- Quota alarm at 80% and 95% of the 5-hour and weekly limits, once per window.
- Model-switch warning: says how many tokens a prompt-cache restart re-sent.
- `/quota-saver week` and `/quota-saver month`: savings per day.

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
