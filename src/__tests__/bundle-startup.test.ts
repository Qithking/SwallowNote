import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const BUILD_DIR = path.resolve(process.cwd(), 'build')

function getSize(relPath: string): number | null {
  const fullPath = path.join(BUILD_DIR, relPath.replace(/^\//, ''))
  if (!fs.existsSync(fullPath)) return null
  return fs.statSync(fullPath).size
}

describe('startup bundle size regression', () => {
  it('critical path JS must stay below 2 MB', () => {
    const indexHtml = fs.readFileSync(path.join(BUILD_DIR, 'index.html'), 'utf8')

    const preloadRegex = /<link rel="modulepreload"[^>]*href="([^"]+)"/g
    const scriptRegex = /<script type="module"[^>]*src="([^"]+)"/g

    const preloads: string[] = []
    let m: RegExpExecArray | null
    while ((m = preloadRegex.exec(indexHtml)) !== null) {
      preloads.push(m[1])
    }

    const scripts: string[] = []
    while ((m = scriptRegex.exec(indexHtml)) !== null) {
      scripts.push(m[1])
    }

    const totalJs = [...scripts, ...preloads]
      .map(getSize)
      .filter((s): s is number => s !== null)
      .reduce((a, b) => a + b, 0)

    const maxBytes = 2 * 1024 * 1024
    expect(totalJs).toBeLessThan(maxBytes)
  })
})
