// A file's skeleton: its functions, classes, types and headings with line
// numbers. A fraction of the tokens of reading it, and enough to then read
// only the lines that matter. Regex-based, so it needs no parser and works on
// any language with recognisable declarations.

const RULES: ReadonlyArray<RegExp> = [
  // JS / TS
  /^\s*(export\s+)?(default\s+)?(async\s+)?function\*?\s+[\w$]+\s*\(/,
  /^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s+[\w$]+/,
  /^\s*(export\s+)?(declare\s+)?(interface|type|enum|namespace)\s+[\w$]+/,
  /^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*(:\s*[^=]+)?=\s*(async\s*)?(\([^)]*\)|[\w$]+)\s*(:\s*[^=]+)?=>/,
  /^\s{2,}(public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+|override\s+)*(?!if\b|for\b|while\b|switch\b|catch\b|return\b|else\b|do\b|try\b|with\b|function\b)[\w$#]+\s*(<[^>]*>)?\s*\([^)]*\)\s*(:\s*[^{]+)?\{\s*$/,
  // Python
  /^\s*(async\s+)?def\s+\w+\s*\(/,
  /^\s*class\s+\w+/,
  // Go
  /^func\s+(\([^)]*\)\s*)?\w+\s*\(/,
  /^type\s+\w+\s+(struct|interface)\b/,
  // Rust
  /^\s*(pub(\([^)]*\))?\s+)?(async\s+)?(unsafe\s+)?fn\s+\w+/,
  /^\s*(pub(\([^)]*\))?\s+)?(struct|enum|trait|mod|union)\s+\w+/,
  /^\s*impl(<[^>]*>)?\s+[\w:<>, ]+/,
  // Java, Kotlin, C#, Swift, PHP
  /^\s*((public|private|protected|internal|static|final|abstract|override|open|sealed|data|suspend|async|virtual)\s+)*(fun|func)\s+[\w<>]+\s*\(/,
  /^\s*((public|private|protected|internal|static|final|abstract|sealed|open|data)\s+)*(class|interface|object|struct|enum|record|protocol|extension)\s+\w+/,
  /^\s*((public|private|protected|static|final|abstract|synchronized|override|virtual|async)\s+)+[\w<>\[\], ?]+\s+\w+\s*\([^;]*\)\s*(throws\s+[\w, ]+)?\s*\{?\s*$/,
  /^\s*((public|private|protected|static)\s+)*function\s+\w+\s*\(/,
  // Ruby
  /^\s*(def|class|module)\s+[\w.:]+/,
]

const MARKDOWN = /^#{1,6}\s+\S/

export type Outline = { lines: number; symbols: string[]; isTruncated: boolean }

const MAX_SYMBOLS = 200

export function outline(path: string, text: string): Outline {
  const all = text.split('\n')
  const isMarkdown = /\.(md|mdx|markdown|rst)$/i.test(path)
  const symbols: string[] = []
  for (const [i, raw] of all.entries()) {
    const line = raw.replace(/\s+$/, '')
    const hit = isMarkdown ? MARKDOWN.test(line) : RULES.some(r => r.test(line))
    if (!hit) continue
    const indent = (/^\s*/.exec(line)?.[0].length ?? 0) >= 2 ? '  ' : ''
    symbols.push(`${String(i + 1).padStart(5)}  ${indent}${line.trim().replace(/\s*\{\s*$/, '').slice(0, 140)}`)
    if (symbols.length >= MAX_SYMBOLS) break
  }
  return { lines: all.length, symbols, isTruncated: symbols.length >= MAX_SYMBOLS }
}

export function formatOutline(path: string, o: Outline): string {
  if (o.symbols.length === 0) return `${path}: ${o.lines} lines, no declarations recognised. Read a line range, or grep it.`
  return [
    `${path}: ${o.lines} lines, ${o.symbols.length}${o.isTruncated ? '+' : ''} declarations (line number, then the declaration):`,
    ...o.symbols,
    '',
    'Read only the range you need: Read with offset (the line number) and limit.',
  ].join('\n')
}
