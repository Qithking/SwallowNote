/**
 * BUG-A(数据侧): 市场索引 repo.json 引用的 zip 产物未被 git 跟踪，
 * 推送后远端 404（.gitignore 的 zip 忽略规则挡住了新增插件的 zip）。
 *
 * 行为契约: plugins/repo.json 中每个条目的 download_url 解析出的 zip：
 *   1. 本地存在且 sha256 与索引声明一致（防止引用过期产物）；
 *   2. 必须被 git 跟踪（防止 .gitignore 挡住新增 zip → 远端 404）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const repoJsonPath = resolve(repoRoot, 'plugins/repo.json')

interface RepoEntry {
  id: string
  version: string
  download_url: string
  sha256: string
}

/** 把 download_url 相对路径解析为 plugins/ 下的本地 zip 路径。 */
function resolveZipPath(downloadUrl: string): string {
  // 索引 download_url 形如 "./mindmap/com.swallownote.mindmap.zip"
  const relative = downloadUrl.replace(/^\.\//, '')
  return resolve(repoRoot, 'plugins', relative)
}

describe('BUG-A: repo.json 与插件 zip 产物一致性', () => {
  const raw = JSON.parse(readFileSync(repoJsonPath, 'utf-8'))
  const entries: RepoEntry[] = raw.plugins

  it('索引每个条目的 zip 本地存在且 sha256 匹配', () => {
    for (const e of entries) {
      const zipPath = resolveZipPath(e.download_url)
      const bytes = readFileSync(zipPath)
      const actual = createHash('sha256').update(bytes).digest('hex')
      expect(
        actual.toLowerCase(),
        `${e.id}@${e.version} zip sha256 与索引声明不一致 (${zipPath})`,
      ).toBe(e.sha256.toLowerCase())
    }
  })

  it('索引每个条目的 zip 必须被 git 跟踪（防止 .gitignore 挡住新 zip → 远端 404）', () => {
    for (const e of entries) {
      const relPath = e.download_url.replace(/^\.\//, 'plugins/')
      const tracked = execSync(`git ls-files -- ${relPath}`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      }).trim()
      expect(
        tracked,
        `${e.id}@${e.version} 的 zip 未被 git 跟踪: ${relPath}（远端将 404）`,
      ).toBe(relPath)
    }
  })
})
