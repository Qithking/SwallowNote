/** 文件名策略：original/uuid/timestamp */
import type { FilenameStrategy } from '../types'

function getExtension(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : ''
}

function buildTimestamp(): string {
  // YYYY-MM-DDTHHmmssZ，避免冒号以兼容 Windows
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
  // 无 crypto.randomUUID 时的回退方案
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
