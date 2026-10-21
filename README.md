# Quota Saver

**A Claude Code plugin that stretches your quota.** It cuts tokens where they are actually spent (tool output, file reads, conversation history) and answers what it can on your own machine. Write in English, Roman Urdu or a mix.

> Step-by-step install: [INSTALL.md](INSTALL.md) · Roman Urdu guide: [docs/guide-roman-urdu.md](docs/guide-roman-urdu.md)

## What it does

| Feature | How it saves |
|---|---|
| **Output diet** | Before Bash, web or MCP output enters the conversation (where every later request would re-send it): command-aware filters drop passing tests, progress bars, install chatter and repeated lines; what is still long keeps its head, its error lines and its tail. It changes an output only when that saves 30% or more, and keeps the original in an owner-only folder (`~/.quota-saver/raw`, 3 days), named at the end of the result so Claude reads a line range instead of re-running the command. `QS_RAW=1 <command>` leaves one command's output whole. Error lines are never dropped; file contents (Read) are never cut. |
| **Outline tool** | `mcp__quota-saver__outline` gives a file's functions, classes, types or headings with line numbers (JS/TS, Python, Go, Rust, Java, Kotlin, C#, Swift, PHP, Ruby, Markdown), so Claude reads only the range it needs instead of the whole file. A refused big read points to it. |
| **Reply style** | `/quota-saver style lite` (short, plain) or `full` (telegraphic; code, paths and errors stay exact) cuts output tokens, the most expensive kind. Off by default. |
| **Junk guard** | Whole reads of `node_modules`, `dist`, `build`, `ios/Pods`, `.expo`, `.next`, `.nuxt`, `.output` and other dependency or build folders, lock files and minified bundles are refused once with the reason. Source files are never affected. |
| **Read guard** | A whole read of a large file is refused once with a hint to search first. A re-read of an unchanged file is refused once. An identical retry always goes through. |
| **Auto task detection** | "fix the login error", "ye samjhao", "tests chalao": the plugin recognises the kind of task and attaches a short, lean instruction for it. No commands to remember. |
| **Personal dictionary** | `/shortcut dp = deploy to staging, run tests first`. Then type `dp`, or `#dp` inside a sentence. Expanded locally. |
| **Similar-question cache** | With the local model on, a question that *means* the same as one answered before ("docker kya cheez hai" after "docker kya hai") is answered from disk too. A 46 MB local embedding model compares meanings; the bar is strict (cosine 0.92), and the reply names the earlier question. Setting `semanticCache`. |
| **Local answer cache** | A question answered before, in a turn that changed nothing, is answered from disk for **0 tokens**. Roman Urdu spelling variants ("kia ha" / "kya hai") count as the same question. Entries expire after 3 days. A leading `!` always asks Claude fresh. |
| **Local model team (Ollama)** | Optional, off by default. General questions run on your machine for **0 Claude tokens**: a fast model takes short questions, a strong one the rest. Every local answer is checked (wrong script, loops, empty); a bad one goes to the other model, then to Claude. `/local pick` measures the installed models on this machine and sets the team. Reasoning models answer without their slow "thinking" step. Project work always goes to Claude. |
| **Cache keeper** | The prompt cache expires after a quiet spell (an hour on a subscription, five minutes on an API key), and the next message then re-sends the whole context at full price. Five minutes before that, a notice says so: send the next message now, or `/new-task` first. |
| **Project memory** | Each project keeps its own 12-line note. With the local model on, it is rewritten every 8 turns for free; a new session in the project mentions it, and `/last-task` loads it instead of the old history. |
| **Smart handoff** | `/new-task` has Haiku write a 12-line note of the session, clears the context, and carries the note forward. `/last-task` loads the last note in a new session instead of the whole history. |
| **Cheap explorer** | A `quota-saver:explorer` subagent on Haiku for broad codebase searches. |
| **Audit** | `/quota-saver audit` measures what rides on *every* request before your prompt: MCP tool schemas per server, CLAUDE.md and other memory files, skills and agents, and says what to cut. Runs once by itself per context and speaks up only if something is heavy. |
| **Quota alarm, burn rate and quota mode** | `/quota-saver` shows each limit's use, when it fills at the current pace and when it resets. At 80% and 95% a notice says the same. From 90%, with a local model on, general questions go to it by themselves. |
| **Model advisor** | The model is the biggest lever on quota. On Opus, a light task (a question, an explanation, running tests, a review) gets one suggestion per context: `/model haiku` or `/model sonnet`, with what switching now would cost in cache. Setting `modelAdvisor`. |
| **Model-switch warning** | Changing model mid-conversation restarts the prompt cache, re-sending the whole context at full price. The plugin says how many tokens that cost. |
| **Savings report** | `/quota-saver week` (or `month`): what was saved each day. |
| **Meter** | Status line: `quota-saver · ctx 42% · 5h 30% · saved ~12k tok`, with a nudge at 65% and 85% context. |
| **Lean rules** | A short system-prompt section: answer first, no recaps, no openers or praise, stop when done, search before reading, small edits, read the saved original instead of re-running a command. |

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
| `/quota-saver style lite\|full\|off` | Shorter replies (fewer output tokens) |
| `/quota-saver audit` | What every request carries (MCP servers, CLAUDE.md, skills) and how to cut it |
| `/quota-saver week` · `/quota-saver month` | Savings per day |
| `/quota-saver on` · `/quota-saver off` | Turn the whole plugin on or off (remembered) |
| `/local` | Local model status and setup steps |
| `/local on` · `/local auto` · `/local off` | Sets everything up if needed, then `on`: prompts starting with `~` run locally; `auto`: general questions run locally too |
| `/local pick` | Test every installed model here (speed, usable answers, right language) and set the fast and strong models |
| `/local model <name>` | Use one model for everything |
| `/activity on` · `off` · `text` · `clear` | Watch what the plugin does on each prompt in a live terminal window, stop, or list it here |
| `/shortcut name = meaning` · `/shortcut` | Save a shortcut, or list them |
| `/forget name` · `/forget cache` | Forget a shortcut, or clear the answer cache |
| `/new-task [next task]` · `/last-task` | Handoff across `/clear`, or into a new session |
| `/fix` `/explain` `/run-tests` `/review-changes` `/build` `/brief` | Ready-made lean prompts (optional) |

Every command is also in the `/` menu as `quota-saver:<name>` (for example `/quota-saver:status`, `/quota-saver:activity`), so it shows in editors whose menu lists only file commands. Both forms do the same thing, without a model call.

Prefixes: `QS_RAW=1 <command>` (in a command Claude runs) keeps its output whole. `!` sends a prompt straight to Claude (skips cache and local model). `~` sends it to the local model when `/local` is on.

## Which local model

Measured on an Intel Mac without a GPU (16 GB RAM), four questions each (English, Roman Urdu, a technical comparison, a code question), reasoning off:

| Model | Size | Avg answer | Answers right | Verdict |
|---|---|---|---|---|
| **gemma4:e2b** | 4.6 GB | 5.7 s | 4/4 | Best: strong model of the team |
| **qwen3:1.7b** | 1.4 GB | 1.9 s | 4/4 (replies in English) | Fastest: fast model, and the default first download |
| qwen3.5:2b | 2.7 GB | 8.0 s | 4/4 | Good, slower than gemma4 |
| qwen3.5:4b | 3.3 GB | 12.1 s | 4/4 | Good, twice gemma4's time |
| gemma3:4b | 3.4 GB | 12.6 s | 4/4 | Slower, no better |
| ministral-3:3b | 3.0 GB | 10.3 s | 3/4 | Got `let` wrong |
| qwen2.5:3b | 1.9 GB | 7–10 s | 2/3 | Garbled Roman Urdu |

With nothing picked by hand, `/local on` makes the best installed models the team (`gemma4:e2b` strong, `qwen3:1.7b` fast). `/local pick` measures them on your own machine instead. For the strongest local answers: `ollama pull gemma4:e2b`.

## Watching it work

`/activity on` opens a terminal window that shows, live, what the plugin does with each prompt:

```
07:41:02  PROMPT   "login pe error aa raha hai theek karo"
07:41:02  INFO     task looks like "fix" → lean fix guide attached (shorter work and reply)
07:41:02  CLAUDE   sent to Claude
07:41:09  BLOCKED  whole read of bundle.js stopped: 480 KB ≈ 122.9k tokens; asked to search first
07:41:15  SAVED    Bash output 52.3k → 5.9k chars (≈ 11.6k tokens saved, errors and last lines kept)
07:41:31  TURN     turn done (answer): 3.1k new in, 41.2k cached in, 412 out · claude-sonnet-5-5
07:41:31  TURN     used 44.7k tokens · without Quota Saver ≈ 79.5k · saved ≈ 34.8k (44%) over 3 requests
```

**How "without Quota Saver" is worked out.** *Used* is the API's own count. *Without* adds back what the plugin kept out of the context (shortened output, refused reads), once for every request the turn made, because every request re-sends the whole context. A refused read that Claude then retries counts as nothing saved. A prompt answered from the cache or the local model counts as one request over the current context. Savings from the lean rules and task guides cannot be measured and are left out, so the figure errs low. `/quota-saver` shows the same comparison for the session and all time.

Recording is off by default and stops with `/activity off`, so it costs nothing when you are not watching. Where no window can open, the reply gives the command to follow the log yourself (`tail -f ~/.quota-saver-activity.log`, or `Get-Content -Wait` on Windows).

## Settings

In `/config`, under `quota-saver`:

| Setting | Default | |
|---|---|---|
| `maxOutputChars` | `6000` | Tool output longer than this is shortened |
| `maxReadKB` | `80` | Whole reads above this size get the search-first hint |
| `dedupeReads` | `true` | Refuse a repeat read of an unchanged file |
| `autoIntent` | `true` | Attach the lean task guide |
| `localCache` | `true` | Serve repeated questions from disk |
| `modelAdvisor` | `true` | Suggest a lighter model for light tasks on Opus |
| `semanticCache` | `true` | Answer questions that mean the same as an earlier one (local model on) |
| `guardJunk` | `true` | Refuse whole reads of dependency/build folders, lock files, minified bundles |
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
| macOS | Official app (prebuilt, ~200 MB) into `/Applications` | Homebrew (slow on Intel Macs: it compiles) |
| Windows | `winget install Ollama.Ollama` | Official installer, silent |
| Linux | Official install script | Official build into `~/.local` (no root) |

The model (default `qwen2.5:1.5b`, about 1 GB) is downloaded once. If it cannot be downloaded, the plugin tries `llama3.2:3b`, then `gemma3:1b`. While local mode is on, the plugin starts the Ollama server with each session if it is not already running. If anything fails, the prompt goes to Claude and a notice says why.

## Limits

- The plugin makes a paid plan last longer. It does not make Claude free: Claude Code needs a Claude subscription or API credits.
- Savings are estimated at about 4 characters per token.
- Cached answers may be out of date if the code changed since. They expire after 3 days, and `!` always asks again.
- `prompt.compose` and `session.compact` hooks do not run for user-installed plugins where an organisation manages Claude Code; there the lean rules and the handoff note are not added.

## Development

```
scripts/check.sh        # validate, test and type-check; stops at the first failure
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
