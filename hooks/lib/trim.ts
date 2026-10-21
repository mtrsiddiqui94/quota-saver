// Pure helpers, kept apart from the hooks so tests can reach them directly.

const SIGNAL = /error|fail|exception|traceback|panic|fatal|warn|assert|denied|not found|cannot|undefined|✗|✖/i

export type Trimmed = { text: string; savedChars: number }

/**
 * Shortens a long tool output: keeps the head, the tail, and the lines in
 * between that look like errors or warnings, and says how much was left out.
 */
export function trimOutput(text: string, maxChars: number): Trimmed {
  if (text.length <= maxChars) return { text, savedChars: 0 }

  const lines = text.split('\n')
  const headCount = 25
  const tailCount = 50

  if (lines.length <= headCount + tailCount) {
    const half = Math.floor(maxChars / 2)
    const cut = text.slice(0, half) + `\n…[quota-saver: ${text.length - maxChars} characters left out]…\n` + text.slice(-half)
    return { text: cut, savedChars: Math.max(0, text.length - cut.length) }
  }

  const head = lines.slice(0, headCount)
  const tail = lines.slice(-tailCount)
  const middle = lines.slice(headCount, lines.length - tailCount)
  const signals = middle.filter(line => SIGNAL.test(line)).slice(0, 40)
  const dropped = middle.length - signals.length

  const parts = [
    ...head,
    `…[quota-saver: ${dropped} of ${middle.length} middle lines left out${signals.length ? `; ${signals.length} error/warning lines kept below` : ''}. Re-run with grep/tail if you need a specific part]…`,
    ...signals,
    ...(signals.length ? ['…'] : []),
    ...tail,
  ]
  let out = parts.join('\n')

  // Very long lines can still blow the budget: clip each side to fit.
  if (out.length > maxChars * 1.5) {
    const half = Math.floor(maxChars * 0.75)
    out = out.slice(0, half) + '\n…[quota-saver: clipped]…\n' + out.slice(-half)
  }

  return { text: out, savedChars: Math.max(0, text.length - out.length) }
}

/** Tools whose output is safe to shorten: logs and fetched pages, never file contents the model edits from. */
export function isTrimmable(tool: string): boolean {
  return tool === 'Bash' || tool === 'PowerShell' || tool === 'WebFetch' || tool === 'BashOutput' || tool.startsWith('mcp__')
}

/** Rough token estimate, ~4 characters per token. */
export function tokens(chars: number): number {
  return Math.round(chars / 4)
}

export function formatK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|ipynb)$/i

export function isBinaryLike(path: string): boolean {
  return BINARY.test(path)
}
