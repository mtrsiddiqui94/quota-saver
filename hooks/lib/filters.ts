// Command-aware filters: what a test run, an install or a noisy log says,
// without the lines that carry nothing (passing tests, progress bars,
// download chatter, the same line a hundred times). Applied before the
// generic head/tail cut; error lines are never dropped.

const ERROR = /error|fail|✗|✖|×|panic|exception|traceback|assert|expected|received|warn/i

/** Which family of command produced the output, from the command line. */
export type CommandKind = 'test' | 'install' | 'build' | 'other'

export function commandKind(command: string): CommandKind {
  const c = command.toLowerCase()
  if (/\b(jest|vitest|pytest|mocha|ava|tap|phpunit|rspec|go test|cargo test|npm (run )?test|pnpm (run )?test|yarn (run )?test|bun test|dotnet test|mvn test|gradle test|playwright test)\b/.test(c)) return 'test'
  if (/\b(npm (i|install|ci|add)|pnpm (i|install|add)|yarn( install| add)?$|yarn (install|add)|bun (i|install|add)|pip3? install|poetry install|uv (pip )?(install|sync)|cargo (fetch|build)|go mod (download|tidy)|bundle install|composer install|brew install)\b/.test(c)) return 'install'
  if (/\b(pod install|expo install|npx expo install)\b/.test(c)) return 'install'
  if (/\b(npm run build|pnpm (run )?build|yarn build|tsc|webpack|vite( build)?|next build|nuxt build|vue-cli-service build|ng build|cargo build|go build|make|gradle(w)?( build| assemble\w*)?|\.\/gradlew|mvn (package|install)|xcodebuild|react-native (run-android|run-ios|bundle)|expo (run|export|prebuild)|eas build)\b/.test(c)) return 'build'
  return 'other'
}

// A passing test line in the common runners' formats.
const PASSING = /^\s*(✓|✔|√|PASS\b|ok\s+\d|ok\s+-|test .+ \.\.\. ok$|.+ PASSED\b|\[\s*PASS\s*\]|●\s*passed)/
// Progress bars, spinners and download chatter.
const NOISE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|\[[#=>.\- ]{6,}\]|\b\d{1,3}%\s*(\||complete|done)?|^\s*(Downloading|Downloaded|Fetching|Resolving|Collecting|Using cached|Requirement already satisfied|Progress:|reify:|idealTree|timing|http fetch|Installing [\w@/.-]+ \(|Analyzing dependencies|Generating Pods project|CompileC |CompileSwift |Ld |CpResource |ProcessInfoPlistFile |Transforming|Bundling .*\d+\.\d+%)|^> Task :\S+( (UP-TO-DATE|NO-SOURCE|SKIPPED|FROM-CACHE))?\s*$/i
// Per-package and per-layer chatter of docker, pip, cargo, git and gradle.
const CHATTER = [
  /^\s*[0-9a-f]{12}: (Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)/,
  /^#\d+ (sha256:|\[internal\]|DONE \d|CACHED|extracting|resolve )/,
  /^\s*=> (CACHED|\[internal\])/,
  /^\s*(Building wheel for|Created wheel for|Stored in directory:|Preparing metadata|Getting requirements to build|Installing build dependencies|Found existing installation:|Uninstalling \S+:|Successfully uninstalled|Attempting uninstall:)/,
  /^\s+(Compiling|Checking|Fresh|Locking|Adding|Downloaded|Unpacking) \S+ v\d/,
  /^\s+Updating crates\.io index\s*$/,
  /^(remote: )?(Enumerating|Counting|Compressing|Receiving|Resolving|Unpacking) (objects|deltas)/,
  /^Download(ing)? https?:\/\/\S+\s*$/,
]
const isChatter = (line: string) => CHATTER.some(re => re.test(line))

/** Collapses runs of the same line into one, with a count. */
export function collapseRepeats(lines: readonly string[]): string[] {
  const out: string[] = []
  let prev: string | undefined
  let run = 0
  const flush = () => {
    if (prev === undefined) return
    out.push(run > 1 ? `${prev}  [×${run}]` : prev)
  }
  for (const line of lines) {
    if (line === prev) {
      run += 1
      continue
    }
    flush()
    prev = line
    run = 1
  }
  flush()
  return out
}

export type Filtered = { text: string; dropped: number; kind: CommandKind }

/** Drops what carries nothing for this kind of command; never an error line. Undefined when nothing could be dropped. */
export function filterOutput(command: string, text: string): Filtered | undefined {
  const kind = commandKind(command)
  const lines = text.replace(/\r(?!\n)/g, '\n').split('\n')
  const keep = lines.filter(line => {
    if (ERROR.test(line)) return true
    if (NOISE.test(line) || isChatter(line)) return false
    if (kind === 'test' && PASSING.test(line)) return false
    return true
  })
  const collapsed = collapseRepeats(keep.filter((l, i) => l.trim() !== '' || keep[i - 1]?.trim() !== ''))
  const dropped = lines.length - collapsed.length
  if (dropped <= 0) return undefined
  return { text: collapsed.join('\n'), dropped, kind }
}
