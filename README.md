# Quota Saver

**A Claude Code plugin that stretches your quota.** It cuts tokens where they are actually spent (tool output, file reads, conversation history) and answers what it can on your own machine. Write in English, Roman Urdu or a mix.

> Step-by-step install: [INSTALL.md](INSTALL.md) · Roman Urdu guide: [docs/guide-roman-urdu.md](docs/guide-roman-urdu.md)

## What it does

| Feature | How it saves |
|---|---|
| **Output diet** | Long Bash, test, build, web and MCP output is cut to its head, its tail and the lines that look like errors *before* it enters the conversation, so it is not re-sent on every later turn. File contents (Read) are never cut. |
| **Read guard** | A whole read of a large file is refused once with a hint to search first. A re-read of an unchanged file is refused once. An identical retry always goes through. |
| **Auto task detection** | "fix the login error", "ye samjhao", "tests chalao": the plugin recognises the kind of task and attaches a short, lean instruction for it. No commands to remember. |
| **Personal dictionary** | `/yaad dp = deploy to staging, run tests first`. Then type `dp`, or `#dp` inside a sentence. Expanded locally. |
| **Local answer cache** | A question answered before, in a turn that changed nothing, is answered from disk for **0 tokens**. Roman Urdu spelling variants ("kia ha" / "kya hai") count as the same question. Entries expire after 3 days. A leading `!` always asks Claude fresh. |
| **Local model (Ollama)** | Optional, off by default. General questions run on a model on your machine for **0 Claude tokens**. Project work always goes to Claude. |
| **Smart handoff** | `/naya-kaam` has Haiku write a 12-line note of the session, clears the context, and carries the note forward. `/wapas` loads the last note in a new session instead of the whole history. |
| **Cheap explorer** | A `quota-saver:explorer` subagent on Haiku for broad codebase searches. |
| **Meter** | Status line: `quota-saver · ctx 42% · 5h 30% · saved ~12k tok`, with a nudge at 65% and 85% context. |
| **Lean rules** | A short system-prompt section: answer first, no recaps, search before reading, small edits. |

## Install

Works wherever Claude Code runs (macOS, Windows, Linux; terminal and the VS Code extension). It needs nothing else installed: the plugin runs inside Claude Code.

From GitHub:

```
/plugin install quota-saver --marketplace mtrsiddiqui94/quota-saver
```

Then answer `y` to add the marketplace and pick a scope. From a shell:

```
claude plugin install quota-saver --marketplace mtrsiddiqui94/quota-saver
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `mtrsiddiqui94/quota-saver`, then Add plugin.

From a local folder:

```
claude plugin marketplace add /path/to/quota-saver
claude plugin install quota-saver@quota-saver
```

## Commands

| Command | |
|---|---|
| `/quota-saver` | Savings report, context and quota |
| `/quota-saver on` · `/quota-saver off` | Turn the whole plugin on or off (remembered) |
| `/local` | Local model status and setup steps |
| `/local on` · `/local auto` · `/local off` | Sets everything up if needed, then `on`: prompts starting with `~` run locally; `auto`: general questions run locally too |
| `/local model <name>` | Choose the Ollama model (default `qwen2.5:3b`) |
| `/yaad name = meaning` · `/yaad` | Save a shortcut, or list them |
| `/bhool name` · `/bhool cache` | Forget a shortcut, or clear the answer cache |
| `/naya-kaam [next task]` · `/wapas` | Handoff across `/clear`, or into a new session |
| `/theek` `/samjhao` `/test-chalao` `/jaanch` `/banao` `/chhota` | Ready-made lean prompts (optional) |

Prefixes: `!` sends a prompt straight to Claude (skips cache and local model). `~` sends it to the local model when `/local` is on.

## Settings

In `/config`, under `quota-saver`:

| Setting | Default | |
|---|---|---|
| `maxOutputChars` | `6000` | Tool output longer than this is shortened |
| `maxReadKB` | `80` | Whole reads above this size get the search-first hint |
| `dedupeReads` | `true` | Refuse a repeat read of an unchanged file |
| `autoIntent` | `true` | Attach the lean task guide |
| `localCache` | `true` | Serve repeated questions from disk |
| `ollamaUrl` | `http://localhost:11434` | Local model server |
| `setupLocalModel` | `ask` | `yes` / `ask` / `no`: what to do about the local model on the first session |

## Local model setup

Nothing to do by hand. At install time the plugin asks **Local model (Ollama) setup: yes / ask / no**:

- `yes`: on the first session it installs Ollama, starts it, downloads the model and switches local mode on. Progress shows on the status line.
- `ask` (default): it asks once, on the first session.
- `no`: it stays off. `/local on` sets it up later.

How it installs:

| OS | First try | Fallback |
|---|---|---|
| macOS | Homebrew (`brew install ollama`) | Official app zip into `~/Applications` |
| Windows | `winget install Ollama.Ollama` | Official installer, silent |
| Linux | Official install script | Official build into `~/.local` (no root) |

The model (default `qwen2.5:3b`, about 2 GB) is downloaded once. On a machine without a GPU, `/local model qwen2.5:1.5b` answers faster. While local mode is on, the plugin starts the Ollama server with each session if it is not already running. If anything fails, the prompt goes to Claude and a notice says why.

## Limits

- The plugin makes a paid plan last longer. It does not make Claude free: Claude Code needs a Claude subscription or API credits.
- Savings are estimated at about 4 characters per token.
- Cached answers may be out of date if the code changed since. They expire after 3 days, and `!` always asks again.
- `prompt.compose` and `session.compact` hooks do not run for user-installed plugins where an organisation manages Claude Code; there the lean rules and the handoff note are not added.

## Development

```
claude plugin validate .
claude plugin test .
```

Layout:

```
hooks/register.ts      entry: wires the features
hooks/core/state.ts    options, per-process state, persisted stats and settings
hooks/features/        one file per feature
hooks/lib/             pure helpers (trimming, intent, dictionary, cache, Ollama)
commands/              markdown slash commands
tests/                 lib.test.ts (helpers), hooks.test.ts (end to end in the engine)
```

## License

[MIT](LICENSE)
