/**
 * Filename strategy.
 *
 * - `original`: use the user-provided filename unchanged.
 * - `uuid`: replace the basename with a v4 UUID, keep the
 *   extension. Collision rate is negligible (~1 in 2^122).
 *   Uses the browser's built-in `crypto.randomUUID()` (no
 *   external dep — host can't resolve bare `uuid` imports).
 * - `timestamp`: prefix with `YYYY-MM-DDTHHmmssZ-` (colons
 *   stripped to keep Windows-friendly names) and append the
 *   original basename. Useful for humans scanning a flat
 *   directory listing.
 */
import type { FilenameStrategy } from '../types'

function getExtension(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : ''
}

function buildTimestamp(): string {
  // YYYY-MM-DDTHHmmssZ — the host provider's filesystem is
  // happier with the colon-free form on Windows, hence the
  // explicit re-format.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Last-resort fallback for environments without
  // crypto.randomUUID (very old webviews). Math.random is
  // not cryptographically secure, but for filename
  // uniqueness it is more than sufficient.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function resolveFilename(
  original: string,
  strategy: FilenameStrategy
): string {
  if (!original) original = `image-${Date.now()}.png`
  const ext = getExtension(original)
  const base = ext ? original.slice(0, -(ext.length + 1)) : original

  switch (strategy) {
    case 'original':
      return original
    case 'uuid':
      return ext ? `${uuidv4()}.${ext}` : uuidv4()
    case 'timestamp':
      return ext
        ? `${buildTimestamp()}-${base}.${ext}`
        : `${buildTimestamp()}-${base}`
    default:
      return original
  }
}
