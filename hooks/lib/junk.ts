// Paths that are almost never worth reading in full: dependencies, build
// output, caches, lock files, minified bundles and source maps.

const JUNK_DIRS = [
  'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.parcel-cache', '.cache', 'coverage', '.nyc_output', 'target', '__pycache__', '.pytest_cache',
  '.mypy_cache', '.tox', '.venv', 'venv', '.gradle', 'Pods', 'DerivedData', '.git',
  // web and mobile frameworks: Expo, Nuxt/Nitro, Vercel, Angular, Storybook, Yarn, Metro, Android/iOS builds
  '.expo', '.expo-shared', '.output', '.vercel', '.angular', 'storybook-static', '.yarn', '.metro-cache',
  '.cxx', 'xcuserdata', 'web-build',
]

const JUNK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json',
  'poetry.lock', 'Pipfile.lock', 'uv.lock', 'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'go.sum',
  'Podfile.lock', 'mix.lock', 'flake.lock',
])

const JUNK_SUFFIX = /\.(min\.(js|css|mjs)|map|bundle\.js|chunk\.js|pyc|class|o|so|dylib|dll|exe|wasm)$/i

export type JunkReason = 'dependency or build folder' | 'lock file' | 'minified or generated file'

/** Why a path is junk, or undefined when it is an ordinary file. */
export function junkReason(path: string): JunkReason | undefined {
  const parts = path.split(/[\\/]+/)
  const name = parts.at(-1) ?? ''
  if (JUNK_FILES.has(name)) return 'lock file'
  if (JUNK_SUFFIX.test(name)) return 'minified or generated file'
  if (parts.slice(0, -1).some(dir => JUNK_DIRS.includes(dir))) return 'dependency or build folder'
  return undefined
}
